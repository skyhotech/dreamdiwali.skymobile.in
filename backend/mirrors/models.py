import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify

# Frontend renders posters in a fixed 1080 × 1920 design space.
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920


def default_selfie_rect():
    return {"x": 184, "y": 165, "w": 712, "h": 950}


def default_product_rect():
    return {"x": 337, "y": 1215, "w": 405, "h": 245}


def validate_rect(value):
    if not isinstance(value, dict) or set(value) != {"x", "y", "w", "h"}:
        raise ValidationError("Rect must have exactly x, y, w and h.")
    try:
        x, y, w, h = (int(value[k]) for k in ("x", "y", "w", "h"))
    except (TypeError, ValueError):
        raise ValidationError("Rect values must be integers.")
    if w < 20 or h < 20:
        raise ValidationError("Rect must be at least 20 × 20.")
    if x < 0 or y < 0 or x + w > CANVAS_WIDTH or y + h > CANVAS_HEIGHT:
        raise ValidationError(
            f"Rect must fit inside the {CANVAS_WIDTH} × {CANVAS_HEIGHT} canvas."
        )


def artwork_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"mirrors/{instance.slug or 'mirror'}-{uuid.uuid4().hex[:8]}.{ext}"


def customer_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"customers/{uuid.uuid4().hex}.{ext}"


class Mirror(models.Model):
    slug = models.SlugField(unique=True, max_length=60, blank=True)
    name = models.CharField(max_length=80)
    subtitle = models.CharField(max_length=160, blank=True)
    artwork = models.ImageField(upload_to=artwork_path)
    bg = models.CharField(max_length=9, default="#f7e7cc")
    ink = models.CharField(max_length=9, default="#3c2418")
    gold = models.CharField(max_length=9, default="#d6a447")
    accent = models.CharField(max_length=9, default="#d22856")
    light = models.BooleanField(default=True)
    arch = models.BooleanField(default=True)
    selfie = models.JSONField(default=default_selfie_rect, validators=[validate_rect])
    product = models.JSONField(default=default_product_rect, validators=[validate_rect])
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:50] or "mirror"
            slug, n = base, 2
            while Mirror.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        # Freshly uploaded artwork is shrunk to the 1080 × 1920 poster size.
        if self.artwork and not getattr(self.artwork, "_committed", True):
            from .images import FRAME_SIZE, optimized

            small = optimized(
                self.artwork.file, FRAME_SIZE, quality=88, name=self.artwork.name,
                only_if_smaller=True,
            )
            if small:
                self.artwork = small
        super().save(*args, **kwargs)


class Branch(models.Model):
    """A SKY store. Its studio link (…/?branch=<slug>) files every customer,
    selfie and prize from that link under this branch."""

    slug = models.SlugField(unique=True, max_length=60, blank=True)
    name = models.CharField(max_length=80)
    address = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    # An inactive branch's link and QR code stop working.
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:50] or "branch"
            slug, n = base, 2
            while Branch.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)


class SpinItem(models.Model):
    """A gift on the wheel. A customer can win it when their bill falls inside
    min_bill..max_bill (no max_bill = no upper limit); weight sets how likely
    it is against the other gifts in that range."""

    slug = models.SlugField(unique=True, max_length=40, blank=True)
    name = models.CharField(max_length=40)
    image = models.ImageField(upload_to=customer_path, blank=True)
    min_bill = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_bill = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    weight = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["min_bill", "name", "id"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:34] or "gift"
            slug, n = base, 2
            while SpinItem.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)

    @classmethod
    def for_bill(cls, bill):
        """Gifts this bill can win. A bill outside every range gets the highest
        range below it, so a customer is never left without a wheel."""
        items = list(cls.objects.filter(is_active=True))
        if bill is None:
            return items
        matching = [
            i for i in items
            if i.min_bill <= bill and (i.max_bill is None or bill <= i.max_bill)
        ]
        if matching:
            return matching
        below = [i for i in items if i.min_bill <= bill]
        if not below:
            return items
        top = max(i.min_bill for i in below)
        return [i for i in below if i.min_bill == top]


