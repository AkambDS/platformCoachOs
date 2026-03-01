"""CoachOS — Local / POC Development Settings"""
from .base import *  # noqa

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "api"]

# Mailpit catches all mail in dev
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST    = env("EMAIL_HOST", default="localhost")
EMAIL_PORT    = env.int("EMAIL_PORT", default=1025)
EMAIL_USE_TLS = False

# Allow all origins in dev
CORS_ALLOW_ALL_ORIGINS = True

# No password restrictions in dev
AUTH_PASSWORD_VALIDATORS = []
