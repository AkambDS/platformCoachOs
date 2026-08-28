#!/bin/bash
set -e

# Only run migrations from the web/api process — celery containers skip this
# to avoid concurrent deadlocks on the post-migrate RLS policy setup.
if [[ "${1:-}" != celery* ]]; then
    echo "[entrypoint] Running migrations..."
    python manage.py migrate --noinput
    echo "[entrypoint] Ensuring Google SocialApp config..."
    python manage.py ensure_google_socialapp
fi

# Collect static files only when starting the web server (gunicorn), not dev server or celery
if [[ "${1:-}" == gunicorn* ]]; then
    echo "[entrypoint] Collecting static files..."
    python manage.py collectstatic --noinput --clear
fi

echo "[entrypoint] Starting: $*"
exec "$@"
