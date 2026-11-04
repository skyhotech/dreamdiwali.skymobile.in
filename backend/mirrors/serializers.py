from django.conf import settings
from rest_framework import serializers

import re
from urllib.parse import urlsplit

from .models import Branch, Customer, CustomerEvent, Mirror, SpinItem, validate_rect


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

    def to_representation(self, obj):
        return _local_images(super().to_representation(obj))

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
    sales = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True, default=0)
    link = serializers.SerializerMethodField()
    journey = serializers.SerializerMethodField()

    def get_link(self, obj):
        return branch_link(obj)

    def get_journey(self, obj):
        return self.context.get("journey", {}).get(obj.pk, {})

    def validate_image(self, image):
        return _limit_size(image) if image else image

    def to_representation(self, obj):
        return _local_images(super().to_representation(obj))

    def validate_slug(self, value):
        if value and Branch.objects.filter(slug=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("Another branch already uses this link id.")
        return value

    class Meta:
        model = Branch
        fields = [
            "id", "slug", "name", "address", "phone", "image", "is_active",
            "customer_count", "sales", "journey", "link", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class PublicBranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        # The store number is printed on its invoices: it picks the branch.
        fields = ["slug", "name", "phone"]


def _local_images(data):
    """Images load from whichever site shows the page: a full VPS address would
    skip Vercel's cache."""
    return {
        key: urlsplit(value).path if isinstance(value, str) and "/media/" in value else value
        for key, value in data.items()
    }


BUILT_IN_GIFTS = {
    "neckband", "mini-speaker", "smart-watch", "wired-headphone", "mobile-stand", "power-bank",
}


class SpinItemSerializer(serializers.ModelSerializer):
    def validate(self, data):
        low = data.get("min_bill", getattr(self.instance, "min_bill", 0))
        high = data.get("max_bill", getattr(self.instance, "max_bill", None))
        if high is not None and high < low:
            raise serializers.ValidationError({"max_bill": ["Must be above the minimum bill."]})
        return data

    def validate_image(self, image):
        return _limit_size(image) if image else image

    def to_representation(self, obj):
        data = _local_images(super().to_representation(obj))
        # The starting gifts use the pictures that ship with the code.
        if not data["image"] and obj.slug in BUILT_IN_GIFTS:
            data["image"] = f"/static/mirrors/rewards/{obj.slug}.webp"
        return data

    class Meta:
        model = SpinItem
        fields = ["id", "slug", "name", "image", "min_bill", "max_bill", "weight", "is_active"]
        read_only_fields = ["slug"]


def wheel_items(items):
    """What the customer's wheel shows."""
    return [
        {"id": i.slug, "label": i.name, "image": i.image.url if i.image else ""}
        for i in items
    ]


def reward_progress(customer, kinds):
    """Every check the reward depends on, and whether it is done."""
    return {
        "instagram_post": "posted_instagram" in kinds,
        "instagram_follow": customer.follow_proof_status or "",
        "whatsapp_status": customer.whatsapp_proof_status or "",
        "google_review_opened": "google_review_opened" in kinds,
        "ready": "posted_instagram" in kinds
        and customer.follow_proof_status == "verified"
        and customer.whatsapp_proof_status == "verified",
    }


class CustomerSerializer(serializers.ModelSerializer):
    mirror_slug = serializers.CharField(source="mirror.slug", read_only=True, default=None)
    has_face = serializers.SerializerMethodField()
    repeat_of_phone = serializers.CharField(source="repeat_of.phone", read_only=True, default=None)
    stage = serializers.CharField(read_only=True)
    progress = serializers.SerializerMethodField()

    def get_progress(self, obj):
        return reward_progress(obj, {e.kind for e in obj.events.all()})
    shared_on = serializers.SerializerMethodField()
    posts = serializers.SerializerMethodField()

    def get_shared_on(self, obj):
        """Platforms whose share button this customer pressed, with counts."""
        counts = {}
        for e in obj.events.all():
            if e.kind in CustomerEvent.SHARE_KINDS:
                platform = e.kind.removeprefix("shared_")
                counts[platform] = counts.get(platform, 0) + 1
        return counts

    def get_posts(self, obj):
        """Links customers pasted as proof that they posted."""
        return [
            {"platform": e.kind.removeprefix("posted_"), "url": e.detail.get("url", "")}
            for e in obj.events.all() if e.kind in CustomerEvent.POSTED_KINDS
        ]

    def get_has_face(self, obj):
        return bool(obj.face)

    def to_representation(self, obj):
        return _local_images(super().to_representation(obj))

    class Meta:
        model = Customer
        fields = [
            "id", "session", "name", "phone", "mirror", "mirror_slug",
            "mirror_name", "reward", "selfie", "poster", "created_at", "updated_at",
            "consent_at", "has_face", "repeat_of", "repeat_of_phone",
            "poster_thumb", "selfie_thumb", "branch", "branch_name",
            "email", "product_details", "imei", "invoice_number", "bill_value",
            "invoice_image", "blur_score", "link_version", "stage", "shared_on", "posts", "facebook_profile", "whatsapp_proof", "whatsapp_proof_status", "follow_proof", "follow_proof_status", "progress", "rating", "review", "terms_accepted_at", "video_review", "instagram_id",
        ]
        read_only_fields = fields


class CustomerEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerEvent
        fields = ["id", "kind", "detail", "phone", "created_at"]


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


class TermsSerializer(SpinSerializer):
    accept = serializers.BooleanField()
    video_review = serializers.BooleanField(default=False)
    instagram_id = serializers.RegexField(
        r"^@?[A-Za-z0-9._]{1,30}$", required=False, allow_blank=True,
        error_messages={"invalid": "Enter a valid Instagram ID."},
    )

    def validate(self, data):
        if not data["accept"]:
            raise serializers.ValidationError({"accept": ["Please accept the terms and conditions."]})
        if data["video_review"] and not data.get("instagram_id"):
            raise serializers.ValidationError({"instagram_id": ["Enter your Instagram ID."]})
        return data


class ReviewSerializer(SpinSerializer):
    rating = serializers.IntegerField(
        min_value=1, max_value=5, error_messages={"required": "Please choose a star rating."}
    )
    review = serializers.CharField(max_length=1000, required=False, allow_blank=True)


# A real Instagram post, reel or story address.
INSTAGRAM_POST = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:p|reel|reels|tv|stories/[A-Za-z0-9._]+|[A-Za-z0-9._]+/(?:p|reel))/[A-Za-z0-9_-]+",
    re.I,
)


