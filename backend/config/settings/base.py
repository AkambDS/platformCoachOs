"""CoachOS — Base Settings"""
import environ
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY    = env("SECRET_KEY")
DEBUG         = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

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

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["OPTIONS"] = {"connect_timeout": 10}

CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.redis.RedisCache",
    "LOCATION": env("REDIS_URL", default="redis://localhost:6379/0"),
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
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
}

# ── JWT ───────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":   timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME":  timedelta(days=7),
    "ROTATE_REFRESH_TOKENS":   True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN":       True,
    "SIGNING_KEY":             env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES":       ("Bearer",),
    "TOKEN_OBTAIN_SERIALIZER": "apps.accounts.serializers.CoachOSTokenObtainPairSerializer",
}

# ── OpenAPI ───────────────────────────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    "TITLE": "CoachOS API",
    "DESCRIPTION": "Executive Coaching Platform V1",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# ── CORS ──────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS  = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
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
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="CoachOS <noreply@coachos.app>")

# ── Celery ────────────────────────────────────────────────────────────────
CELERY_BROKER_URL      = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND  = "django-db"
CELERY_ACCEPT_CONTENT  = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TIMEZONE        = "UTC"
CELERY_BEAT_SCHEDULER  = "django_celery_beat.schedulers:DatabaseScheduler"

# ── Stripe ────────────────────────────────────────────────────────────────
STRIPE_LIVE_MODE          = env.bool("STRIPE_LIVE_MODE", default=False)
STRIPE_TEST_SECRET_KEY    = env("STRIPE_TEST_SECRET_KEY", default="")
STRIPE_LIVE_SECRET_KEY    = env("STRIPE_LIVE_SECRET_KEY", default="")
DJSTRIPE_WEBHOOK_SECRET   = env("STRIPE_WEBHOOK_SECRET", default="")
DJSTRIPE_FOREIGN_KEY_TO_FIELD = "id"

# ── File Storage ─────────────────────────────────────────────────────────
AWS_S3_ENDPOINT_URL     = env("MINIO_ENDPOINT",   default="http://localhost:9000")
AWS_ACCESS_KEY_ID       = env("MINIO_ACCESS_KEY", default="coachos")
AWS_SECRET_ACCESS_KEY   = env("MINIO_SECRET_KEY", default="coachos_minio_secret")
AWS_STORAGE_BUCKET_NAME = env("MINIO_BUCKET",     default="coachos-files")
AWS_DEFAULT_ACL         = "private"
AWS_S3_FILE_OVERWRITE   = False
DEFAULT_FILE_STORAGE    = "storages.backends.s3boto3.S3Boto3Storage"

# ── SMS ───────────────────────────────────────────────────────────────────
SMS_BACKEND        = env("SMS_BACKEND",        default="mock")
TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN  = env("TWILIO_AUTH_TOKEN",  default="")
TWILIO_FROM_NUMBER = env("TWILIO_FROM_NUMBER", default="")
