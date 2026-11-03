import io
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

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
            "branch": "anna-nagar", "blur_score": 200,
            "ocr_text": bill_text(phone, imei), **extra,
        }
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

    def test_serial_may_be_all_digits(self):
        res = self.check(imei="12568801", ocr_text=bill_text("9845011111", "12568801"),
                         invoice_number="INV-12568801")
        self.assertEqual(res.status_code, 200)

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
        self.assertEqual([i["label"] for i in link["items"]], ["Watch"])
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

    def test_tv_serial_is_read_from_the_imei_label(self):
        text = bill_text("9845011111", "P-12568801-D", "SI2627VLR31054")
        res = self.check(imei="P-12568801-D", invoice_number="SI2627VLR31054", ocr_text=text)
        self.assertEqual(res.status_code, 200)

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

    def test_imei_is_not_validated(self):
        self.assertEqual(self.check(imei="anything").status_code, 200)

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
            {"slug": "anna-nagar", "name": "Anna Nagar"},
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