class EventSerializer(SpinSerializer):
    kind = serializers.ChoiceField(
        choices=CustomerEvent.OPEN_KINDS + CustomerEvent.SHARE_KINDS + CustomerEvent.POSTED_KINDS
        + [CustomerEvent.GIFT_UNLOCKED] + CustomerEvent.STEP_KINDS
    )
    # The customer's own post, pasted as proof (posted_* only).
    url = serializers.URLField(max_length=300, required=False, allow_blank=True)

    def validate(self, data):
        kind, url = data["kind"], data.get("url", "")
        if kind == "posted_whatsapp":
            # Recorded only by a Status screenshot upload (CustomerWhatsappProof).
            raise serializers.ValidationError({"kind": ["Upload a screenshot of your WhatsApp Status."]})
        if kind.startswith("posted_") and not url:
            raise serializers.ValidationError({"url": ["Paste the link to your post."]})
        if kind == "posted_instagram" and not INSTAGRAM_POST.match(url):
            raise serializers.ValidationError(
                {"url": ["Paste the link to your Instagram post, reel or story."]}
            )
        return data


class ProfileSerializer(SpinSerializer):
    platform = serializers.ChoiceField(choices=["instagram", "facebook"])
    handle = serializers.CharField(max_length=200)

    def validate(self, data):
        handle = data["handle"].strip()
        if data["platform"] == "instagram":
            handle = re.sub(r"^(?:https?://)?(?:www\.)?instagram\.com/", "", handle).strip("/@ ")
            if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle):
                raise serializers.ValidationError({"handle": ["Enter a valid Instagram ID."]})
        elif not re.search(r"facebook\.com/|fb\.com/|^[A-Za-z0-9.]{5,}$", handle):
            raise serializers.ValidationError({"handle": ["Enter your Facebook profile link."]})
        data["handle"] = handle
        return data


# Letters a scanner confuses with digits count as the same character.
_OCR_ALIKE = str.maketrans("OILSB", "01158")


def _compact(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper()).translate(_OCR_ALIKE)


# The value printed after the label, e.g. "Invoice No : SI2627VLR31054".
_INVOICE_LABEL = re.compile(
    r"invoice\s*(?:no|number|num)\b\s*[.:;\-]*\s*([A-Z0-9][A-Z0-9/\-]{3,})", re.I
)


