import io
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from unittest import skipUnless

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .extract import ocr_available

from unittest.mock import patch

from .throttles import RepeatThrottle
from .models import Branch, Customer, CustomerEvent, SpinItem

MEDIA = tempfile.mkdtemp()
IMEI = "490154203237518"
OTHER_IMEI = "356938035643809"


def bill_text(phone, imei, invoice=None, name="Asha", product="Phone 15"):
    return (
        f"Invoice No : {invoice or 'INV-' + imei}\nBilled To,\n{name}\nPh: {phone}\n"
        f"{product}\nIMEI NO: {imei}\nNet Total 1 24,999.00\n"
    )


def text_pdf(text):
    """A one-page PDF whose text layer holds `text`."""
    lines = "".join(f"({l.replace('(', '').replace(')', '')}) Tj T*\n" for l in text.splitlines())
    stream = f"BT /F1 11 Tf 40 800 Td 14 TL\n{lines}ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


def jpeg(name="selfie.jpg"):
    out = io.BytesIO()
    Image.new("RGB", (640, 800), (180, 120, 90)).save(out, "JPEG")
    return SimpleUploadedFile(name, out.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA, STUDIO_URL="https://studio.example")
class BranchFlowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()  # rate-limit counters
        # Tests repeat actions instantly; the 5-second guard has its own test.
        patcher = patch.object(RepeatThrottle, "get_rate", lambda self: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.branch = Branch.objects.create(name="Anna Nagar")
        self.staff = User.objects.create_user("staff@sky.in", password="x", is_staff=True)

    def check(self, phone="9845011111", imei=IMEI, **extra):
        body = {
            "name": "Asha", "phone": phone, "product_details": "Phone 15", "imei": imei,
            "invoice_number": f"INV-{imei}", "bill_value": "24999.00",
            "branch": "anna-nagar", "blur_score": 200, **extra,
        }
        # The text Django read from the invoice (ManagerScan), by its scan id.
        text = body.pop("ocr_text", None) or bill_text(phone, imei)
        scan = f"test-{len(text)}-{hash(text) & 0xffff}"
        cache.set(f"invoice-scan:{scan}", text, 600)
        body["scan"] = scan
        if "scan_override" in body:
            body["scan"] = body.pop("scan_override")
        return self.client.post("/api/manager/check/", body)

    def token(self, res):
        return res.json()["link"].split("spin=")[1]

    def accept(self, token, **body):
        return self.client.post("/api/customers/terms/", {"token": token, "accept": True, **body},
                                content_type="application/json")

    def spin(self, token, accept=True):
        if accept:
            self.accept(token)
        return self.client.post(
            "/api/customers/spin/", {"token": token}, content_type="application/json"
        )

    def test_slug_and_link_are_generated(self):
        self.assertEqual(self.branch.slug, "anna-nagar")
        self.client.force_login(self.staff)
        data = self.client.get("/api/admin/branches/").json()
        links = [b["link"] for b in data]
        self.assertIn("https://studio.example/?branch=anna-nagar", links)

    def test_abandoned_is_a_failed_check_or_an_unsent_link(self):
        self.client.force_login(self.staff)
        self.check(ocr_text="Invoice No : WRONG1")
        data = self.client.get("/api/admin/customers/abandoned/").json()
        self.assertEqual(data["check_failed"][0]["detail"]["name"], "Asha")
        self.assertEqual(self.client.get("/api/admin/stats/").json()["abandoned"], 1)
        self.check()  # the retry passes: now only the link is outstanding
        data = self.client.get("/api/admin/customers/abandoned/").json()
        self.assertEqual((len(data["check_failed"]), len(data["link_not_sent"])), (0, 1))
        self.client.post("/api/manager/sent/", {"phone": "9845011111"})
        self.assertEqual(self.client.get("/api/admin/stats/").json()["abandoned"], 0)

    def test_admin_image_links_stay_on_the_current_site(self):
        Customer.objects.create(phone="9845022222", session="s", poster="customers/p.jpg")
        self.client.force_login(self.staff)
        row = self.client.get("/api/admin/customers/").json()["results"][0]
        self.assertEqual(row["poster"], "/media/customers/p.jpg")

    def price_bands(self):
        SpinItem.objects.all().delete()
        SpinItem.objects.create(name="Stand", min_bill=0, max_bill=9999)
        SpinItem.objects.create(name="Speaker", min_bill=10000, max_bill=19999)
        SpinItem.objects.create(name="Watch", min_bill=20000)

    def test_bill_decides_the_gift(self):
        self.price_bands()
        token = self.token(self.check())  # bill 24,999
        link = self.client.get(f"/api/customers/link/{token}/").json()
        # Every gift is on the wheel; the bill still decides the prize.
        self.assertEqual([i["label"] for i in link["items"]], ["Stand", "Speaker", "Watch"])
        self.assertEqual(self.spin(token).json()["reward"], "watch")

    def test_bill_in_a_gap_gets_the_range_below(self):
        self.price_bands()
        SpinItem.objects.filter(name="Watch").update(min_bill=30000)
        self.assertEqual([i.name for i in SpinItem.for_bill(25000)], ["Speaker"])
        self.assertEqual([i.name for i in SpinItem.for_bill(500)], ["Stand"])

    def test_admin_manages_spin_items(self):
        self.client.force_login(self.staff)
        res = self.client.post("/api/admin/spin-items/", {"name": "TV", "min_bill": 50000, "max_bill": 100})
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/api/admin/spin-items/", {"name": "TV", "min_bill": 50000})
        self.assertEqual(res.status_code, 201)
        url = f"/api/admin/spin-items/{res.json()['id']}/"
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.client.logout()
        self.assertEqual(self.client.get("/api/admin/spin-items/").status_code, 403)

    def test_journey_steps_list_their_customers(self):
        self.spin(self.token(self.check()))
        self.check("bad")
        self.client.force_login(self.staff)
        spun = self.client.get("/api/admin/customers/?reached=spun").json()["results"]
        self.assertEqual(len(spun), 1)
        self.assertEqual(self.client.get("/api/admin/customers/?reached=shared").json()["count"], 0)
        self.assertEqual(len(self.client.get("/api/admin/customers/failed/").json()), 1)

    def test_highest_branch_by_bill_value(self):
        self.check()
        self.client.force_login(self.staff)
        top = self.client.get("/api/admin/stats/").json()["branch_sales"][0]
        self.assertEqual((top["name"], float(top["value"]), top["n"]), ("Anna Nagar", 24999.0, 1))

    def test_branch_cards_rank_and_show_the_journey(self):
        self.spin(self.token(self.check()))
        self.client.force_login(self.staff)
        top = self.client.get("/api/admin/branches/").json()[0]
        self.assertEqual((top["name"], top["customer_count"], top["journey"]["spun"]), ("Anna Nagar", 1, 1))
        self.assertEqual(float(top["sales"]), 24999.0)

    def test_starting_gifts_have_pictures(self):
        self.client.force_login(self.staff)
        rows = self.client.get("/api/admin/spin-items/").json()
        self.assertEqual(len(rows), 6)
        self.assertTrue(all(r["image"].startswith("/static/mirrors/rewards/") for r in rows))

    def test_second_spin_stops_at_the_middleware(self):
        token = self.token(self.check())
        first = self.spin(token).json()["reward"]
        again = self.spin(token).json()
        self.assertEqual(again, {"reward": first, "next": "review"})
        link = self.client.get(f"/api/customers/link/{token}/").json()
        self.assertEqual((link["next"], link["poster"]), ("review", None))
        Customer.objects.update(poster="customers/p.jpg")
        link = self.client.get(f"/api/customers/link/{token}/").json()
        self.assertEqual((link["next"], link["poster"]), ("share", "/media/customers/p.jpg"))

    def review(self, token, **body):
        return self.client.post("/api/customers/review/", {"token": token, **body},
                                content_type="application/json")

    def test_rating_and_review_come_after_the_spin(self):
        token = self.token(self.check())
        self.assertEqual(self.review(token, rating=5).status_code, 400)  # not spun yet
        self.spin(token)
        self.assertEqual(self.review(token, rating=6).status_code, 400)
        self.assertEqual(self.review(token, rating=4, review="Great").json(), {"next": "mirror"})
        c = Customer.objects.get()
        self.assertEqual((c.rating, c.review), (4, "Great"))
        self.client.force_login(self.staff)
        stats = self.client.get("/api/admin/stats/").json()
        self.assertEqual((stats["rating"]["avg"], stats["reviews"][0]["review"]), (4.0, "Great"))

    def test_terms_come_first_and_store_the_instagram_id(self):
        token = self.token(self.check())
        self.assertEqual(self.client.get(f"/api/customers/link/{token}/").json()["next"], "terms")
        self.assertEqual(self.spin(token, accept=False).status_code, 400)
        self.assertEqual(self.accept(token, video_review=True).status_code, 400)  # no ID
        res = self.accept(token, video_review=True, instagram_id="@asha.k")
        self.assertEqual(res.json(), {"next": "spin"})
        c = Customer.objects.get()
        self.assertEqual((c.video_review, c.instagram_id), (True, "asha.k"))
        self.assertTrue(c.terms_accepted_at)

    def test_shares_are_counted_per_platform(self):
        token = self.token(self.check())
        for kind in ("shared_whatsapp", "shared_whatsapp", "shared_instagram"):
            self.client.post("/api/customers/event/", {"token": token, "kind": kind},
                             content_type="application/json")
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get("/api/admin/stats/").json()["shares"],
                         {"whatsapp": 2, "instagram": 1})
        row = self.client.get("/api/admin/customers/").json()["results"][0]
        self.assertEqual(row["shared_on"], {"whatsapp": 2, "instagram": 1})

    def test_live_visitors_are_counted(self):
        for visitor in ("a", "b", "a"):
            self.client.post("/api/live/", {"id": visitor}, content_type="application/json")
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get("/api/admin/stats/").json()["live"], 2)

    def test_the_same_action_twice_within_5_seconds_is_refused(self):
        token = self.token(self.check())
        with patch.object(RepeatThrottle, "get_rate", lambda self: "1/5s"):
            self.assertEqual(self.accept(token).status_code, 200)
            self.assertEqual(self.accept(token).status_code, 429)
            body = {"token": token, "kind": "shared_more"}
            ok = self.client.post("/api/customers/event/", body, content_type="application/json")
            self.assertEqual(ok.status_code, 200)  # a different action is fine

    def test_server_status_is_staff_only_and_lists_live_users(self):
        self.client.post("/api/live/", {"id": "v1", "role": "customer", "screen": "terms"},
                         content_type="application/json")
        self.assertEqual(self.client.get("/api/admin/server/").status_code, 403)
        self.client.force_login(self.staff)
        data = self.client.get("/api/admin/server/").json()
        self.assertGreater(data["disk"]["total"], 0)
        self.assertGreater(data["cpu"]["cores"], 0)
        self.assertEqual([(v["role"], v["screen"]) for v in data["live"]], [("customer", "terms")])

    def test_bills_below_10000_get_no_link(self):
        res = self.check(bill_value="9999.99")
        self.assertEqual(res.status_code, 400)
        self.assertIn("below ₹10,000", res.json()["bill_value"][0])
        self.assertFalse(Customer.objects.exists())
        self.assertEqual(self.check(bill_value="10000").status_code, 200)

    def test_scan_reads_a_text_pdf_and_the_check_uses_that_reading(self):
        pdf = SimpleUploadedFile("bill.pdf", text_pdf(bill_text("9845011111", IMEI)), "application/pdf")
        res = self.client.post("/api/manager/scan/", {"invoice": pdf})
        self.assertEqual(res.status_code, 200)
        self.assertIn(IMEI, res.json()["text"])
        body = {
            "name": "Asha", "phone": "9845011111", "product_details": "Phone 15", "imei": IMEI,
            "invoice_number": f"INV-{IMEI}", "bill_value": "24999.00", "branch": "anna-nagar",
            "blur_score": 200, "scan": res.json()["scan"],
        }
        self.assertEqual(self.client.post("/api/manager/check/", body).status_code, 200)

    def test_an_unknown_scan_is_refused(self):
        res = self.check(scan_override="nope")
        self.assertIn("upload the invoice again", res.json()["invoice_image"][0])

    def test_invoice_number_prefix_slip_is_fixed(self):
        from .extract import normalize_invoice_number

        self.assertEqual(normalize_invoice_number("S12627CHE1041"), "SI2627CHE1041")
        self.assertEqual(normalize_invoice_number(" si2627vlr31054 "), "SI2627VLR31054")
        self.assertEqual(normalize_invoice_number("INV-12345"), "INV-12345")

    @skipUnless(ocr_available(), "needs the tesseract-ocr package")
    def test_a_photo_is_enhanced_and_read(self):
        from .extract import extract_text

        image = Image.new("RGB", (900, 260), (205, 205, 200))
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=34)
        draw.text((30, 40), "Invoice No : SI2627CHE1041", fill=(70, 70, 70), font=font)
        draw.text((30, 140), f"IMEI NO: {IMEI}", fill=(70, 70, 70), font=font)
        out = io.BytesIO()
        image.filter(ImageFilter.GaussianBlur(1)).save(out, "JPEG", quality=60)
        text = extract_text(out.getvalue(), "bill.jpg")
        self.assertIn(IMEI, text.replace(" ", ""))

    def test_share_journey_profile_open_shared_and_post_link(self):
        token = self.token(self.check())
        post = lambda path, body: self.client.post(path, {"token": token, **body}, content_type="application/json")
        self.assertEqual(post("/api/customers/profile/", {"platform": "instagram", "handle": "https://instagram.com/asha.k/"}).json(), {"handle": "asha.k"})
        self.assertEqual(post("/api/customers/profile/", {"platform": "facebook", "handle": "bad"}).status_code, 400)
        post("/api/customers/profile/", {"platform": "facebook", "handle": "https://facebook.com/asha.k"})
        post("/api/customers/event/", {"kind": "share_opened_instagram"})
        post("/api/customers/event/", {"kind": "shared_instagram"})
        self.assertEqual(post("/api/customers/event/", {"kind": "posted_instagram"}).status_code, 400)
        post("/api/customers/event/", {"kind": "posted_instagram", "url": "https://www.instagram.com/p/abc123/"})
        self.client.force_login(self.staff)
        stats = self.client.get("/api/admin/stats/").json()
        self.assertEqual((stats["share_opened"], stats["shares"], stats["posted"]),
                         ({"instagram": 1}, {"instagram": 1}, {"instagram": 1}))
        row = self.client.get("/api/admin/customers/").json()["results"][0]
        self.assertEqual(row["posts"], [{"platform": "instagram", "url": "https://www.instagram.com/p/abc123/"}])
        self.assertEqual((row["instagram_id"], row["facebook_profile"]), ("asha.k", "https://facebook.com/asha.k"))

    def test_phone_imei_is_checked_against_the_bill(self):
        bad = self.check(imei="490154203237519")  # fails the IMEI check
        self.assertIn("not valid", bad.json()["imei"][0])
        res = self.check(imei=OTHER_IMEI, ocr_text=bill_text("9845011111", IMEI, "SI2627VLR31054"),
                         invoice_number="SI2627VLR31054")
        self.assertIn("IMEI", res.json()["invoice_image"][0])
        missing = self.check(imei="", ocr_text=bill_text("9845011111", IMEI, "SI2627VLR31054"),
                             invoice_number="SI2627VLR31054")
        self.assertIn("Enter the IMEI", missing.json()["imei"][0])

    def test_a_bill_without_a_phone_imei_needs_none(self):
        text = bill_text("9845011111", "P-12568801-D", "SI2627VLR31054")  # a TV's serial
        res = self.check(imei="", invoice_number="SI2627VLR31054", ocr_text=text)
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(Customer.objects.get().imei)  # stored as NULL

    def test_admin_approves_a_rejection_with_corrections(self):
        self.check(invoice_number="SI2627VLR31099", ocr_text=bill_text("9845011111", IMEI, "SI2627VLR31054"))
        self.client.force_login(self.staff)
        rows = self.client.get("/api/admin/rejections/").json()
        self.assertEqual(len(rows), 1)
        self.assertIn("SI2627VLR31054", rows[0]["detail"]["ocr_text"])
        body = {"name": "Asha K", "phone": "9845011111", "product_details": "Phone 15",
                "imei": IMEI, "invoice_number": "SI2627VLR31054", "bill_value": "24999",
                "branch": "anna-nagar"}
        res = self.client.post(f"/api/admin/rejections/{rows[0]['id']}/approve/", body,
                               content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("?spin=", res.json()["link"])
        c = Customer.objects.get()
        self.assertEqual((c.name, c.invoice_number), ("Asha K", "SI2627VLR31054"))
        self.assertEqual(self.client.get("/api/admin/rejections/").json(), [])
        self.assertEqual(c.events.get(kind="checked").detail["approved_by"], "staff@sky.in")

    def test_dismissed_rejections_leave_the_list(self):
        self.check(invoice_number="SI2627VLR31099", ocr_text=bill_text("9845011111", IMEI, "SI2627VLR31054"))
        self.client.force_login(self.staff)
        pk = self.client.get("/api/admin/rejections/").json()[0]["id"]
        self.client.post(f"/api/admin/rejections/{pk}/dismiss/")
        self.assertEqual(self.client.get("/api/admin/rejections/").json(), [])

    def test_rejections_are_staff_only(self):
        self.assertEqual(self.client.get("/api/admin/rejections/").status_code, 403)

    def test_excel_branches_are_seeded(self):
        self.assertEqual(Branch.objects.exclude(name="Anna Nagar").count(), 31)
        self.assertTrue(Branch.objects.filter(slug="thiruvannamalai-1").exists())

    def test_check_files_the_customer_and_returns_a_link(self):
        res = self.check()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["link"].startswith("https://studio.example/?spin="))
        c = Customer.objects.get(phone="9845011111")
        self.assertEqual((c.branch, c.branch_name, c.imei), (self.branch, "Anna Nagar", IMEI))
        self.assertFalse(c.invoice_image or c.selfie)

    def test_invoice_text_must_match_and_failures_are_tracked(self):
        res = self.check(ocr_text="Invoice No : X123\nBilled To,\nAsha\nNet Total 100.00")
        self.assertEqual(res.status_code, 400)
        self.assertIn("invoice number", res.json()["invoice_image"][0])
        self.assertEqual(CustomerEvent.objects.get().kind, "check_failed")

    def test_labelled_invoice_number_must_match_exactly(self):
        text = bill_text("9845011111", IMEI, "SI2627VLR31054")
        ok = self.check(invoice_number="SI2627VLR31054", ocr_text=text)
        self.assertEqual(ok.status_code, 200)
        bad = self.check(invoice_number="SI2627VLR31055", ocr_text=text)
        self.assertEqual(bad.status_code, 400)

    def test_scanner_letter_mixups_still_match(self):
        res = self.check(ocr_text=bill_text("9845011111", IMEI, f"lNV-{IMEI.replace('0', 'O')}"))
        self.assertEqual(res.status_code, 200)

    def test_changed_details_replace_the_link(self):
        first = self.token(self.check())
        second = self.token(self.check(
            product_details="Phone 16", ocr_text=bill_text("9845011111", IMEI, product="Phone 16")
        ))
        self.assertNotEqual(first, second)
        self.assertEqual(self.spin(first).status_code, 404)
        self.assertEqual(Customer.objects.get().link_version, 2)

    def test_journey_is_tracked_for_the_admin(self):
        token = self.token(self.check())
        self.client.post("/api/manager/sent/", {"phone": "9845011111"})
        self.client.get(f"/api/customers/link/{token}/")
        self.spin(token)
        self.client.post("/api/customers/event/", {"token": token, "kind": "shared_whatsapp"},
                         content_type="application/json")
        self.client.force_login(self.staff)
        c = Customer.objects.get()
        data = self.client.get(f"/api/admin/customers/{c.pk}/").json()
        self.assertEqual(
            [e["kind"] for e in data["events"]],
            ["checked", "whatsapp_sent", "link_opened", "terms_accepted", "spun", "shared_whatsapp"],
        )
        self.assertIn("IMEI", data["ocr_text"])
        funnel = self.client.get("/api/admin/stats/").json()["funnel"]
        self.assertEqual((funnel["spun"], funnel["shared"]), (1, 1))

    def test_imei_is_found_when_a_scan_garbles_its_label(self):
        text = (f"Invoice No : SI2627A14813\nBilled To,\nAsha\nPh: 9845011111\n"
                f"IEE NO: {IMEI} 85171300\n")
        self.assertEqual(self.check(invoice_number="SI2627A14813", ocr_text=text).status_code, 200)

    def test_a_photo_scan_may_split_or_misread_the_invoice_number(self):
        for scanned in ("SI2627KRI 1251", "SI2627KR11251", "S12627KRl1251", "SI2627KRI125l"):
            text = f"Invoice No : {scanned} Invoice Date : 02/11/2026\nBilled To,\nAsha\nPh: 9845011111\nIMEI NO: {IMEI}\n"
            Customer.objects.all().delete()
            res = self.check(invoice_number="SI2627KRI1251", ocr_text=text)
            self.assertEqual(res.status_code, 200, scanned)

    def test_a_different_invoice_number_is_still_refused(self):
        text = f"Invoice No : SI2627KRI1251 Invoice Date : 02/11/2026\nBilled To,\nAsha\nPh: 9845011111\nIMEI NO: {IMEI}\n"
        res = self.check(invoice_number="SI2627VLR3105", ocr_text=text)
        self.assertIn("invoice number", res.json()["invoice_image"][0])
        self.assertIn("SI2627KRI1251", CustomerEvent.objects.get(kind="check_failed").detail["ocr_text"])

    def test_mobile_number_must_match_the_bill(self):
        res = self.check(ocr_text=bill_text("9845022222", IMEI))
        self.assertIn("mobile number", res.json()["invoice_image"][0])

    def test_public_branch_list_has_the_store_number(self):
        rows = self.client.get("/api/manager/branches/").json()
        self.assertEqual(next(b for b in rows if b["slug"] == "vellore-3")["phone"], "8754740002")

    def test_used_imei_or_invoice_is_refused(self):
        self.check()
        self.assertIn("IMEI", self.check("9845022222").json()["imei"][0])
        res = self.check(
            "9845022222", OTHER_IMEI, invoice_number=f"INV-{IMEI}",
            ocr_text=bill_text("9845022222", OTHER_IMEI, f"INV-{IMEI}"),
        )
        self.assertIn("invoice", res.json()["invoice_number"][0])

    def test_correction_before_spin_updates_the_same_customer(self):
        self.check()
        self.check(name="Asha K", ocr_text=bill_text("9845011111", IMEI, name="Asha K"))
        self.assertEqual(Customer.objects.get().name, "Asha K")

    def test_no_second_entry_after_spinning(self):
        self.spin(self.token(self.check()))
        self.assertEqual(self.check().status_code, 400)

    def test_switched_off_branch_is_refused(self):
        self.branch.is_active = False
        self.branch.save()
        self.assertEqual(self.check().status_code, 400)
        self.assertEqual(self.client.get("/api/branches/anna-nagar/").status_code, 404)

    def test_public_lookup_gives_the_branch_name(self):
        self.assertEqual(
            self.client.get("/api/branches/anna-nagar/").json(),
            {"slug": "anna-nagar", "name": "Anna Nagar", "phone": ""},
        )

    def test_spin_is_once_only_and_needs_no_selfie(self):
        token = self.token(self.check())
        first = self.spin(token).json()["reward"]
        self.assertEqual(self.spin(token).json()["reward"], first)
        link = self.client.get(f"/api/customers/link/{token}/").json()
        self.assertEqual((link["phone"], link["reward"]), ("9845011111", first))

    def test_unknown_token_cannot_spin(self):
        self.assertEqual(self.spin("nope").status_code, 404)
        self.assertEqual(self.client.get("/api/customers/link/nope/").status_code, 404)

    def test_upload_cannot_set_a_prize(self):
        self.check()
        self.client.post("/api/customers/", {
            "session": "s", "phone": "9845011111", "reward": "smart-watch",
            "poster": jpeg("poster.jpg"),
        })
        self.assertEqual(Customer.objects.get().reward, "")

    def test_branch_stats_qr_and_customer_filter(self):
        self.spin(self.token(self.check()))
        Customer.objects.create(phone="9845022222", session="other")
        self.client.force_login(self.staff)
        pk = self.branch.pk
        stats = self.client.get(f"/api/admin/branches/{pk}/stats/").json()
        self.assertEqual((stats["customers"], stats["gifts"]), (1, 1))
        qr = self.client.get(f"/api/admin/branches/{pk}/qr/?download=1")
        self.assertEqual(qr["Content-Type"], "image/png")
        self.assertIn("SKY-anna-nagar-QR.png", qr["Content-Disposition"])
        self.assertTrue(qr.content.startswith(b"\x89PNG"))
        listed = self.client.get(f"/api/admin/customers/?branch={pk}").json()
        self.assertEqual([c["phone"] for c in listed["results"]], ["9845011111"])

    def test_deleting_a_branch_keeps_its_customers(self):
        self.check()
        self.client.force_login(self.staff)
        self.assertEqual(self.client.delete(f"/api/admin/branches/{self.branch.pk}/").status_code, 204)
        c = Customer.objects.get(phone="9845011111")
        self.assertIsNone(c.branch)
        self.assertEqual(c.branch_name, "Anna Nagar")

    def test_branch_admin_needs_staff(self):
        self.assertEqual(self.client.get("/api/admin/branches/").status_code, 403)

    def test_database_download_is_staff_only_sql(self):
        self.check()
        self.assertEqual(self.client.get("/api/admin/backup.sql").status_code, 403)
        self.client.force_login(self.staff)
        res = self.client.get("/api/admin/backup.sql")
        self.assertIn(".sql", res["Content-Disposition"])
        sql = b"".join(res.streaming_content).decode()
        self.assertIn("CREATE TABLE", sql)
        self.assertIn("9845011111", sql)


