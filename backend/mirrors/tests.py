import io
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from .models import Branch, Customer, CustomerEvent

MEDIA = tempfile.mkdtemp()
IMEI = "490154203237518"
OTHER_IMEI = "356938035643809"


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
        self.branch = Branch.objects.create(name="Anna Nagar")
        self.staff = User.objects.create_user("staff@sky.in", password="x", is_staff=True)

    def check(self, phone="9845011111", imei=IMEI, **extra):
        body = {
            "name": "Asha", "phone": phone, "product_details": "Phone 15", "imei": imei,
            "invoice_number": f"INV-{imei}", "bill_value": "24999.00",
            "branch": "anna-nagar", "invoice_image": jpeg("invoice.jpg"), "blur_score": 200,
            "ocr_text": f"Bill INV-{imei} IMEI {imei} Total 24,999.00", **extra,
        }
        return self.client.post("/api/manager/check/", body)

    def token(self, res):
        return res.json()["link"].split("spin=")[1]

    def spin(self, token):
        return self.client.post(
            "/api/customers/spin/", {"token": token}, content_type="application/json"
        )

    def test_slug_and_link_are_generated(self):
        self.assertEqual(self.branch.slug, "anna-nagar")
        self.client.force_login(self.staff)
        data = self.client.get("/api/admin/branches/").json()
        self.assertEqual(data[0]["link"], "https://studio.example/?branch=anna-nagar")

    def test_check_files_the_customer_and_returns_a_link(self):
        res = self.check()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["link"].startswith("https://studio.example/?spin="))
        c = Customer.objects.get(phone="9845011111")
        self.assertEqual((c.branch, c.branch_name, c.imei), (self.branch, "Anna Nagar", IMEI))
        self.assertTrue(c.invoice_image)

    def test_invoice_text_must_match_and_failures_are_tracked(self):
        res = self.check(ocr_text="Invoice IMEI Total 100.00")
        self.assertEqual(res.status_code, 400)
        self.assertIn("invoice number", res.json()["invoice_image"][0])
        self.assertEqual(CustomerEvent.objects.get().kind, "check_failed")

    def test_labelled_invoice_number_must_match_exactly(self):
        text = f"Invoice No : SI2627VLR31054 Invoice Date : 31/10/2026 IMEI NO: {IMEI}"
        ok = self.check(invoice_number="SI2627VLR31054", ocr_text=text)
        self.assertEqual(ok.status_code, 200)
        bad = self.check("9845022222", OTHER_IMEI, invoice_number="SI2627VLR31055", ocr_text=text)
        self.assertEqual(bad.status_code, 400)

    def test_tv_serial_is_read_from_the_imei_label(self):
        text = "Invoice No : SI2627VLR31054\nIMEI NO: P-12568801-D\n"
        res = self.check(imei="P-12568801-D", invoice_number="SI2627VLR31054", ocr_text=text)
        self.assertEqual(res.status_code, 200)

    def test_scanner_letter_mixups_still_match(self):
        res = self.check(ocr_text=f"lNV-{IMEI.replace('0', 'O')}")
        self.assertEqual(res.status_code, 200)

    def test_changed_details_replace_the_link(self):
        first = self.token(self.check())
        second = self.token(self.check(bill_value="24999.00", product_details="Phone 16"))
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
            ["checked", "whatsapp_sent", "link_opened", "spun", "shared_whatsapp"],
        )
        self.assertIn("IMEI", data["ocr_text"])
        funnel = self.client.get("/api/admin/stats/").json()["funnel"]
        self.assertEqual((funnel["spun"], funnel["shared"]), (1, 1))

    def test_invalid_imei_is_refused(self):
        res = self.check(imei="490154203237519")
        self.assertEqual(res.status_code, 400)
        self.assertIn("not valid", res.json()["imei"][0])

    def test_used_imei_or_invoice_is_refused(self):
        self.check()
        self.assertIn("IMEI", self.check("9845022222").json()["imei"][0])
        res = self.check(
            "9845022222", OTHER_IMEI, invoice_number=f"INV-{IMEI}",
            ocr_text=f"INV-{IMEI} {OTHER_IMEI} 24999.00",
        )
        self.assertIn("invoice", res.json()["invoice_number"][0])

    def test_large_invoice_image_is_refused(self):
        big = SimpleUploadedFile("i.jpg", jpeg().read() + b"0" * 260_000, "image/jpeg")
        self.assertEqual(self.check(invoice_image=big).status_code, 400)

    def test_correction_before_spin_updates_the_same_customer(self):
        self.check()
        self.check(name="Asha K")
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
        self.assertEqual(link, {"phone": "9845011111", "reward": first})

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
