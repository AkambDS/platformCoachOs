#!/bin/bash
set -e

# Ensure production settings are used
export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.production}"
export RENDER=true

echo "=== Environment Variables ==="
env | grep -E "(DJANGO|SECRET|DEBUG|DATABASE|REDIS|AWS|STRIPE)" || echo "No matching vars found"
echo ""

echo "=== Django Setup Check ==="
echo "DJANGO_SETTINGS_MODULE: $DJANGO_SETTINGS_MODULE"
echo "DEBUG: $DEBUG"
echo "ALLOWED_HOSTS: $ALLOWED_HOSTS"
echo "SECRET_KEY length: ${#SECRET_KEY}"
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
echo "=== Starting Gunicorn ==="
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 3 \
  --worker-class sync \
  --timeout 60 \
  --access-logfile - \
  --error-logfile -
