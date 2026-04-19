"""
CoachOS — Production Settings (Azure / AWS)
Only env vars and storage backend change — all app code identical to local.
"""
from .base import *  # noqa

DEBUG = False  # Production mode
ALLOWED_HOSTS = [
    "platformcoachos.onrender.com",   # backend (Docker service)
    ".onrender.com",                  # wildcard covers all *.onrender.com subdomains
    "localhost",
    "127.0.0.1",
]

# ── Gunicorn + Uvicorn worker (ASGI) ──────────────────────────────────────
# Command: gunicorn -k uvicorn.workers.UvicornWorker config.asgi:application

# ── HTTPS enforcement ─────────────────────────────────────────────────────
SECURE_PROXY_SSL_HEADER      = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT          = False  # Temporarily disabled for debugging (enable after testing)
SESSION_COOKIE_SECURE        = True
CSRF_COOKIE_SECURE           = True
SECURE_HSTS_SECONDS          = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# ── Proxy headers (trust Render's proxy for Host and X-Forwarded headers) ──
USE_X_FORWARDED_HOST         = True

# ── CSRF trusted origins for Render ─────────────────────────────────────────
CSRF_TRUSTED_ORIGINS = [
    "https://platformcoachos.onrender.com",
    "https://*.onrender.com",
]

# ── Email: Brevo HTTP API (SMTP port 587 blocked on Render free tier) ─────
INSTALLED_APPS += ["anymail"]  # noqa: F405 — only needed in production
EMAIL_BACKEND = "anymail.backends.brevo.EmailBackend"
ANYMAIL = {
    "BREVO_API_KEY": env("BREVO_API_KEY", default=""),
}

# ── File Storage: Azure Blob Storage (S3-compat) or AWS S3 ────────────────
# Azure Blob:
# DEFAULT_FILE_STORAGE = "storages.backends.azure_storage.AzureStorage"
# AZURE_ACCOUNT_NAME   = env("AZURE_STORAGE_ACCOUNT")
# AZURE_ACCOUNT_KEY    = env("AZURE_STORAGE_KEY")
# AZURE_CONTAINER      = env("AZURE_STORAGE_CONTAINER", default="coachos-files")

# AWS S3 (uncomment to use S3 instead of Azure):
# For now, disable S3 until credentials are properly configured
DEFAULT_FILE_STORAGE    = "django.core.files.storage.FileSystemStorage"
# DEFAULT_FILE_STORAGE    = "storages.backends.s3boto3.S3Boto3Storage"
# AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME")
# AWS_ACCESS_KEY_ID       = env("AWS_ACCESS_KEY_ID")
# AWS_SECRET_ACCESS_KEY   = env("AWS_SECRET_ACCESS_KEY")
# AWS_S3_REGION_NAME      = env("AWS_S3_REGION_NAME", default="us-east-1")
# AWS_S3_ENDPOINT_URL     = None   # Real S3, not MinIO

# ── Sentry error tracking ─────────────────────────────────────────────────
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=0.1)
    except ImportError:
        pass  # sentry_sdk not installed, skip
