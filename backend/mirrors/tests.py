import io
import json
import random
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from .models import Branch, Customer

MEDIA = tempfile.mkdtemp()


def jpeg(name="selfie.jpg"):
    out = io.BytesIO()
    Image.new("RGB", (640, 800), (180, 120, 90)).save(out, "JPEG")
    return SimpleUploadedFile(name, out.getvalue(), content_type="image/jpeg")


def face(seed):
    rng = random.Random(seed)
    return [round(rng.uniform(-0.2, 0.2), 5) for _ in range(128)]


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

    def register(self, phone, branch=None):
        body = {"phone": phone, "consent": True}
        if branch:
            body["branch"] = branch
        return self.client.post("/api/customers/register/", body, content_type="application/json")

    def spin(self, phone, seed, branch=None, selfie=True):
        data = {"phone": phone, "face": json.dumps(face(seed))}
        if selfie:
            data["selfie"] = jpeg()
        if branch:
            data["branch"] = branch
        return self.client.post("/api/customers/spin/", data)

    def test_slug_and_link_are_generated(self):
        self.assertEqual(self.branch.slug, "anna-nagar")
        self.client.force_login(self.staff)
        data = self.client.get("/api/admin/branches/").json()
        self.assertEqual(data[0]["link"], "https://studio.example/?branch=anna-nagar")

    def test_customer_signed_in_through_a_branch_link_is_filed_there(self):
        self.assertEqual(self.register("9845011111", "anna-nagar").status_code, 201)
        c = Customer.objects.get(phone="9845011111")
        self.assertEqual((c.branch, c.branch_name), (self.branch, "Anna Nagar"))

    def test_first_branch_keeps_the_customer(self):
        other = Branch.objects.create(name="T Nagar")
        self.register("9845011111", "anna-nagar")
        self.register("9845011111", other.slug)
        self.assertEqual(Customer.objects.get(phone="9845011111").branch, self.branch)

    def test_switched_off_branch_link_is_refused(self):
        self.branch.is_active = False
        self.branch.save()
        res = self.register("9845011111", "anna-nagar")
        self.assertEqual(res.status_code, 400)
        self.assertIn("no longer active", res.json()["branch"][0])
        self.assertEqual(self.client.get("/api/branches/anna-nagar/").status_code, 404)

    def test_public_lookup_gives_the_branch_name(self):
        self.assertEqual(
            self.client.get("/api/branches/anna-nagar/").json(),
            {"slug": "anna-nagar", "name": "Anna Nagar"},
        )

    def test_no_photo_no_spin(self):
        self.register("9845011111", "anna-nagar")
        res = self.spin("9845011111", 1, selfie=False)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Take your selfie first", res.json()["selfie"][0])
        self.assertEqual(Customer.objects.get(phone="9845011111").reward, "")

    def test_no_face_no_spin(self):
        self.register("9845011111")
        res = self.client.post("/api/customers/spin/", {"phone": "9845011111", "selfie": jpeg()})
        self.assertEqual(res.status_code, 400)
        self.assertIn("couldn't see your face", res.json()["face"][0])

    def test_spin_stores_the_selfie_under_the_branch(self):
        self.register("9845011111")
        res = self.spin("9845011111", 1, branch="anna-nagar")
        self.assertEqual(res.status_code, 200)
        c = Customer.objects.get(phone="9845011111")
        self.assertTrue(c.reward and c.selfie and c.selfie_thumb)
        self.assertEqual(c.branch, self.branch)

    def test_same_face_new_number_gets_no_second_gift(self):
        self.register("9845011111")
        self.register("9845022222")
        self.spin("9845011111", 1)
        res = self.spin("9845022222", 1)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(Customer.objects.get(phone="9845022222").reward, "")

    def test_branch_stats_qr_and_customer_filter(self):
        self.register("9845011111", "anna-nagar")
        self.register("9845022222")
        self.spin("9845011111", 1)
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
        self.register("9845011111", "anna-nagar")
        self.client.force_login(self.staff)
        self.assertEqual(self.client.delete(f"/api/admin/branches/{self.branch.pk}/").status_code, 204)
        c = Customer.objects.get(phone="9845011111")
        self.assertIsNone(c.branch)
        self.assertEqual(c.branch_name, "Anna Nagar")

    def test_branch_admin_needs_staff(self):
        self.assertEqual(self.client.get("/api/admin/branches/").status_code, 403)
