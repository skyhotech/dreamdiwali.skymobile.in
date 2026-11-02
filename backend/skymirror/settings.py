"""Django settings for the SKY Diwali mirror backend."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path):
    """Read KEY=value lines from backend/.env; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file(BASE_DIR / ".env")


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEV_SECRET_KEY = "dev-only-insecure-key-change-me"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", DEV_SECRET_KEY)
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
if not DEBUG and SECRET_KEY == DEV_SECRET_KEY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY before running with DJANGO_DEBUG=0.")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "mirrors",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "skymirror.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "skymirror.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        # SQLITE_PATH keeps the database outside the deployed code on servers.
        "NAME": Path(os.environ.get("SQLITE_PATH") or BASE_DIR / "db.sqlite3"),
        "OPTIONS": {
            # WAL lets kiosks read while another uploads; IMMEDIATE + timeout
            # make concurrent writes wait instead of failing "database is locked".
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
        },
    }
}
# Production uses local MySQL; credentials come only from the environment.
if os.environ.get("MYSQL_DATABASE"):
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.mysql",
        "NAME": os.environ["MYSQL_DATABASE"],
        "USER": os.environ.get("MYSQL_USER", ""),
        "PASSWORD": os.environ.get("MYSQL_PASSWORD", ""),
        "HOST": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "PORT": os.environ.get("MYSQL_PORT", "3306"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        # Strict mode rejects bad data instead of silently truncating it.
        "OPTIONS": {"charset": "utf8mb4", "init_command": "SET sql_mode='STRICT_TRANS_TABLES'"},
    }

# Public address of the selfie studio; branch links and QR codes point here.
STUDIO_URL = (os.environ.get("STUDIO_URL") or "http://localhost:5173").rstrip("/")

# Where `manage.py backup` writes snapshots, and how many to keep.
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR") or BASE_DIR / "backups")
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP") or "14")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT") or BASE_DIR / "media")
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "mirror-login"
DJANGO_ADMIN_ENABLED = os.environ.get("DJANGO_ADMIN_ENABLED", "1") == "1"
LOGIN_REDIRECT_URL = "mirror-dashboard"

# The selfie studio runs on Vite (5173) in development.
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)
# Lets every Vercel preview/production URL of the studio call the API.
CORS_ALLOWED_ORIGIN_REGEXES = env_list("CORS_ALLOWED_ORIGIN_REGEXES", "")
CORS_URLS_REGEX =r"^/(api|media)/.*$"
# The studio reads Retry-After to tell customers how long to wait.
CORS_EXPOSE_HEADERS = ["Retry-After"]
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "")
if DEBUG:
    # `npm run dev` serves the dashboard through Vite's proxy on :5173.
    CSRF_TRUSTED_ORIGINS += ["http://localhost:5173", "http://127.0.0.1:5173"]

# --- Security headers and cookies -------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 8 * 60 * 60  # staff sign-ins last one shift
CSRF_COOKIE_SAMESITE = "Lax"
# The dashboard's JavaScript reads the CSRF cookie to send X-CSRFToken.
CSRF_COOKIE_HTTPONLY = False
if not DEBUG:
    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SSL_REDIRECT", "1") == "1"
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 365 * 24 * 60 * 60
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# Throttle counters live in the cache. The default is per process; with more
# than one server process set REDIS_URL so limits are shared.
if os.environ.get("REDIS_URL"):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": os.environ["REDIS_URL"],
            "KEY_PREFIX": "skymirror",
            # A slow or missing Redis must not hang requests.
            "OPTIONS": {"socket_connect_timeout": 1, "socket_timeout": 1},
        }
    }

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAdminUser"],
    "DEFAULT_THROTTLE_CLASSES": ["mirrors.throttles.BurstThrottle"],
    "EXCEPTION_HANDLER": "mirrors.exceptions.friendly_exception_handler",
    # Behind Caddy/nginx every request comes from 127.0.0.1; trust that many
    # proxies' X-Forwarded-For so rate limits apply per visitor, not globally.
    "NUM_PROXIES": int(os.environ.get("TRUSTED_PROXIES") or 0) or None,
    "DEFAULT_THROTTLE_RATES": {
        # The studio checks the version every second and fetches the full
        # list only when it changes; limits allow several tabs per IP.
        "mirror_version": "300/m",
        "mirror_poll": "60/m",
        # Several kiosks can share one IP; failed uploads also retry from the outbox.
        "customer_upload": "120/m",
        "customer_register": "60/m",
        # New spins per network (a busy kiosk) and per mobile number.
        "customer_spin": "600/h",  # per network: a store shares one Wi-Fi address
        "customer_phone": "20/h",
        # Ceiling for every other API call per IP.
        "burst": "600/m",
    },
}
