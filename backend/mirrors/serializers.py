from django.conf import settings
from rest_framework import serializers

import re
from decimal import Decimal, InvalidOperation

from .models import Branch, Customer, CustomerEvent, Mirror, validate_rect


class RectField(serializers.JSONField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            validate_rect(value)
        except Exception as exc:
            raise serializers.ValidationError(getattr(exc, "messages", [str(exc)]))
        return {k: int(value[k]) for k in ("x", "y", "w", "h")}


class PublicMirrorSerializer(serializers.ModelSerializer):
    """Matches the studio's ``Template`` type in src/templates/index.ts."""

    id = serializers.CharField(source="slug")
    artwork = serializers.SerializerMethodField()

    class Meta:
        model = Mirror
        fields = [
            "id", "name", "subtitle", "bg", "ink", "gold", "accent",
            "light", "arch", "selfie", "product", "artwork",
        ]

    def get_artwork(self, obj):
        # Relative, so it resolves against whatever site serves the studio
        # (Caddy, Vite proxy) instead of the host Django happened to see.
        # The version query busts the studio's image cache when artwork changes.
        return f"{obj.artwork.url}?v={int(obj.updated_at.timestamp())}"

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data.update(
            logo={"x": 0, "y": 0, "w": 0, "h": 0},
            heading={"x": 0, "y": 0},
            animation="quiet",
            fit="cover",
        )
        return data


class MirrorSerializer(serializers.ModelSerializer):
    selfie = RectField()
    product = RectField()
    customer_count = serializers.IntegerField(read_only=True, default=0)

    def validate_artwork(self, image):
        return _limit_size(image)

    class Meta:
        model = Mirror
        fields = [
            "id", "slug", "name", "subtitle", "artwork", "bg", "ink", "gold",
            "accent", "light", "arch", "selfie", "product", "is_active",
            "order", "customer_count", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False}}


def spin_link(token):
    """The address sent to a customer over WhatsApp."""
    return f"{settings.STUDIO_URL}/?spin={token}"


def branch_link(branch):
    """The studio address that files customers under this branch."""
    return f"{settings.STUDIO_URL}/?branch={branch.slug}"


class BranchSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(max_length=60, required=False, allow_blank=True)
    customer_count = serializers.IntegerField(read_only=True, default=0)
    link = serializers.SerializerMethodField()

    def get_link(self, obj):
        return branch_link(obj)

    def validate_slug(self, value):
        if value and Branch.objects.filter(slug=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("Another branch already uses this link id.")
        return value

    class Meta:
        model = Branch
        fields = [
            "id", "slug", "name", "address", "phone", "is_active",
            "customer_count", "link", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class PublicBranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["slug", "name"]


class CustomerSerializer(serializers.ModelSerializer):
    mirror_slug = serializers.CharField(source="mirror.slug", read_only=True, default=None)
    has_face = serializers.SerializerMethodField()
    repeat_of_phone = serializers.CharField(source="repeat_of.phone", read_only=True, default=None)

    def get_has_face(self, obj):
        return bool(obj.face)

    class Meta:
        model = Customer
        fields = [
            "id", "session", "name", "phone", "mirror", "mirror_slug",
            "mirror_name", "reward", "selfie", "poster", "created_at", "updated_at",
            "consent_at", "has_face", "repeat_of", "repeat_of_phone",
            "poster_thumb", "selfie_thumb", "branch", "branch_name",
            "email", "product_details", "imei", "invoice_number", "bill_value",
            "invoice_image", "blur_score", "link_version",
        ]
        read_only_fields = fields


class CustomerEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerEvent
        fields = ["kind", "detail", "phone", "created_at"]


class CustomerDetailSerializer(CustomerSerializer):
    """One customer for the admin: everything, including the journey."""

    events = CustomerEventSerializer(many=True, read_only=True)
    link = serializers.SerializerMethodField()

    def get_link(self, obj):
        return spin_link(obj.spin_token) if obj.spin_token else ""

    class Meta(CustomerSerializer.Meta):
        fields = [*CustomerSerializer.Meta.fields, "ocr_text", "events", "link"]
        read_only_fields = fields


def _phone_regex():
    """Indian mobile (10 digits, starts 6–9) that doesn't look made up.

    Rejects one digit repeated (9999999999), a digit then zeros (9000000000),
    a repeated pair (9898989898) or half (9876598765), and straight counting
    up or down with wrap-around (9876543210, 6789012345). Kept in sync with
    PHONE_PATTERN in src/lib/backend.ts.
    """
    up, down = "0123456789" * 2, "9876543210" * 2
    runs = sorted({up[i:i + 10] for i in range(10)} | {down[i:i + 10] for i in range(10)})
    return (
        r"^(?!(\d)\1{9}$)(?!\d0{9}$)(?!(\d\d)\2{4}$)(?!(\d{5})\3$)"
        rf"(?!(?:{'|'.join(runs)})$)[6-9]\d{{9}}$"
    )


PHONE_REGEX = _phone_regex()


MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def imei_valid(imei):
    """15 digits passing the Luhn check every real IMEI satisfies."""
    if len(imei) != 15 or not imei.isdigit():
        return False
    total = 0
    for i, ch in enumerate(imei):
        n = int(ch) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


class SpinSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=43)


class EventSerializer(SpinSerializer):
    kind = serializers.ChoiceField(choices=CustomerEvent.SHARE_KINDS)


MAX_INVOICE_BYTES = 250 * 1024
# Letters a scanner confuses with digits count as the same character.
_OCR_ALIKE = str.maketrans("OILSB", "01158")


def _compact(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper()).translate(_OCR_ALIKE)


def _amounts(text):
    found = set()
    for token in re.findall(r"\d[\d,]*(?:\.\d{1,2})?", text):
        try:
            found.add(Decimal(token.replace(",", "")))
        except InvalidOperation:
            pass
    return found


def invoice_missing(text, imei, invoice_number, bill_value):
    """Which typed details the invoice text doesn't contain. Kept in sync with
    invoiceMissing in src/lib/invoiceScan.ts."""
    compact = _compact(text)
    missing = []
    if _compact(imei) not in compact:
        missing.append("IMEI")
    if _compact(invoice_number) not in compact:
        missing.append("invoice number")
    if Decimal(bill_value) not in _amounts(text):
        missing.append("bill value")
    return missing


class CustomerIntakeSerializer(serializers.Serializer):
    """What the store manager submits; fields are refused with a plain reason."""

    name = serializers.CharField(max_length=80)
    phone = serializers.RegexField(
        PHONE_REGEX, error_messages={"invalid": "Enter a valid 10-digit mobile number."}
    )
    email = serializers.EmailField(required=False, allow_blank=True)
    product_details = serializers.CharField(max_length=160)
    imei = serializers.CharField(max_length=15)
    invoice_number = serializers.CharField(max_length=40)
    bill_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=1)
    branch = serializers.CharField(max_length=60)
    invoice_image = serializers.ImageField()
    # What the document scanner read; the server repeats the comparison.
    ocr_text = serializers.CharField(max_length=20000, trim_whitespace=False)
    blur_score = serializers.FloatField(min_value=0)

    def validate(self, data):
        missing = invoice_missing(
            data["ocr_text"], data["imei"], data["invoice_number"], data["bill_value"]
        )
        if missing:
            raise serializers.ValidationError(
                {"invoice_image": [f"Invoice does not show this {' or '.join(missing)}."]}
            )
        return data

    def validate_imei(self, value):
        if not imei_valid(value):
            raise serializers.ValidationError("This IMEI number is not valid.")
        return value

    def validate_invoice_image(self, image):
        if image.size > MAX_INVOICE_BYTES:
            raise serializers.ValidationError("Invoice image must be under 250 KB.")
        return _limit_size(image)


def _limit_size(image):
    if image.size > MAX_UPLOAD_BYTES:
        raise serializers.ValidationError("Image is too large (max 12 MB).")
    if getattr(image, "image", None) and image.image.format not in ("PNG", "JPEG", "WEBP"):
        raise serializers.ValidationError("Only PNG, JPEG or WebP images are accepted.")
    return image


class CustomerUploadSerializer(serializers.Serializer):
    session = serializers.CharField(max_length=64)
    mirror = serializers.CharField(max_length=60, required=False, allow_blank=True)
    name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    phone = serializers.RegexField(PHONE_REGEX, required=False)
    reward = serializers.CharField(max_length=40, required=False, allow_blank=True)
    poster = serializers.ImageField(validators=[_limit_size])
    selfie = serializers.ImageField(required=False, validators=[_limit_size])
    branch = serializers.CharField(max_length=60, required=False, allow_blank=True)
