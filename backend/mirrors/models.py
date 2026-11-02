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


# Spin-the-wheel prizes; ids match REWARDS in src/lib/rewards.ts.
REWARD_IDS = [
    "neckband", "mini-speaker", "smart-watch",
    "wired-headphone", "mobile-stand", "power-bank",
]


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
    # 128-number face fingerprint from the selfie (face-api), used only to
    # spot one person spinning with several mobile numbers.
    face = models.JSONField(null=True, blank=True)
    # Earlier customer with the same face; this one received that prize.
    repeat_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="repeats"
    )
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
            )
        ]

    def __str__(self):
        return self.name or self.phone or f"Customer #{self.pk}"
