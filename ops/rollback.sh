#!/usr/bin/env bash
# CoachOS — put back the images ops/deploy.sh backed up before its last build.
#
#   ops/rollback.sh            # prod
#   ops/rollback.sh local
#
# Restores only the services that deploy rebuilt (no rebuild, no git change needed: the
# code is inside the image). Then runs the health check.
# ⚠ If that deploy ran DATABASE MIGRATIONS, old code may not match the new schema:
#   reverse them first (see that deploy's change log) or restore the RDS snapshot.
set -euo pipefail
ENV="${1:-prod}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BACKUP_FILE="$ROOT/.deploy_backup_$ENV"
[ "$ENV" = "prod" ] && DC="docker compose -f docker-compose.prod.yml" || DC="docker compose"
[ -f "$BACKUP_FILE" ] || { echo "No backup recorded ($BACKUP_FILE) — nothing to roll back to."; exit 1; }

FROM="$(tail -2 "$BACKUP_FILE" | head -1)"; MIG="$(tail -1 "$BACKUP_FILE")"
SVCS=""
echo "Roll back $ENV to the images from commit $(git log -1 --format='%h %s' "$FROM" 2>/dev/null || echo "$FROM"):"
while read -r svc img tag; do
  [ -z "${tag:-}" ] && continue
  echo "  $svc: $tag → $img"; SVCS="$SVCS $svc"
done < "$BACKUP_FILE"
[ "$MIG" = "1" ] && printf '\033[33m⚠ That deploy ran database migrations — reverse them or restore the RDS snapshot first.\033[0m\n'
printf 'Proceed? [y/N] '; read -r a; [ "$a" = "y" ] || [ "$a" = "Y" ] || { echo cancelled; exit 1; }

while read -r svc img tag; do
  [ -z "${tag:-}" ] && continue
  docker image inspect "$tag" >/dev/null 2>&1 || { echo "backup image $tag is missing"; exit 1; }
  docker tag "$tag" "$img"
done < "$BACKUP_FILE"
$DC up -d --no-build --force-recreate $SVCS
echo "$FROM" > "$ROOT/.deploy_state_$ENV"
SINCE=10m "$ROOT/ops/postdeploy_health.sh" "$ENV"
