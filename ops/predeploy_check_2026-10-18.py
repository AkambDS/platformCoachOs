# CoachOS — PROD pre-deploy impact check for change_log_2026-10-18.md
#
# READ-ONLY: only SELECTs and one GET to Resend; changes nothing. Written against the
# CURRENT prod code (uses no field added by this release), so run it BEFORE deploying:
#
#   cd ~/platformCoachOs && git pull
#   docker compose -f docker-compose.prod.yml exec -T backend python manage.py shell \
#       < ops/predeploy_check_2026-10-18.py 2>&1 | grep -v "^time="
#
# GATE lines must all be PASS before deploying. INFO lines say who notices what.
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.db import connection
from django.db.models import Count, F, Max, Q
from django.utils import timezone

from apps.accounts.models import User, Workspace, WorkspaceInvitation, WorkspaceRegistrationToken
from apps.accounts.permissions import has_tab_access
from apps.clients.models import Client, Assessment
from apps.library.models import KnowledgeItem
from apps.invoicing.models import Invoice
from apps.activities.models import Activity
from apps.pipeline.models import Deal

now = timezone.now()
gates = []


def gate(name, ok, detail=""):
    gates.append((name, ok))
    print(f"  GATE {'PASS ✅' if ok else 'FAIL ❌'}  {name}{('  — ' + detail) if detail else ''}")


def hdr(t):
    print(f"\n── {t} " + "─" * max(0, 70 - len(t)))


db = settings.DATABASES["default"]
print(f"CoachOS pre-deploy check  {now:%Y-%m-%d %H:%M} UTC  | DB {db.get('NAME')} @ {str(db.get('HOST'))[:40]}")
print(f"workspaces={Workspace.objects.count()}  users={User.objects.count()}  clients={Client.objects.count()}")

# ── 1. Migration 0022 (one business owner per workspace) ───────────────────────
hdr("1. Migration 0022: one business owner per workspace")
owners = Workspace.objects.annotate(n=Count("users", filter=Q(users__role="business_owner")))
multi = [(w.slug, list(w.users.filter(role="business_owner").values_list("email", flat=True)))
         for w in owners.filter(n__gt=1)]
gate("no workspace has 2+ owners (else migration 0022 fails and the backend won't start)", not multi, str(multi) if multi else "")
for w in owners.filter(n=0):
    print(f"  INFO  workspace with no owner (allowed): {w.name} ({w.slug})")

# ── 2. Cross-workspace links (same logic as the new check_tenant_integrity) ────
hdr("2. No row links to another workspace's data")
cross = []
for model in apps.get_models():
    if not any(f.name == "workspace" and f.is_relation for f in model._meta.fields):
        continue
    for field in model._meta.fields:
        rel = field.related_model
        if (not field.is_relation or field.name == "workspace" or rel is None
                or not any(f.name == "workspace" and f.is_relation for f in rel._meta.fields)):
            continue
        qs = (model._base_manager.filter(workspace__isnull=False, **{f"{field.name}__isnull": False})
              .exclude(**{f"{field.name}__workspace_id": F("workspace_id")}))
        if rel is User:
            qs = qs.exclude(**{f"{field.name}__role": "platform_admin"})
        n = qs.count()
        if n:
            cross.append(f"{n} × {model._meta.label}.{field.name}")
gate("no cross-workspace links (else a workspace delete is refused with 409)", not cross, "; ".join(cross))

# ── 3. OnlyOffice (DB-6 fails closed without the secret) ───────────────────────
hdr("3. OnlyOffice document editing")
lib_files = KnowledgeItem.objects.exclude(s3_key="").count()
asm_files = Assessment.objects.exclude(file_s3_key="").count()
has_secret = bool(getattr(settings, "ONLYOFFICE_JWT_SECRET", ""))
gate("ONLYOFFICE_JWT_SECRET is set in the backend (else ALL editing/preview stops)", has_secret,
     f"{lib_files} library files + {asm_files} client files depend on it")
print(f"  INFO  ONLYOFFICE_SERVER_URL   = {getattr(settings, 'ONLYOFFICE_SERVER_URL', '')}")
print(f"  INFO  ONLYOFFICE_INTERNAL_URL = {getattr(settings, 'ONLYOFFICE_INTERNAL_URL', '')}")
print("  INFO  also compare the secret with the onlyoffice container: change log P4")

# ── 4. Pending team invites with a role that is no longer invitable ───────────
hdr("4. Pending team invites (owners can now invite only coach/assistant/limited)")
bad_inv = WorkspaceInvitation.objects.filter(accepted=False, expires_at__gt=now,
                                             role__in=["business_owner", "platform_admin"])
gate("no pending invite for role business_owner/platform_admin", not bad_inv.exists(),
     "; ".join(f"{i.workspace.slug}: {i.email} as {i.role}" for i in bad_inv[:10]))
print(f"  INFO  pending team invites (any role): "
      f"{WorkspaceInvitation.objects.filter(accepted=False, expires_at__gt=now).count()}  (unaffected)")

