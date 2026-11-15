#!/usr/bin/env bash
# CoachOS — post-deploy health check. READ-ONLY: changes nothing, sends nothing.
#
#   ops/postdeploy_health.sh            # prod (on EC2)
#   ops/postdeploy_health.sh local      # local docker compose stack
#   SINCE=10m ops/postdeploy_health.sh  # log window (default 1h)
#
# HARD checks (exit 1 if any fail): every container up/healthy, the site answers,
# `manage.py deploy_check` (DB, package versions == lock, Celery broker + worker,
# tenant integrity). Log scans are WARNINGS only, since the window can include errors
# from before the deploy.
set -uo pipefail

ENV="${1:-prod}"
SINCE="${SINCE:-1h}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$ENV" = "prod" ]; then
  DC="docker compose -f docker-compose.prod.yml"
  BACKEND=backend; CELERY="celery celery-beat"; FRONTEND=frontend; NGINX=nginx
  URLS="https://coachos.rass-consulting.com/ https://coachos.rass-consulting.com/login https://coachos.rass-consulting.com/client-portal"
  ONESHOT="frontend"          # copies the built SPA into a volume, then exits 0
else
  DC="docker compose"
  BACKEND=api; CELERY="celery_worker celery_beat"; FRONTEND=frontend; NGINX=""
  URLS="http://localhost:5173/ http://localhost:8000/django-admin/login/"
  ONESHOT="migrate"
fi

HARD_FAIL=0; WARN=0
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
hdr()   { echo; echo "== $*"; }
logs()  { $DC logs --since "$SINCE" "$@" 2>&1 | grep -v '^time='; }

# scan "<title>" "<matching lines>": show them; count as a warning if any.
scan() {
  hdr "$1"
  local out="$2"
  if [ -n "$out" ]; then echo "$out"; yellow "  ⚠ $(echo "$out" | wc -l | tr -d ' ') line(s) — check whether they are from after the deploy"; WARN=$((WARN+1))
  else green "  none ✅"; fi
}

echo "CoachOS health check — env=$ENV, log window=$SINCE, $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "git: $(git log -1 --format='%h %s' 2>/dev/null)"

# ── 1. Containers ───────────────────────────────────────────────────────────
hdr "CONTAINERS"
$DC ps -a 2>&1 | grep -v '^time='
while IFS='|' read -r svc state health code; do
  [ -z "$svc" ] && continue
  if echo " $ONESHOT " | grep -q " $svc "; then
    if [ "$state" = "exited" ] && [ "$code" != "0" ]; then red "  ❌ $svc exited with code $code"; HARD_FAIL=1; fi
    continue
  fi
  if [ "$state" != "running" ]; then red "  ❌ $svc is $state (exit $code)"; HARD_FAIL=1
  elif [ -n "$health" ] && [ "$health" != "healthy" ]; then red "  ❌ $svc is $health"; HARD_FAIL=1
  fi
done < <($DC ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>/dev/null)
[ $HARD_FAIL -eq 0 ] && green "  all containers up ✅"

# ── 2. Site answers ─────────────────────────────────────────────────────────
hdr "HTTP"
for u in $URLS; do
  # retry for ~60s: right after a restart the app may still be starting
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$u")" || true
    [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 500 ] && break
    sleep 5
  done
  if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ]; then green "  $code  $u ✅"
  else red "  $code  $u ❌"; HARD_FAIL=1; fi
done

# ── 3. App-level checks (DB, versions == lock, broker, worker, tenancy) ────
hdr "DEPLOY CHECK (manage.py deploy_check)"
out="$($DC exec -T "$BACKEND" python manage.py deploy_check 2>&1)"; rc=$?
echo "$out" | grep -vE '^time=|djstripe|^INFOS:|^System check|^\?: |HINT|^$'
[ $rc -ne 0 ] && { red "  ❌ deploy_check failed (exit $rc)"; HARD_FAIL=1; }

# ── 4. Logs (warnings) ──────────────────────────────────────────────────────
BLOGS="$(logs $BACKEND)"
scan "BACKEND errors"   "$(echo "$BLOGS" | grep -iE 'error|exception|traceback|critical' | grep -viE 'djstripe|STRIPE_' | tail -30)"
scan "BACKEND 500s"     "$(echo "$BLOGS" | grep -E '" 5[0-9][0-9] ' | tail -20)"
scan "CELERY errors"    "$(logs $CELERY | grep -vE '\| +\. tasks\.' | grep -iE 'error|critical|traceback|failed|VersionMismatch' | tail -30)"
hdr "CELERY succeeded (last 10)"
logs ${CELERY%% *} | grep succeeded | tail -10 || true
hdr "FRONTEND"
$DC logs --tail 10 "$FRONTEND" 2>&1 | grep -v '^time='
if [ -n "$NGINX" ]; then
  scan "NGINX 404/5xx"  "$(logs $NGINX | grep -E '" (404|5[0-9][0-9]) ' | grep -v favicon | tail -20)"
fi

hdr "APP ErrorLog (last $SINCE)"
$DC exec -T "$BACKEND" python manage.py shell -c "
import re
from apps.accounts.models import ErrorLog
from django.utils import timezone; from datetime import timedelta
s='$SINCE'; n=int(re.sub(r'\D','',s) or 1); unit=s[-1]
delta={'m':timedelta(minutes=n),'h':timedelta(hours=n),'d':timedelta(days=n)}.get(unit,timedelta(hours=1))
q = ErrorLog.objects.filter(created_at__gte=timezone.now()-delta).order_by('-created_at')[:15]
print('\n'.join(f'  {e.created_at:%H:%M} {e.source:6} {e.endpoint[:50]:50} {e.message[:90]}' for e in q) or '  no errors ✅')
print('ERRORLOG_COUNT', len(q))" 2>&1 | grep -vE '^time=|djstripe|^INFOS:|^System check|^\?: |HINT|^$' | tee /tmp/.coachos_errlog_$$ | grep -v ERRORLOG_COUNT
if grep -qE 'ERRORLOG_COUNT [1-9]' /tmp/.coachos_errlog_$$ 2>/dev/null; then yellow "  ⚠ app errors recorded in this window"; WARN=$((WARN+1)); fi
rm -f /tmp/.coachos_errlog_$$

# ── Result ──────────────────────────────────────────────────────────────────
echo
if [ $HARD_FAIL -ne 0 ]; then
  red "RESULT: ❌ UNHEALTHY — a hard check failed. Roll back with: ops/rollback.sh $ENV"
  exit 1
fi
if [ $WARN -ne 0 ]; then yellow "RESULT: ✅ healthy, with $WARN log warning(s) above — read them"
else green "RESULT: ✅ HEALTHY — no warnings"; fi
exit 0
