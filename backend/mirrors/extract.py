"""Reads the text of an invoice on the server, so Django checks what is really
printed on the bill. PDFs that hold text are read directly; image-only PDFs
and photos are enhanced, then read with Tesseract OCR."""

import io
import re
import shutil

from PIL import Image, ImageFilter, ImageOps

MAX_BYTES = 15 * 1024 * 1024
# Small print reads best at about this width (≈300 dpi for an A4 bill).
OCR_WIDTH = 2400
MIN_PDF_TEXT = 40
# Tesseract: LSTM engine, one block of uniform text (a bill's table).
OCR_CONFIG = "--oem 1 --psm 6"


class UnreadableInvoice(Exception):
    """The file is not an image or PDF we can read."""


def ocr_available():
    return shutil.which("tesseract") is not None


def _pdf_text(data):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages[:2])


def _pdf_first_page(data):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        return pdf[0].render(scale=300 / 72).to_pil()
    finally:
        pdf.close()


def enhance(image):
    """Upright, grey, large enough, full contrast and sharp: what OCR needs
    from a phone photo taken at an angle in shop lighting."""
    image = ImageOps.exif_transpose(image).convert("L")
    if image.width < OCR_WIDTH:
        scale = OCR_WIDTH / image.width
        image = image.resize((OCR_WIDTH, round(image.height * scale)), Image.Resampling.LANCZOS)
    image = ImageOps.autocontrast(image, cutoff=1)
    return image.filter(ImageFilter.UnsharpMask(radius=2, percent=160, threshold=3))


def _binarized(image):
    """Pure black on white: rescues faint or unevenly lit print."""
    histogram = image.histogram()
    total = sum(histogram)
    # Otsu's threshold: the split that best separates ink from paper.
    best, threshold, weight, mean_sum = 0, 128, 0, sum(i * h for i, h in enumerate(histogram))
    below = 0
    for level, count in enumerate(histogram):
        weight += count
        if not weight or weight == total:
            continue
        below += level * count
        m1, m2 = below / weight, (mean_sum - below) / (total - weight)
        between = weight * (total - weight) * (m1 - m2) ** 2
        if between > best:
            best, threshold = between, level
    return image.point(lambda p: 255 if p > threshold else 0)


def ocr_image(image):
    """Two readings, enhanced and black-and-white, combined: a field missed in
    one is usually caught in the other."""
    import pytesseract

    clean = enhance(image)
    readings = [pytesseract.image_to_string(clean, config=OCR_CONFIG)]
    readings.append(pytesseract.image_to_string(_binarized(clean), config=OCR_CONFIG))
    return "\n".join(readings)


def extract_text(data, name=""):
    """All the text on an invoice file (PDF or image)."""
    if len(data) > MAX_BYTES:
        raise UnreadableInvoice("The invoice file is too large (max 15 MB).")
    is_pdf = data[:5] == b"%PDF-" or name.lower().endswith(".pdf")
    try:
        if is_pdf:
            text = _pdf_text(data)
            if len(text.strip()) >= MIN_PDF_TEXT:
                return text
            return ocr_image(_pdf_first_page(data))
        return ocr_image(Image.open(io.BytesIO(data)))
    except UnreadableInvoice:
        raise
    except Exception as exc:  # corrupt or unsupported file
        raise UnreadableInvoice("We couldn't read this invoice. Please upload a clear photo or the PDF.") from exc


_PREFIX = re.compile(r"^(?:S[1Il|!]|5[Il|!1]|5I)(?=\d{4})")


def normalize_invoice_number(value):
    """SKY invoice numbers start "SI" + the year pair (SI2627…); scans often
    read that "I" as "1" (S12627…). Fixes only that well-known slip."""
    value = re.sub(r"\s+", "", value.strip().upper())
    return _PREFIX.sub("SI", value)
