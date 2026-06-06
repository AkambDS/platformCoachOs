"""CoachOS — Base Settings"""
import environ
from pathlib import Path
from datetime import timedelta
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY", default=None)
if not SECRET_KEY:
    raise ImproperlyConfigured(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"from django.utils.crypto import get_random_string; "
        "print(get_random_string(50))\" and add it to your .env file."
    )
DEBUG               = env("DEBUG", default="False")
ALLOWED_HOSTS       = env.list("ALLOWED_HOSTS", default=[])
REGISTRATION_OPEN   = env.bool("REGISTRATION_OPEN", default=False)

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "django.contrib.sites",
]

THIRD_PARTY_APPS = [
    #"anymail",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "drf_spectacular",
    "djstripe",
    "django_celery_beat",
    "django_celery_results",
    "storages",
    "django_filters",
]

LOCAL_APPS = [
    "apps.accounts",
    "apps.clients",
    "apps.activities",
    "apps.pipeline",
    "apps.invoicing",
    "apps.reports",
    "apps.portal",
    "apps.library",
    "apps.settings_app",
    "apps.feedback",
    "apps.audit",
    "apps.superadmin",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "config.middleware.WorkspaceTenantMiddleware",
]

ROOT_URLCONF    = "config.urls"
SITE_ID         = 1
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug",
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgresql://postgres:postgres@localhost:5432/coachos"
    )
}
DATABASES["default"]["OPTIONS"] = {"connect_timeout": 10}

_REDIS_URL = env("REDIS_URL", default="")
if _REDIS_URL:
    CACHES = {"default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": _REDIS_URL,
    }}
else:
    CACHES = {"default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }}

AUTH_USER_MODEL   = "accounts.User"
LANGUAGE_CODE     = "en-us"
TIME_ZONE         = "UTC"
USE_I18N          = True
USE_TZ            = True
STATIC_URL        = "/static/"
STATIC_ROOT       = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── DRF ───────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.accounts.authentication.CookieJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.accounts.error_logging.drf_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    # Rate limiting — applied per-view; these define the buckets.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon":           "200/hour",   # general unauthenticated API calls
        "user":           "2000/hour",  # general authenticated API calls
        "login":          "10/minute",  # login attempts per IP
        "password_reset": "5/minute",   # password-reset requests per IP
        "register":       "5/hour",     # workspace registrations per IP
    },
}

# ── JWT ───────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":    timedelta(minutes=30),  # was 8h — short window limits damage if stolen
    "REFRESH_TOKEN_LIFETIME":   timedelta(days=7),      # was 30d — 7 days is standard for SaaS
    "ROTATE_REFRESH_TOKENS":    True,   # every refresh issues a new refresh token
    "BLACKLIST_AFTER_ROTATION": True,   # old refresh token immediately invalidated
    "UPDATE_LAST_LOGIN":        True,
    "SIGNING_KEY":              env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES":        ("Bearer",),
    "TOKEN_OBTAIN_SERIALIZER":  "apps.accounts.serializers.CoachOSTokenObtainPairSerializer",
}

# ── OpenAPI ───────────────────────────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    "TITLE": "CoachOS API",
    "DESCRIPTION": "Executive Coaching Platform V1",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

FRONTEND_URL   = env("FRONTEND_URL",   default="http://localhost:5173")
BACKEND_URL    = env("BACKEND_URL",    default="http://localhost:8000")
CRON_SECRET    = env("CRON_SECRET",    default="")
RESEND_API_KEY = env("RESEND_API_KEY", default="")

# ── CORS ──────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS  = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
)
CORS_ALLOWED_ORIGIN_REGEXES = []
CORS_ALLOW_CREDENTIALS = True

# ── Allauth ───────────────────────────────────────────────────────────────
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
ACCOUNT_EMAIL_REQUIRED        = True
ACCOUNT_USERNAME_REQUIRED     = False
ACCOUNT_AUTHENTICATION_METHOD = "email"
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": ["profile", "email", "https://www.googleapis.com/auth/calendar"],
        "AUTH_PARAMS": {"access_type": "offline"},
    }
}

