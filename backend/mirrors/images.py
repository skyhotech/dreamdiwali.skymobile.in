"""Shrink and re-encode uploaded images so phones download them quickly."""

from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

# Posters and frames are drawn at 1080 × 1920; more pixels only cost download time.
FRAME_SIZE = (1080, 1920)
POSTER_SIZE = (1080, 2400)
SELFIE_SIZE = (1280, 1280)
THUMB_SIZE = (360, 800)

# 1 GB server: refuse "decompression bombs" (a small file that decodes to a
# huge bitmap). Pillow errors above twice this, i.e. ~50 megapixels.
Image.MAX_IMAGE_PIXELS = 25_000_000


def _open(file, max_size):
    """Open an image, letting JPEG decode at a reduced scale when the target
    is much smaller (a 12 MP photo then needs a fraction of the memory)."""
    file.seek(0)
    image = Image.open(file)
    if image.format == "JPEG":
        image.draft("RGB", max_size)
    return ImageOps.exif_transpose(image)


def optimized(file, max_size, quality=88, name=None, only_if_smaller=False):
    """Return the image fitted inside max_size as a ContentFile.

    Images without transparency become progressive JPEG (usually 5–10× smaller
    than PNG); transparent ones stay PNG. Returns None if the file isn't an
    image, or with only_if_smaller when the result wouldn't save any bytes.
    """
    try:
        image = _open(file, max_size)
    except Exception:
        return None
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    # Browser canvas exports carry an alpha channel even when every pixel is
    # opaque; only keep PNG when something is actually see-through.
    if image.mode == "P" and "transparency" in image.info:
        image = image.convert("RGBA")
    has_alpha = image.mode in ("RGBA", "LA") and image.getchannel("A").getextrema()[0] < 255
    out = BytesIO()
    stem = Path(name or getattr(file, "name", "image")).stem
    if has_alpha:
        image.save(out, "PNG", optimize=True)
        ext = "png"
    else:
        image.convert("RGB").save(out, "JPEG", quality=quality, optimize=True, progressive=True)
        ext = "jpg"
    original = getattr(file, "size", None)
    if only_if_smaller and original and out.tell() >= original:
        return None
    return ContentFile(out.getvalue(), name=f"{stem}.{ext}")


PHOTO_TARGET_BYTES = 200 * 1024
# Lowest quality we accept before shrinking dimensions instead.
_JPEG_MIN_QUALITY = 85
_WEBP_MIN_QUALITY = 80
_WEBP_WIDTHS = (900, 810, 720)


def _encode(image, fmt, quality):
    out = BytesIO()
    if fmt == "JPEG":
        image.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    else:
        image.save(out, "WEBP", quality=quality, method=6)
    return out


def _best_quality(image, fmt, floor, target):
    """Highest quality (floor..95) whose encoding fits in target bytes, else None."""
    lo, hi, best = floor, 95, None
    while lo <= hi:
        q = (lo + hi) // 2
        out = _encode(image, fmt, q)
        if out.tell() <= target:
            best, lo = out, q + 1
        else:
            hi = q - 1
    return best


def compressed_photo(file, max_size, target=PHOTO_TARGET_BYTES, name=None):
    """Fit a photo under `target` bytes at the highest quality possible.

    Tries JPEG at full size (q ≥ 85; selfies land at ~q90–95), then WebP at
    full size and stepped-down widths (q ≥ 80; posters land at ~900 px, q≈80).
    Transparent images and files that are already small are left alone
    (returns None, so the caller keeps the original).
    """
    try:
        image = _open(file, max_size)
    except Exception:
        return None
    if getattr(file, "size", 0) and file.size <= target:
        return None
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        if rgba.getchannel("A").getextrema()[0] < 255:
            return None  # real transparency: keep the original PNG
        image = rgba
    image = image.convert("RGB")
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    stem = Path(name or getattr(file, "name", "photo")).stem

    out = _best_quality(image, "JPEG", _JPEG_MIN_QUALITY, target)
    if out:
        return ContentFile(out.getvalue(), name=f"{stem}.jpg")
    for width in (image.width, *_WEBP_WIDTHS):
        if width > image.width:
            continue
        scaled = image if width == image.width else image.resize(
            (width, round(width * image.height / image.width)), Image.Resampling.LANCZOS
        )
        out = _best_quality(scaled, "WEBP", _WEBP_MIN_QUALITY, target)
        if out:
            return ContentFile(out.getvalue(), name=f"{stem}.webp")
    # Extremely detailed images: keep stepping the size down (quality ≥ 60)
    # until it fits, so the 200 KB limit is a guarantee, not a hope.
    while scaled.width > 320:
        width = int(scaled.width * 0.85)
        scaled = image.resize(
            (width, round(width * image.height / image.width)), Image.Resampling.LANCZOS
        )
        out = _best_quality(scaled, "WEBP", 60, target)
        if out:
            return ContentFile(out.getvalue(), name=f"{stem}.webp")
    out = _best_quality(scaled, "WEBP", 10, target) or _encode(scaled, "WEBP", 10)
    return ContentFile(out.getvalue(), name=f"{stem}.webp")