# Same idea for "IMEI NO: P-12568801-D"; a bill can list several.
_IMEI_LABEL = re.compile(
    r"(?:imei|serial)\s*(?:no|number|num)?\b\s*[.:;\-]*\s*([A-Z0-9][A-Z0-9_\-]{3,})", re.I
)


# Everything after "Invoice No" up to the date: a scan may split the number.
_INVOICE_LINE = re.compile(r"invoice\s*(?:no|number|num)\b\s*[.:;\-]*\s*(.+?)(?:\s+invoice\s*date|\s+date\b|$)", re.I | re.M)


def _swap_cost(a, b):
    """Scans misread letters, not digits: one digit read as another would let
    the next invoice (…31055 for …31054) pass, so it is never forgiven."""
    if a == b:
        return 0
    return 99 if a.isdigit() and b.isdigit() else 1


def _gap_cost(ch):
    """A dropped or extra letter is a misread; a dropped or extra digit would
    turn one invoice number into another, so it is never forgiven."""
    return 99 if ch.isdigit() else 1


def _fuzzy_in(want, text, slack):
    """True when `want` appears in `text` with at most `slack` characters
    wrong, missing or extra: approximate substring search (Sellers)."""
    if not want:
        return False
    previous = [0] * (len(text) + 1)  # a match may start anywhere in text
    for i, ch in enumerate(want, 1):
        current = [i] + [0] * len(text)
        for j, tc in enumerate(text, 1):
            current[j] = min(
                previous[j - 1] + _swap_cost(ch, tc),
                previous[j] + _gap_cost(ch),  # a character the scan dropped
                current[j - 1] + _gap_cost(tc),  # one it added
            )
        previous = current
    return min(previous) <= slack


def _slack(want):
    """Characters a phone-photo scan may get wrong: 1 in short values, 2 in long."""
    return 0 if len(want) < 6 else 1 if len(want) < 10 else 2


def _printed(text, labelled, typed):
    """True when the value printed at its label (or, with no label, anywhere)
    matches what was typed, allowing the few misread characters of a photo."""
    want = _compact(typed)
    if len(want) < 4:
        return False
    places = [_compact(v) for v in labelled] if labelled else [_compact(text)]
    return any(_fuzzy_in(want, place, _slack(want)) for place in places)


def invoice_imeis(text):
    """The phone IMEIs on a bill: 15-digit numbers that pass the IMEI check,
    found by their digits so a garbled "IMEI NO" label doesn't matter."""
    runs = re.findall(r"\d{15,}", re.sub(r"(?<=\d)[ -](?=\d)", "", text))
    # PDFs can run the IMEI straight into the next column (its HSN code), so a
    # longer run is checked at its start and its end as well.
    found = []
    for run in runs:
        for n in {run[:15], run[-15:]} if len(run) > 15 else {run}:
            if imei_valid(n):
                found.append(n)
    return list(dict.fromkeys(found))


def _same_phone(typed, printed):
    """A dual-SIM phone has two IMEIs: same 8-digit model code (TAC), serials a
    few apart. The box may show one while the bill lists the other."""
    if typed == printed:
        return True
    if not (len(typed) == 15 and typed.isdigit() and imei_valid(typed)):
        return False
    return typed[:8] == printed[:8] and abs(int(typed[8:14]) - int(printed[8:14])) <= 10


def invoice_shows(text):
    """What the bill itself says, to tell the manager what to correct."""
    number = _INVOICE_LINE.findall(text)[:1]
    at = re.search(r"billed\s*to", text, re.I)
    phone = re.search(r"ph\w*\s*[.:;\-]*\s*(?:\+?91)?(\d{10})", text[at.start():] if at else text, re.I)
    return {
        "invoice number": re.sub(r"\s+", "", number[0]).split("Invoice")[0] if number else "",
        "IMEI": ", ".join(invoice_imeis(text)),
        "mobile number": phone[1] if phone else "",
    }


def looks_like_invoice(text):
    """A SKY bill names itself and its customer; a QR poster or a photo of the
    box doesn't."""
    words = len(re.findall(r"tax\s*invoice|invoice\s*no|billed\s*to|gstin|net\s*total", text, re.I))
    return words >= 2