# ── 5. Who notices what, per workspace ─────────────────────────────────────────
hdr("5. Per-workspace impact (nobody needs to log in to check this)")
print(f"  {'workspace':28} {'active':6} {'users':>5} {'non-owner':>9} {'no-CSV':>6} {'portal':>6} {'files':>5}")
for w in Workspace.objects.order_by("created_at"):
    users = list(w.users.all())
    non_owner = [u for u in users if u.role in ("coach", "assistant", "limited")]
    loses_csv = [u for u in users if u.role == "coach" and not has_tab_access(u, "clients", "edit")]
    portal = Client.objects.filter(workspace=w, portal_access=True).count()
    files = (KnowledgeItem.objects.filter(workspace=w).exclude(s3_key="").count()
             + Assessment.objects.filter(workspace=w).exclude(file_s3_key="").count())
    print(f"  {w.name[:28]:28} {'yes' if w.is_active else 'no':6} {len(users):>5} {len(non_owner):>9} "
          f"{len(loses_csv):>6} {portal:>6} {files:>5}")
print("  non-owner = coaches/assistants who will no longer see 'Invite to Portal' (owner-only now)")
print("  no-CSV    = coaches whose Clients tab is view-only → 'Import CSV' button disappears")
print("  portal    = portal clients; their login screen shows neutral CoachOS branding until")
print("              their next login (old invite links have no ?ws=)")
print("  files     = documents opened in OnlyOffice → re-test one after deploy (change log)")

# ── 5b. Row counts — SAVE THIS OUTPUT; the post-deploy check prints the same table ──
hdr("5b. Row counts per workspace (compare with the post-deploy check)")
print(f"  {'slug':30} {'users':>5} {'clients':>7} {'invoices':>8} {'sessions':>8} {'deals':>5} {'library':>7}")
for w in Workspace.objects.order_by("slug"):
    print(f"  {w.slug[:30]:30} {w.users.count():>5} {Client.objects.filter(workspace=w).count():>7} "
          f"{Invoice.objects.filter(workspace=w).count():>8} {Activity.objects.filter(workspace=w).count():>8} "
          f"{Deal.objects.filter(workspace=w).count():>5} {KnowledgeItem.objects.filter(workspace=w).count():>7}")

# ── 6. Deploy timing: is anyone working right now? ─────────────────────────────
hdr("6. Deploy timing (open OnlyOffice editors can't save after deploy)")
recent = now - timedelta(hours=2)
from apps.audit.models import AccessLog
for w in Workspace.objects.filter(is_active=True).order_by("name"):
    last_seen = AccessLog.objects.filter(workspace=w).aggregate(m=Max("created_at"))["m"]
    logged_in = w.users.filter(last_login__gte=recent).count()
    edits = (KnowledgeItem.objects.filter(workspace=w, updated_at__gte=recent).count()
             + Assessment.objects.filter(workspace=w, updated_at__gte=recent).count())
    if last_seen and last_seen >= now - timedelta(hours=24) or logged_in or edits:
        ago = f"{int((now - last_seen).total_seconds() // 60)} min ago" if last_seen else "—"
        flag = "  ⚠ wait for a quieter time" if (last_seen and last_seen >= now - timedelta(minutes=30)) or edits else ""
        print(f"  INFO  {w.name[:28]:28} last action {ago:>14} | logins <2h: {logged_in} | docs edited <2h: {edits}{flag}")
print("  (workspaces not listed: no activity in the last 24h)")

# ── 7. Unused workspace-invite links ───────────────────────────────────────────
hdr("7. Unused workspace-invite links (register email is now locked to the invite)")
for t in WorkspaceRegistrationToken.objects.filter(used=False).order_by("-created_at")[:20]:
    state = "expired" if t.expires_at <= now else f"active until {t.expires_at:%b %d}"
    note = "  ⚠ no recipient email: not locked" if not t.recipient_email else ""
    print(f"  INFO  {t.recipient_name or '—':24} {t.recipient_email or '—':34} {state}{note}")

# ── 8. Today's pre-login branding (changes to neutral CoachOS) ─────────────────
hdr("8. /login and /register branding")
shown = Workspace.objects.filter(is_active=True).order_by("created_at").first()
print(f"  INFO  today /login shows: '{shown.name if shown else 'CoachOS'}'"
      f"{' (with its logo)' if shown and shown.logo_data else ''} → after deploy: 'CoachOS'")

# ── 9. Resend key (only decides whether 'Delivered' shows) ─────────────────────
hdr("9. Resend API key permission")
try:
    import requests
    key = getattr(settings, "RESEND_API_KEY", "") or (
        settings.EMAIL_HOST_PASSWORD if "resend" in (settings.EMAIL_HOST or "") else "")
    if not key:
        print("  INFO  no Resend key found → invites go over SMTP, status stays 'Sent'")
    else:
        r = requests.get("https://api.resend.com/domains", headers={"Authorization": f"Bearer {key}"}, timeout=10)
        print("  INFO  " + ("full access ✅ → 'Delivered' will show" if r.status_code == 200 else
                           f"HTTP {r.status_code}: sending-only key → invites send, status stays 'Sent'"))
except Exception as e:
    print(f"  INFO  Resend check skipped: {e}")

# ── Summary ────────────────────────────────────────────────────────────────────
hdr("SUMMARY")
failed = [n for n, ok in gates if not ok]
print("  ✅ ALL GATES PASS — safe to deploy (pick a quiet time from section 6)" if not failed
      else "  ❌ DO NOT DEPLOY — fix first:\n    - " + "\n    - ".join(failed))
