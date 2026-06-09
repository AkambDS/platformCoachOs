"""CoachOS — Production Settings (AWS EC2)"""
from .base import *  # noqa

DEBUG = False
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# ── HTTPS enforcement ─────────────────────────────────────────────────────
SECURE_PROXY_SSL_HEADER        = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT            = False   # nginx handles the redirect
SESSION_COOKIE_SECURE          = True
CSRF_COOKIE_SECURE             = True
SECURE_HSTS_SECONDS            = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
USE_X_FORWARDED_HOST           = True

# ── Security headers (Django layer) ───────────────────────────────────────
SECURE_CONTENT_TYPE_NOSNIFF = True   # X-Content-Type-Options: nosniff
X_FRAME_OPTIONS             = "DENY" # X-Frame-Options: DENY

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# ── Authorized custom sender domains ─────────────────────────────────────
ALLOWED_FROM_EMAIL_DOMAINS = {"rass-consulting.com", "lauratreonze.com"}

# ── Email: AWS SES via SMTP ───────────────────────────────────────────────
EMAIL_BACKEND     = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST        = env("EMAIL_HOST",     default="email-smtp.us-east-1.amazonaws.com")
EMAIL_PORT        = env.int("EMAIL_PORT", default=587)
EMAIL_USE_TLS     = True
EMAIL_HOST_USER   = env("AWS_SES_SMTP_USER",     default="")
EMAIL_HOST_PASSWORD = env("AWS_SES_SMTP_PASSWORD", default="")

# ── File Storage: AWS S3 ──────────────────────────────────────────────────
AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="coachos-media")
AWS_S3_REGION_NAME      = env("AWS_S3_REGION_NAME",      default="us-east-1")
AWS_S3_ENDPOINT_URL     = None   # Real S3, not MinIO
MINIO_PUBLIC_URL        = ""
AWS_DEFAULT_ACL         = "private"
AWS_QUERYSTRING_AUTH    = True
# If an IAM role is attached to the EC2 instance, leave these unset — boto3 uses the role.
# Otherwise set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env on EC2.
AWS_ACCESS_KEY_ID     = env("AWS_ACCESS_KEY_ID",     default=None) or None
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default=None) or None
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# ── Logging ───────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "[%(levelname)s %(asctime)s %(name)s] %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "django":         {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}

# ── Sentry error tracking ─────────────────────────────────────────────────
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=0.1)
    except ImportError:
        pass
