#!/usr/bin/env bash
# CoachOS — safe deploy: see what changed, check versions, back up images, rebuild only
# what changed, then run the health check.
#
#   ops/deploy.sh --plan            # PROD: show what would change/rebuild, do nothing
#   ops/deploy.sh                   # PROD: pull, check, back up, deploy, health check
#   ops/deploy.sh local --plan      # local stack (docker-compose.yml), same steps
#   ops/deploy.sh local
#   options: --yes (no confirmation prompt), --from <commit> (compare against this
#            commit instead of the last deployed one)
#
# Steps
#   1. What changed since the last deploy (git diff of commits; local also includes
#      uncommitted files). The last deployed commit is kept in .deploy_state_<env>.
#   2. Version checks: STOP if requirements.txt changed without requirements.lock (or
#      package.json without package-lock.json); list every package version change.
#   3. Plan: which services to rebuild/restart; migrations → take an RDS snapshot first.
#   4. Regression tests in the NEW image (before anything live is touched).
#   5. Back up the current images (docker tag coachos-backup:<svc>-<time>-<commit>,
#      last 3 kept per service) — ops/rollback.sh puts them back.
#   6. Build + restart only the changed services.
#   7. ops/postdeploy_health.sh; on success the new commit is recorded as deployed.
set -euo pipefail

ENV=prod; PLAN=0; YES=0; FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    prod|local) ENV="$1" ;;
    --plan) PLAN=1 ;;
    --yes|-y) YES=1 ;;
    --from) FROM="$2"; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STATE_FILE="$ROOT/.deploy_state_$ENV"
BACKUP_FILE="$ROOT/.deploy_backup_$ENV"

if [ "$ENV" = "prod" ]; then
  DC="docker compose -f docker-compose.prod.yml"; COMPOSE_FILE=docker-compose.prod.yml
  BACKEND_SVCS="backend celery celery-beat"; BACKEND=backend
