#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# CoachOS — HTTPS setup on AWS EC2 (Ubuntu/Debian)
#
# Prerequisites:
#   1. Your domain (e.g. app.coachos.app) must point to this EC2's public IP
#      in your DNS provider (A record, TTL ~60s for quick propagation).
#   2. Port 80 and 443 must be open in the EC2 Security Group.
#   3. Docker and docker-compose are already installed.
#
# Usage:
#   chmod +x scripts/setup-https.sh
#   sudo ./scripts/setup-https.sh your-domain.com
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <your-domain.com>"
  exit 1
fi

CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/nginx/certs"
mkdir -p "$CERTS_DIR"

echo "==> Installing certbot..."
apt-get update -qq
apt-get install -y certbot

echo "==> Stopping nginx container (frees port 80 for certbot standalone mode)..."
docker compose -f docker-compose.prod.yml stop nginx 2>/dev/null || true

echo "==> Obtaining Let's Encrypt certificate for $DOMAIN..."
certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "admin@${DOMAIN}" \
  -d "$DOMAIN"

echo "==> Copying certs into nginx/certs/..."
cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem "$CERTS_DIR/fullchain.pem"
cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   "$CERTS_DIR/privkey.pem"
chmod 644 "$CERTS_DIR/fullchain.pem"
chmod 600 "$CERTS_DIR/privkey.pem"

echo "==> Restarting nginx..."
docker compose -f docker-compose.prod.yml up -d nginx

echo ""
echo "✓ HTTPS is live at https://$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. In backend/.env set:  SECURE_SSL_REDIRECT=True"
echo "     Or edit backend/config/settings/production.py: SECURE_SSL_REDIRECT = True"
echo "  2. Restart the backend:  docker compose -f docker-compose.prod.yml restart backend"
echo "  3. Set up auto-renewal (runs twice daily via cron):"
echo "     echo '0 */12 * * * root certbot renew --quiet --deploy-hook \"docker compose -f $(pwd)/docker-compose.prod.yml exec nginx nginx -s reload\"' >> /etc/cron.d/certbot-renew"
