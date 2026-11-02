from rest_framework import serializers

from .models import Customer, Mirror, validate_rect


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
            "poster_thumb", "selfie_thumb",
        ]
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
FACE_SIZE = 128


class PhoneSerializer(serializers.Serializer):
    phone = serializers.RegexField(
        PHONE_REGEX, error_messages={"invalid": "Enter a valid 10-digit mobile number."}
    )


class RegisterSerializer(PhoneSerializer):
    consent = serializers.BooleanField()

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError(
                "Please agree to the photo and face check to continue."
            )
        return value


NO_FACE_MESSAGE = (
    "We couldn't see your face clearly. Please retake your selfie facing the camera."
)


class SpinSerializer(PhoneSerializer):
    face = serializers.ListField(
        child=serializers.FloatField(min_value=-2, max_value=2),
        min_length=FACE_SIZE,
        max_length=FACE_SIZE,
        # Every spin is face-checked: one gift per person, whatever the number.
        error_messages={
            "required": NO_FACE_MESSAGE,
            "null": NO_FACE_MESSAGE,
            "min_length": NO_FACE_MESSAGE,
            "max_length": NO_FACE_MESSAGE,
        },
    )


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