@override_settings(MEDIA_ROOT=MEDIA, STUDIO_URL="https://studio.example")
class ReliabilityTests(TestCase):
    """Ported from an audit of the original studio code."""

    def setUp(self):
        cache.clear()
        patcher = patch.object(RepeatThrottle, "get_rate", lambda self: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.staff = User.objects.create_user("staff2@sky.in", password="x", is_staff=True)

    def upload(self, **extra):
        return self.client.post("/api/customers/", {"session": "s1", "poster": jpeg("poster.jpg"), **extra})

    def test_blank_values_are_null_so_unique_keys_allow_many(self):
        Customer.objects.create(session="a", phone="", imei="", invoice_number="")
        Customer.objects.create(session="b", phone="", imei="", invoice_number="")
        self.assertEqual(Customer.objects.filter(imei__isnull=True).count(), 2)

    def test_database_refuses_a_duplicate_imei(self):
        from django.db import IntegrityError

        Customer.objects.create(session="a", phone="9845011111", imei=IMEI)
        with self.assertRaises(IntegrityError):
            Customer.objects.create(session="b", phone="9845022222", imei=IMEI)

    def test_poster_only_upload_keeps_the_selfie_preview(self):
        self.assertEqual(self.upload(selfie=jpeg("selfie.jpg")).status_code, 201)
        thumb = Customer.objects.get().selfie_thumb.name
        self.assertEqual(self.upload().status_code, 200)
        c = Customer.objects.get()
        self.assertEqual(c.selfie_thumb.name, thumb)
        self.assertTrue(c.selfie_thumb.storage.exists(thumb))

    def test_csv_cells_cannot_run_as_formulas(self):
        Customer.objects.create(session="x", phone="9845011111", name="=HYPERLINK(\"http://bad\")")
        self.client.force_login(self.staff)
        body = self.client.get("/api/admin/customers/export/").content.decode()
        self.assertIn("'=HYPERLINK", body)

    def test_junk_filter_ids_are_client_errors(self):
        self.client.force_login(self.staff)
        for path in ("customers/?branch=x", "customers/?mirror=-1", "customers/?branch=1e9"):
            self.assertEqual(self.client.get("/api/admin/" + path).status_code, 400, path)

    def test_reorder_validates_ids(self):
        self.client.force_login(self.staff)
        for ids in ("1", [1, 1], [0], ["1"], [True]):
            res = self.client.post("/api/admin/mirrors/reorder/", {"ids": ids}, content_type="application/json")
            self.assertEqual(res.status_code, 400, ids)

    def test_locked_login_never_checks_the_password(self):
        for key in ("login-fail:ip:127.0.0.1", "login-fail:user:staff2@sky.in"):
            cache.set(key, 99)
        with patch("django.contrib.auth.forms.authenticate") as authenticate:
            res = self.client.post("/sky/mirror/admin/login/", {"username": "staff2@sky.in", "password": "x"})
        authenticate.assert_not_called()
        self.assertContains(res, "Too many failed sign-ins")