else
  DC="docker compose"; COMPOSE_FILE=docker-compose.yml
  BACKEND_SVCS="api celery_worker celery_beat"; BACKEND=api
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
hdr()   { echo; printf '\033[1m== %s\033[0m\n' "$*"; }
die()   { red "STOP: $*"; exit 1; }
confirm() { [ $YES -eq 1 ] && return 0; printf '%s [y/N] ' "$1"; read -r a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

# ── 1. What changed ─────────────────────────────────────────────────────────
hdr "1. What changed ($ENV)"
if [ "$ENV" = "prod" ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "uncommitted changes on the server (git status) — prod must deploy committed code only"
  git fetch --quiet
  TARGET="$(git rev-parse '@{u}')"
else
  TARGET="$(git rev-parse HEAD)"
fi
if [ -z "$FROM" ]; then
  if [ -f "$STATE_FILE" ]; then FROM="$(cat "$STATE_FILE")"
  else FROM="$(git rev-parse HEAD)"; yellow "  no $(basename "$STATE_FILE") yet — comparing against the current checkout ($(git rev-parse --short HEAD)). Use --from <commit> if that isn't what's running."
  fi
fi
git cat-file -e "$FROM^{commit}" 2>/dev/null || die "unknown commit $FROM"
echo "  deployed: $(git log -1 --format='%h %s (%cr)' "$FROM")"
echo "  target:   $(git log -1 --format='%h %s (%cr)' "$TARGET")"

CHANGED="$(git diff --name-only "$FROM" "$TARGET")"
if [ "$ENV" = "local" ]; then   # local deploys what's on disk, committed or not
  CHANGED="$(printf '%s\n%s\n%s' "$CHANGED" "$(git diff --name-only HEAD)" "$(git ls-files --others --exclude-standard)" | sort -u)"
fi
CHANGED="$(echo "$CHANGED" | sed '/^$/d')"
if [ -z "$CHANGED" ]; then green "  nothing changed — nothing to deploy"; exit 0; fi
echo "$CHANGED" | sed 's/^/    /' | head -60
[ "$(echo "$CHANGED" | wc -l)" -gt 60 ] && echo "    … $(( $(echo "$CHANGED" | wc -l) - 60 )) more"

has() { echo "$CHANGED" | grep -qE "$1"; }
B=0; BDEPS=0; MIG=0; F=0; FDEPS=0; NG=0; COMP=0
has '^backend/'                                                   && B=1
has '^backend/(requirements\.txt|requirements\.lock|Dockerfile)$' && BDEPS=1
has '^backend/apps/[^/]+/migrations/[^/]+\.py$'                    && MIG=1
has '^frontend/'                                                  && F=1
has '^frontend/(package\.json|package-lock\.json|Dockerfile(\.prod|\.dev)?)$' && FDEPS=1
has '^nginx/'                                                     && NG=1
has "^${COMPOSE_FILE//./\\.}$"                                      && COMP=1

# ── 2. Version checks ───────────────────────────────────────────────────────
hdr "2. Versions"
if has '^backend/requirements\.txt$' && ! has '^backend/requirements\.lock$'; then
  die "backend/requirements.txt changed but requirements.lock didn't. Rebuild locally, run the tests, then regenerate the lock (command at the top of requirements.lock)."
fi
if has '^frontend/package\.json$' && ! has '^frontend/package-lock\.json$'; then
  die "frontend/package.json changed but package-lock.json didn't — run npm install locally and commit the lock."
fi
# local compares the working tree (uncommitted included); prod compares commits
gdiff() { if [ "$ENV" = "local" ]; then git diff "$FROM" -- "$@"; else git diff "$FROM" "$TARGET" -- "$@"; fi; }
if ! git cat-file -e "$FROM:backend/requirements.lock" 2>/dev/null && [ -f backend/requirements.lock ]; then
  yellow "  requirements.lock is NEW — $(grep -c '^[^#].*==' backend/requirements.lock) packages locked to exact versions:"
  grep -iE '^(celery|kombu|redis|django|djangorestframework|stripe|gunicorn)==' backend/requirements.lock | sed 's/^/    /'
else
  LOCKDIFF="$(gdiff backend/requirements.lock | grep -E '^[-+][A-Za-z0-9]' || true)"
  if [ -n "$LOCKDIFF" ]; then
    yellow "  Python package versions change:"
    echo "$LOCKDIFF" | sed -E 's/^-(.*)/\1  (was)/; s/^\+(.*)/\1  (now)/' | sort | sed 's/^/    /'
  else
    green "  Python packages: no version changes"
  fi
fi
if [ $FDEPS -eq 1 ]; then yellow "  Frontend dependencies/Dockerfile changed (npm ci installs exactly package-lock.json)"
else green "  Frontend packages: no changes"; fi
IMGDIFF="$(gdiff "$COMPOSE_FILE" backend/Dockerfile frontend/Dockerfile.prod | grep -E '^[-+].*(image:|FROM )' || true)"
[ -n "$IMGDIFF" ] && { yellow "  Base image changes:"; echo "$IMGDIFF" | sed 's/^/    /'; }
FLOATING="$(grep -hE '^\s*image:.*(:latest|:[0-9]+-alpine)\s*$' "$COMPOSE_FILE" | sed 's/^ *image: *//' | tr '\n' ' ')"
[ -n "$FLOATING" ] && echo "  note: floating image tags (can change on a pull, not rebuilt by this script): $FLOATING"

# ── 3. Plan ─────────────────────────────────────────────────────────────────
hdr "3. Plan"
ACTIONS=""
[ $B -eq 1 ]     && ACTIONS="$ACTIONS backend"
[ $F -eq 1 ]     && ACTIONS="$ACTIONS frontend"
[ $NG -eq 1 ] && [ "$ENV" = "prod" ] && ACTIONS="$ACTIONS nginx"
[ $COMP -eq 1 ]  && ACTIONS="$ACTIONS compose"
if [ "$ENV" = "prod" ]; then
  [ $B -eq 1 ]  && echo "  • rebuild + restart: $BACKEND_SVCS"
  [ $F -eq 1 ]  && echo "  • rebuild + republish: frontend"
  [ $NG -eq 1 ] && echo "  • test config + restart: nginx"
else
  if [ $BDEPS -eq 1 ]; then echo "  • rebuild + restart: $BACKEND_SVCS (dependencies changed)"
  elif [ $B -eq 1 ]; then echo "  • restart: celery_worker celery_beat (api reloads code by itself)"; fi
  [ $FDEPS -eq 1 ] && echo "  • rebuild + restart: frontend (dependencies changed)"
  [ $F -eq 1 ] && [ $FDEPS -eq 0 ] && echo "  • frontend: Vite reloads by itself"
fi
[ $COMP -eq 1 ] && echo "  • $COMPOSE_FILE changed: docker compose up -d for all services"
if [ $MIG -eq 1 ]; then
  yellow "  • DATABASE MIGRATIONS (run automatically when the backend starts):"
  echo "$CHANGED" | grep -E '^backend/apps/[^/]+/migrations/' | sed 's/^/      /'
  [ "$ENV" = "prod" ] && yellow "    → take an RDS snapshot BEFORE continuing (AWS console → RDS → coachos-db → Actions → Take snapshot)"
fi
[ -z "$ACTIONS" ] && { green "  only docs/other files changed — nothing to rebuild"; }
if [ $PLAN -eq 1 ]; then echo; green "Plan only (--plan) — nothing was changed."; exit 0; fi
[ -z "$ACTIONS" ] && { [ "$ENV" = "prod" ] && git merge --ff-only --quiet "$TARGET"; echo "$TARGET" > "$STATE_FILE"; green "Recorded $(git rev-parse --short "$TARGET") as deployed."; exit 0; }
if [ $MIG -eq 1 ] && [ "$ENV" = "prod" ]; then confirm "RDS snapshot taken?" || die "take the snapshot first"; fi
confirm "Deploy to $ENV now?" || die "cancelled"

# ── Pull (prod) ─────────────────────────────────────────────────────────────
if [ "$ENV" = "prod" ]; then
  hdr "Pull"
  git merge --ff-only "$TARGET" || die "git pull failed (not a fast-forward)"
fi

# ── 4. Build, then regression tests in the NEW image ───────────────────────
REBUILD=""
if [ "$ENV" = "prod" ]; then
  [ $B -eq 1 ] && REBUILD="$REBUILD $BACKEND_SVCS"
  [ $F -eq 1 ] && REBUILD="$REBUILD frontend"
else
  [ $BDEPS -eq 1 ] && REBUILD="$REBUILD $BACKEND_SVCS"
  [ $FDEPS -eq 1 ] && REBUILD="$REBUILD frontend"
fi

# Back up BEFORE building: compose reuses the image name, so the build replaces it.
if [ -n "$REBUILD" ]; then
  hdr "5. Back up current images"
  TS="$(date -u +%Y%m%d-%H%M%S)"; SHORT="$(git rev-parse --short "$FROM")"
  : > "$BACKUP_FILE.new"
  for svc in $REBUILD; do
    cid="$($DC ps -q "$svc" 2>/dev/null | head -1)"
    # back up the exact image the running container uses (by ID), restore it under its name
    if [ -n "$cid" ]; then img="$(docker inspect --format '{{.Config.Image}}' "$cid")"; src="$(docker inspect --format '{{.Image}}' "$cid")"
    else img="$($DC config --images 2>/dev/null | grep -E "[-_]$svc$" | head -1 || true)"; src="$img"; fi
    if [ -z "$img" ] || ! docker image inspect "$src" >/dev/null 2>&1; then yellow "  $svc: no current image to back up"; continue; fi
    tag="coachos-backup:${svc}-${TS}-${SHORT}"
    docker tag "$src" "$tag"
    echo "$svc $img $tag" >> "$BACKUP_FILE.new"
    echo "  $svc: $img → $tag"
    # keep the newest 3 backups per service
    docker images coachos-backup --format '{{.Tag}}' | grep "^${svc}-" | sort -r | tail -n +4 | while read -r old; do
      docker rmi "coachos-backup:$old" >/dev/null 2>&1 && echo "    pruned old backup $old"
    done
  done
  echo "$FROM" >> "$BACKUP_FILE.new"; echo "$MIG" >> "$BACKUP_FILE.new"
  mv "$BACKUP_FILE.new" "$BACKUP_FILE"
  green "  rollback: ops/rollback.sh $ENV"

  hdr "6a. Build:$REBUILD"
  $DC build $REBUILD
fi

if [ $B -eq 1 ]; then
  hdr "4. Regression tests"
  if [ "$ENV" = "prod" ]; then
    # In the freshly built image, without touching the live containers. DB-free tests
    # only — prod has no test database.
    $DC run --rm --no-deps -T --entrypoint "" backend \
      pytest -q -p no:cacheprovider test_deploy_regression.py -m "not django_db" \
      || die "regression tests failed in the new image — nothing live was changed. Old images are still running."
  else
    $DC exec -T "$BACKEND" pytest -q -p no:cacheprovider test_deploy_regression.py test_activity_validation.py test_tenant_isolation.py \
      || die "regression tests failed — fix before deploying"
  fi
  green "  regression tests passed"
fi

# ── 6b. Restart what changed ────────────────────────────────────────────────
hdr "6b. Restart"
if [ "$ENV" = "prod" ]; then
  [ $B -eq 1 ]  && $DC up -d $BACKEND_SVCS
  [ $F -eq 1 ]  && $DC up -d --force-recreate frontend
  if [ $NG -eq 1 ]; then
    $DC exec -T nginx nginx -t || die "nginx config test failed — nginx NOT restarted, still running the old config"
    $DC restart nginx
  fi
else
  [ -n "$REBUILD" ] && $DC up -d $REBUILD
  [ $B -eq 1 ] && [ $BDEPS -eq 0 ] && $DC restart celery_worker celery_beat
fi
[ $COMP -eq 1 ] && $DC up -d

# Wait for the backend to be up (prod has a healthcheck; local has none).
for i in $(seq 1 30); do
  cid="$($DC ps -q "$BACKEND" | head -1)"
  st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo starting)"
  [ "$st" = "healthy" ] || [ "$st" = "running" ] && break
  sleep 4
done
echo "  backend: $st"

# ── 7. Health check ─────────────────────────────────────────────────────────
hdr "7. Health check"
if SINCE=10m "$ROOT/ops/postdeploy_health.sh" "$ENV"; then
  echo "$TARGET" > "$STATE_FILE"
  green "DEPLOYED $(git rev-parse --short "$TARGET") to $ENV ✅"
else
  red "Health check FAILED after deploy. Roll back with: ops/rollback.sh $ENV"
  exit 1
fi
