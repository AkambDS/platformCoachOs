#!/bin/bash
set -e

echo "[entrypoint] Running migrations..."
python manage.py migrate --noinput

# Collect static files only when starting the web server, not celery
if [[ "${1:-}" == gunicorn* ]]; then
    echo "[entrypoint] Collecting static files..."
    python manage.py collectstatic --noinput --clear
fi

echo "[entrypoint] Starting: $*"
exec "$@"
