"""Face check on the server: OpenCV's YuNet finds the face, SFace turns it into
a 128-number fingerprint. About 0.1 s per selfie on one vCPU, and phones no
longer download or run a face model themselves.

Fingerprints are stored as {"model": "sface", "v": [...]}; only fingerprints
from the same model are compared.
"""

import logging
import threading
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps

log = logging.getLogger(__name__)

MODEL = "sface"
# OpenCV's published threshold for SFace cosine similarity: same person above.
SAME_PERSON = 0.363
# The face is read from a copy this size: plenty for the fingerprint.
READ_SIZE = 640

_lock = threading.Lock()
_models = None


class FaceCheckUnavailable(RuntimeError):
    """OpenCV or the model files are missing on this server."""


def _load():
    global _models
    if _models is None:
        try:
            import cv2
        except ImportError as e:
            raise FaceCheckUnavailable("opencv is not installed") from e
        folder = Path(settings.FACE_MODELS_DIR)
        yunet, sface = folder / "yunet.onnx", folder / "sface.onnx"
        if not (yunet.exists() and sface.exists()):
            raise FaceCheckUnavailable(f"face models missing in {folder}")
        detector = cv2.FaceDetectorYN.create(str(yunet), "", (320, 320), 0.8, 0.3, 5)
        recognizer = cv2.FaceRecognizerSF.create(str(sface), "")
        _models = (cv2, detector, recognizer)
    return _models


def fingerprint(file):
    """Fingerprint of the largest face in an image file, or None without a face."""
    import numpy as np

    with _lock:
        cv2, detector, recognizer = _load()
        file.seek(0)
        image = ImageOps.exif_transpose(Image.open(file)).convert("RGB")
        image.thumbnail((READ_SIZE, READ_SIZE))
        bgr = np.asarray(image)[:, :, ::-1].copy()
        detector.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, faces = detector.detect(bgr)
        if faces is None or len(faces) == 0:
            return None
        face = max(faces, key=lambda f: f[2] * f[3])
        vector = recognizer.feature(recognizer.alignCrop(bgr, face)).flatten()
    norm = float(np.linalg.norm(vector)) or 1.0
    return {"model": MODEL, "v": [round(float(x) / norm, 5) for x in vector]}


def same_person(a, b):
    """True when two stored fingerprints (same model) are the same person."""
    if not (isinstance(a, dict) and isinstance(b, dict)):
        return False
    if a.get("model") != MODEL or b.get("model") != MODEL:
        return False
    va, vb = a.get("v") or [], b.get("v") or []
    if len(va) != len(vb) or not va:
        return False
    return sum(x * y for x, y in zip(va, vb)) >= SAME_PERSON


def warm_up():
    """Load the models at start-up so the first spin is fast."""
    try:
        _load()
    except FaceCheckUnavailable as e:
        log.warning("Face check unavailable: %s", e)
