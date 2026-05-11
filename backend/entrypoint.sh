#!/bin/bash
set -e

# Ensure production settings are used
export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.production}"
export RENDER=true
export DEBUG="${DEBUG:-False}"
export ALLOWED_HOSTS="${ALLOWED_HOSTS:-*.onrender.com,localhost,127.0.0.1}"

echo "=== Environment Variables ==="
echo "DJANGO_SETTINGS_MODULE: $DJANGO_SETTINGS_MODULE"
echo "RENDER: $RENDER"
echo "DEBUG: $DEBUG"
echo "ALLOWED_HOSTS: $ALLOWED_HOSTS"
echo "SECRET_KEY length: ${#SECRET_KEY}"
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL: NOT SET (using localhost fallback)"
else
  echo "DATABASE_URL set to: ${DATABASE_URL:0:50}..."
fi
if [ -z "$REDIS_URL" ]; then
  echo "REDIS_URL: NOT SET (using localhost fallback)"
else
  echo "REDIS_URL set to: ${REDIS_URL:0:50}..."
fi
echo ""

echo "=== Running Django Checks ==="
python manage.py check || {
  echo "ERROR: Django check failed!"
  exit 1
}

echo ""
echo "=== Running Django Migrations ==="
python manage.py migrate --noinput || {
  echo "⚠️  WARNING: Migrations failed (likely database not ready)"
  echo "    Continuing anyway - you may need to run migrations manually"
  echo "    Command: python manage.py migrate"
}

echo ""
if [ "$#" -gt 0 ]; then
  echo "=== Starting: $@ ==="
  exec "$@"
else
  echo "=== Starting Gunicorn ==="
  exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:${PORT:-10000} \
    --workers 3 \
    --worker-class sync \
    --timeout 60 \
    --access-logfile - \
    --error-logfile -
fi