class Customer(models.Model):
    # Selfie id from the studio (or "phone-<number>" for registered customers),
    # so re-exporting a poster updates one record.
    session = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=80, blank=True)
    # One customer per mobile number; blank for records made before sign-in.
    phone = models.CharField(max_length=20, blank=True)
    mirror = models.ForeignKey(
        Mirror, null=True, blank=True, on_delete=models.SET_NULL, related_name="customers"
    )
    # Kept so the record still says which theme was used if the mirror is deleted.
    mirror_name = models.CharField(max_length=80, blank=True)
    # Store whose link the customer came through; the name is kept if the
    # branch is later deleted.
    branch = models.ForeignKey(
        Branch, null=True, blank=True, on_delete=models.SET_NULL, related_name="customers"
    )
    branch_name = models.CharField(max_length=80, blank=True)
    # Spin-the-wheel prize id from the studio (e.g. "smart-watch").
    reward = models.CharField(max_length=40, blank=True)
    # When the customer agreed to storing their selfie and face fingerprint.
    consent_at = models.DateTimeField(null=True, blank=True)
    # Face fingerprint from earlier versions (face matching is off); kept as
    # history. Formerly used only to
    # spot one person spinning with several mobile numbers.
    face = models.JSONField(null=True, blank=True)
    # Earlier customer with the same face; this one received that prize.
    repeat_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="repeats"
    )
    # Purchase details entered by the store manager.
    email = models.EmailField(blank=True)
    product_details = models.CharField(max_length=160, blank=True)
    # 15-digit IMEI for phones, the serial number for other products.
    imei = models.CharField(max_length=30, blank=True)
    invoice_number = models.CharField(max_length=40, blank=True)
    bill_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    invoice_image = models.ImageField(upload_to=customer_path, blank=True)
    # Every word read from the invoice photo, and how sharp that photo was.
    ocr_text = models.TextField(blank=True)
    blur_score = models.FloatField(null=True, blank=True)
    # Counts how often the link changed because the purchase details changed.
    link_version = models.PositiveIntegerField(default=0)
    # Secret in the WhatsApp link; only its holder can spin for this customer.
    spin_token = models.CharField(max_length=43, null=True, blank=True, unique=True)
    selfie = models.ImageField(upload_to=customer_path, blank=True)
    poster = models.ImageField(upload_to=customer_path, blank=True)
    # Small previews for the dashboard grid; full images open on click.
    selfie_thumb = models.ImageField(upload_to=customer_path, blank=True)
    poster_thumb = models.ImageField(upload_to=customer_path, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["phone"],
                condition=~models.Q(phone=""),
                name="unique_customer_phone",
            ),
            models.UniqueConstraint(
                fields=["imei"],
                condition=~models.Q(imei=""),
                name="unique_customer_imei",
            ),
            models.UniqueConstraint(
                fields=["branch", "invoice_number"],
                condition=~models.Q(invoice_number=""),
                name="unique_branch_invoice",
            ),
        ]

    def __str__(self):
        return self.name or self.phone or f"Customer #{self.pk}"

    @property
    def stage(self):
        """How far this customer got; anything but "completed" is abandoned."""
        if self.poster:
            return "completed"
        if self.reward:
            return "spun"
        kinds = {e.kind for e in self.events.all()}
        if "link_opened" in kinds:
            return "link_opened"
        return "whatsapp_sent" if "whatsapp_sent" in kinds else "checked"


class CustomerEvent(models.Model):
    """One step of a purchase's journey, for the admin timeline. Failed checks
    have no customer yet, so they keep the number that was typed."""

    SHARE_KINDS = [
        "shared_instagram", "shared_facebook", "shared_whatsapp", "shared_more",
    ]

    customer = models.ForeignKey(
        Customer, null=True, blank=True, on_delete=models.CASCADE, related_name="events"
    )
    phone = models.CharField(max_length=20, blank=True)
    kind = models.CharField(max_length=30, db_index=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