def invoice_missing(text, data):
    """Which typed details don't match the bill: invoice number, IMEI or serial,
    and the customer's number under Billed To. Each is read from its place.
    Kept in sync with invoiceMissing in src/lib/invoiceScan.ts."""
    missing = []
    if not _printed(text, _INVOICE_LINE.findall(text)[:1], data["invoice_number"]):
        missing.append("invoice number")
    # Only phones carry a 15-digit IMEI; for other products there is nothing
    # to check, and the form hides the field.
    phone_imeis = invoice_imeis(text)
    if phone_imeis and not any(_same_phone(data.get("imei", ""), n) for n in phone_imeis):
        missing.append("IMEI")
    at = re.search(r"billed\s*to", text, re.I)
    phone = re.search(r"ph\w*\s*[.:;\-]*\s*((?:\+?91)?\d{10})", text[at.start():] if at else text, re.I)
    if not (phone[1].endswith(data["phone"]) if phone else data["phone"] in text):
        missing.append("mobile number")
    return missing


NOT_AN_INVOICE = (
    "This doesn't look like a SKY invoice. Please upload the invoice PDF or a "
    "clear photo of the whole bill."
)


# Only purchases of at least this much get a spin link. Kept in sync with
# MIN_BILL in src/components/ManagerIntake.tsx.
MIN_BILL = 10000
BELOW_MIN_BILL = (
    "This bill is below ₹10,000. Only purchases of ₹10,000 or more qualify "
    "for the spin wheel, so a gift link cannot be sent to this customer."
)


class CustomerIntakeSerializer(serializers.Serializer):
    """What the store manager submits; fields are refused with a plain reason."""

    name = serializers.CharField(max_length=80)
    phone = serializers.RegexField(
        PHONE_REGEX, error_messages={"invalid": "Enter a valid 10-digit mobile number."}
    )
    email = serializers.EmailField(required=False, allow_blank=True)
    product_details = serializers.CharField(max_length=160)
    # Phones only: blank when the bill has no 15-digit IMEI (TVs and others).
    imei = serializers.CharField(max_length=30, required=False, allow_blank=True)

    def validate_imei(self, value):
        value = re.sub(r"\s", "", value)
        if value and not (re.fullmatch(r"\d{15}", value) and imei_valid(value)):
            raise serializers.ValidationError("This IMEI number is not valid.")
        return value
    invoice_number = serializers.CharField(max_length=40)
    bill_value = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=MIN_BILL,
        error_messages={"min_value": BELOW_MIN_BILL},
    )
    branch = serializers.CharField(max_length=60)
    # The invoice as Django itself read it (see ManagerScan): never text
    # sent from the phone.
    scan = serializers.CharField(
        max_length=64,
        error_messages={"required": "Please upload the invoice again.", "blank": "Please upload the invoice again."},
    )
    blur_score = serializers.FloatField(min_value=0)

    def validate_invoice_number(self, value):
        from .extract import normalize_invoice_number

        return normalize_invoice_number(value)

    def validate(self, data):
        from django.core.cache import cache

        text = cache.get(f"invoice-scan:{data['scan']}")
        if text is None:
            raise serializers.ValidationError(
                {"invoice_image": ["Please upload the invoice again."]}
            )
        data["ocr_text"] = text
        if not invoice_imeis(text):
            data["imei"] = ""  # not a phone: no IMEI to keep or check
        elif not data.get("imei"):
            raise serializers.ValidationError({"imei": ["Enter the IMEI shown on the invoice."]})
        if not looks_like_invoice(text):
            raise serializers.ValidationError({"invoice_image": [NOT_AN_INVOICE]})
        missing = invoice_missing(text, data)
        if missing:
            shows = invoice_shows(text)
            hints = [f"{m} {shows[m]}" for m in missing if shows.get(m)]
            message = f"Invoice does not show this {' or '.join(missing)}."
            if hints:
                message += f" The bill shows {'; '.join(hints)}."
            raise serializers.ValidationError({"invoice_image": [message]})
        return data


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
    branch = serializers.CharField(max_length=60, required=False, allow_blank=True)


class ApprovalSerializer(CustomerIntakeSerializer):
    """An admin's manual approval of a refused check: the details as the admin
    corrected them. The invoice comparison is the admin's own judgement."""

    scan = serializers.CharField(required=False, allow_blank=True)
    blur_score = serializers.FloatField(required=False, default=0)

    def validate(self, data):
        data["ocr_text"] = ""
        return data
