import re

from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle


def client_ip(request):
    """The visitor's real IP, also behind a reverse proxy such as Caddy.

    With TRUSTED_PROXIES=N the address N hops from the end of X-Forwarded-For
    is used (the one our own proxy saw), so clients can't spoof it. Matches
    DRF's throttle identity (NUM_PROXIES)."""
    proxies = api_settings.NUM_PROXIES
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if proxies and forwarded:
        hops = [a.strip() for a in forwarded.split(",") if a.strip()]
        if hops:
            return hops[-min(proxies, len(hops))]
    return request.META.get("REMOTE_ADDR", "")


class ScopedIPThrottle(SimpleRateThrottle):
    """Per-IP throttle that also understands multi-unit periods like ``1/5s``."""

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

    def parse_rate(self, rate):
        if rate is None:
            return None, None
        num, period = rate.split("/")
        match = re.fullmatch(r"(\d*)([smhd])", period)
        if not match:
            raise ValueError(f"Invalid throttle period: {period!r}")
        seconds = {"s": 1, "m": 60, "h": 3600, "d": 86400}[match[2]]
        return int(num), int(match[1] or 1) * seconds


class MirrorPollThrottle(ScopedIPThrottle):
    scope = "mirror_poll"


class MirrorVersionThrottle(ScopedIPThrottle):
    scope = "mirror_version"


class CustomerUploadThrottle(ScopedIPThrottle):
    scope = "customer_upload"


class CustomerRegisterThrottle(ScopedIPThrottle):
    scope = "customer_register"


class CustomerSpinThrottle(ScopedIPThrottle):
    scope = "customer_spin"


class ManagerThrottle(ScopedIPThrottle):
    scope = "manager"


class RepeatThrottle(ScopedIPThrottle):
    """The same change can't be sent twice within a few seconds: a double tap
    or a resent form is refused. Reads are never limited."""

    scope = "repeat"
    KEYS = ("token", "phone", "id", "kind")

    def get_cache_key(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        try:
            data = request.data
        except Exception:
            data = {}
        subject = "|".join(str(data.get(k, ""))[:64] for k in self.KEYS if hasattr(data, "get"))
        ident = f"{self.get_ident(request)}|{request.method}|{request.path}|{subject}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class BurstThrottle(ScopedIPThrottle):
    """Overall per-IP ceiling for every API endpoint."""

    scope = "burst"
