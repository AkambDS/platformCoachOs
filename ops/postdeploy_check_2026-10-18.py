# CoachOS — PROD post-deploy check for change_log_2026-10-18.md
#
# READ-ONLY. Run right after `make deploy`, and again ~1 hour later:
#
#   docker compose -f docker-compose.prod.yml exec -T backend python manage.py shell \
#       < ops/postdeploy_check_2026-10-18.py 2>&1 | grep -v "^time="
#
# Lets you confirm LMT (and every workspace) is fine WITHOUT logging in as them:
# row counts unchanged vs the pre-deploy output, no new errors, and their own
# activity since the deploy is going through.
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, Max
from django.utils import timezone

from apps.accounts.models import ErrorLog, User, Workspace, WorkspaceRegistrationToken
from apps.audit.models import AccessLog
from apps.clients.models import Client
from apps.invoicing.models import Invoice
from apps.activities.models import Activity
from apps.pipeline.models import Deal
from apps.library.models import KnowledgeItem

now = timezone.now()
ok_all = True


def check(name, ok, detail=""):
    global ok_all
    ok_all &= bool(ok)
    print(f"  {'PASS ✅' if ok else 'FAIL ❌'}  {name}{('  — ' + detail) if detail else ''}")


def hdr(t):
    print(f"\n── {t} " + "─" * max(0, 70 - len(t)))


# When did this deploy happen? = when 0023 was applied.
mig = MigrationRecorder.Migration.objects.filter(app="accounts", name__startswith="0023").first()
deployed_at = mig.applied if mig else None
print(f"CoachOS post-deploy check  {now:%Y-%m-%d %H:%M} UTC")

hdr("1. Migrations")
for name in ("0022_one_business_owner_per_workspace", "0023_registration_token_email_tracking"):
    check(f"accounts.{name} applied", MigrationRecorder.Migration.objects.filter(app="accounts", name=name).exists())
with connection.cursor() as c:
    c.execute("SELECT 1 FROM pg_indexes WHERE indexname = 'one_business_owner_per_workspace'")
    check("unique index one_business_owner_per_workspace exists in Postgres", c.fetchone() is not None)
check("invite-tracking columns readable", WorkspaceRegistrationToken.objects.values("email_status", "email_send_count").count() >= 0)
if deployed_at:
    print(f"  deployed (0023 applied) at {deployed_at:%Y-%m-%d %H:%M} UTC — {int((now - deployed_at).total_seconds() // 60)} min ago")

hdr("2. Config the new code depends on")
check("ONLYOFFICE_JWT_SECRET set (document editing)", bool(getattr(settings, "ONLYOFFICE_JWT_SECRET", "")))
check("DEFAULT_FROM_EMAIL on the verified domain", "@rass-consulting.com" in settings.DEFAULT_FROM_EMAIL, settings.DEFAULT_FROM_EMAIL)

hdr("3. Row counts per workspace — must equal the pre-deploy table (section 5b)")
print(f"  {'slug':30} {'users':>5} {'clients':>7} {'invoices':>8} {'sessions':>8} {'deals':>5} {'library':>7}")
for w in Workspace.objects.order_by("slug"):
    print(f"  {w.slug[:30]:30} {w.users.count():>5} {Client.objects.filter(workspace=w).count():>7} "
          f"{Invoice.objects.filter(workspace=w).count():>8} {Activity.objects.filter(workspace=w).count():>8} "
          f"{Deal.objects.filter(workspace=w).count():>5} {KnowledgeItem.objects.filter(workspace=w).count():>7}")
print("  (a difference is only OK if that workspace's own users added/removed data since the pre-check)")

hdr("4. Errors since the deploy (ErrorLog = unhandled API 500s + Celery task failures)")
since = deployed_at or (now - timedelta(hours=1))
errs = ErrorLog.objects.filter(created_at__gte=since)
check(f"no new errors since {since:%H:%M} UTC", not errs.exists(), f"{errs.count()} error(s) — details below")
for e in errs.order_by("-created_at")[:15]:
    ws = e.workspace.name if e.workspace else "—"
    print(f"     {e.created_at:%H:%M}  {ws[:22]:22} {e.source:6} {e.endpoint[:60]}  {str(getattr(e, 'message', ''))[:80]}")

hdr("5. Real usage since the deploy (each workspace's own actions are succeeding)")
rows = (AccessLog.objects.filter(created_at__gte=since).values("workspace__name")
        .annotate(n=Count("id"), last=Max("created_at")).order_by("-n"))
for r in rows:
    print(f"  {r['workspace__name'][:30]:30} {r['n']:>4} actions, last at {r['last']:%H:%M} UTC")
if not rows:
    print("  no workspace activity yet — re-run this later (e.g. after LMT's owner has used the app)")
recent_logins = User.objects.filter(last_login__gte=since).values_list("workspace__name", flat=True)
print(f"  logins since deploy: {sorted(set(n or '—' for n in recent_logins)) or 'none yet'}")

hdr("6. New features")
for t in WorkspaceRegistrationToken.objects.filter(email_sent_at__gte=since).order_by("-email_sent_at")[:10]:
    print(f"  invite email → {t.recipient_email:34} status={t.email_status or '—':12} sent×{t.email_send_count}"
          f"{'  tracked by Resend id' if t.resend_email_id else ''}")
from apps.accounts.models import AuditLog
for a in AuditLog.objects.filter(action="delete_workspace", created_at__gte=since):
    print(f"  workspace deleted: {a.diff.get('name')} ({a.diff.get('slug')}) by {a.user.email if a.user else '—'}")

hdr("SUMMARY")
print("  ✅ all checks pass" if ok_all else "  ❌ something failed — see above (rollback steps: change log)")