# ── Email ─────────────────────────────────────────────────────────────────
# Use SMTP when EMAIL_HOST is set (e.g. Mailpit on port 1025 in dev).
# Falls back to console backend so local dev without Docker still works.
_EMAIL_HOST = env("EMAIL_HOST", default="")
if _EMAIL_HOST:
    EMAIL_BACKEND  = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST     = _EMAIL_HOST
    EMAIL_PORT     = env.int("EMAIL_PORT",     default=1025)
    EMAIL_USE_TLS  = env.bool("EMAIL_USE_TLS", default=False)
    EMAIL_USE_SSL  = env.bool("EMAIL_USE_SSL", default=False)
    EMAIL_HOST_USER     = env("EMAIL_HOST_USER",     default="")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="CoachOS <noreply@coachos.app>")

# ── Celery ────────────────────────────────────────────────────────────────
CELERY_BROKER_URL      = _REDIS_URL or "memory://"
CELERY_RESULT_BACKEND  = "django-db"
CELERY_ACCEPT_CONTENT  = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TIMEZONE        = "UTC"
CELERY_BEAT_SCHEDULER  = "django_celery_beat.schedulers:DatabaseScheduler"

from celery.schedules import crontab
CELERY_BEAT_SCHEDULE = {
    # Scan for upcoming activities and fire email/SMS reminders — runs every 15 minutes
    "dispatch-activity-reminders": {
        "task": "tasks.reminders.dispatch_activity_reminders",
        "schedule": crontab(minute="*/15"),
    },
}

# ── Stripe ────────────────────────────────────────────────────────────────
STRIPE_LIVE_MODE          = env.bool("STRIPE_LIVE_MODE", default=False)
STRIPE_TEST_SECRET_KEY    = env("STRIPE_TEST_SECRET_KEY", default="")
STRIPE_LIVE_SECRET_KEY    = env("STRIPE_LIVE_SECRET_KEY", default="")
DJSTRIPE_WEBHOOK_SECRET   = env("STRIPE_WEBHOOK_SECRET", default="")
DJSTRIPE_FOREIGN_KEY_TO_FIELD = "id"

# ── File Storage ─────────────────────────────────────────────────────────
# Dev: set MINIO_ENDPOINT to use local MinIO.
# Prod: leave MINIO_ENDPOINT empty → uses real AWS S3 via IAM instance role.
_minio_endpoint         = env("MINIO_ENDPOINT", default="")
AWS_S3_ENDPOINT_URL     = _minio_endpoint if _minio_endpoint else None

# Bucket — prefer AWS_S3_BUCKET_NAME in prod; fall back to MINIO_BUCKET for dev
AWS_STORAGE_BUCKET_NAME = env("AWS_S3_BUCKET_NAME", default=env("MINIO_BUCKET", default="coachos-files"))
AWS_S3_REGION_NAME      = env("AWS_S3_REGION_NAME", default="us-east-1")

# Credentials — only set explicitly when running with MinIO (dev).
# In production on EC2 with IAM instance role, boto3 picks up credentials
# automatically via the instance metadata service — no keys needed.
_access_key = env("AWS_ACCESS_KEY_ID",     default=env("MINIO_ACCESS_KEY", default=""))
_secret_key = env("AWS_SECRET_ACCESS_KEY", default=env("MINIO_SECRET_KEY", default=""))
if _access_key:
    AWS_ACCESS_KEY_ID     = _access_key
    AWS_SECRET_ACCESS_KEY = _secret_key

MINIO_PUBLIC_URL      = env("MINIO_PUBLIC_URL", default="")
AWS_DEFAULT_ACL       = "private"
AWS_S3_FILE_OVERWRITE = False
AWS_QUERYSTRING_AUTH  = True          # presigned URLs for private objects
AWS_QUERYSTRING_EXPIRE = 1800         # presigned URLs expire in 30 minutes

# Django 4.2+ requires STORAGES dict — DEFAULT_FILE_STORAGE alone is ignored.
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# ── SMS ───────────────────────────────────────────────────────────────────
SMS_BACKEND        = env("SMS_BACKEND",        default="mock")
TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN  = env("TWILIO_AUTH_TOKEN",  default="")
TWILIO_FROM_NUMBER = env("TWILIO_FROM_NUMBER", default="")
