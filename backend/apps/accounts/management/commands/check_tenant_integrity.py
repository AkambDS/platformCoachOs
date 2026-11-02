"""Read-only multi-tenant integrity check (PHASE2.md).

    python manage.py check_tenant_integrity

Reports, without changing anything:
  1. Workspaces with more than one business owner, or none.
  2. Rows whose link points at a record that belongs to a DIFFERENT workspace
     (e.g. a session in workspace A whose coach is a user of workspace B).
Skipped as legitimate: rows that belong to no workspace (platform-level logs) and links to
the CoachOS Superadmin (platform_admin — e.g. support replies on a customer's ticket).

Exit code 0 = clean, 1 = problems found (usable as a pre-deploy gate).
"""
import sys

from django.apps import apps
from django.core.management.base import BaseCommand
from django.db.models import Count, F, Q

from apps.accounts.models import User, Workspace


def _has_workspace(model):
    return any(f.name == "workspace" and f.is_relation for f in model._meta.fields)


class Command(BaseCommand):
    help = "Read-only check that no data crosses workspace boundaries (exit 1 if problems)."

    def handle(self, **opts):
        problems = 0

        # ── 1. One business owner per workspace ────────────────────────────────
        owners = Workspace.objects.annotate(n=Count("users", filter=Q(users__role="business_owner")))
        multi, none = list(owners.filter(n__gt=1)), list(owners.filter(n=0))
        self.stdout.write("1. Workspace owners")
        for w in multi:
            emails = list(w.users.filter(role="business_owner").values_list("email", flat=True))
            self.stdout.write(self.style.ERROR(f"   MORE than one owner: {w.name} ({w.slug}) {emails}"))
        for w in none:
            self.stdout.write(self.style.WARNING(f"   no owner: {w.name} ({w.slug})"))
        problems += len(multi)
        if not multi and not none:
            self.stdout.write("   ok — every workspace has exactly one owner")

        # ── 2. Links that cross a workspace boundary ───────────────────────────
        self.stdout.write("2. Cross-workspace links")
        cross = 0
        for model in apps.get_models():
            if not _has_workspace(model):
                continue
            for field in model._meta.fields:
                if not field.is_relation or field.name == "workspace" or not _has_workspace(field.related_model):
                    continue
                qs = (model._base_manager
                      .filter(workspace__isnull=False, **{f"{field.name}__isnull": False})
                      .exclude(**{f"{field.name}__workspace_id": F("workspace_id")}))
                if field.related_model is User:
                    qs = qs.exclude(**{f"{field.name}__role": "platform_admin"})
                n = qs.count()
                if not n:
                    continue
                cross += n
                pairs = sorted({(str(a), str(b)) for a, b in
                                qs.values_list("workspace__name", f"{field.name}__workspace__name")[:500]})
                self.stdout.write(self.style.ERROR(
                    f"   {n:6d}  {model._meta.label}.{field.name} -> {field.related_model._meta.label}"
                    f"   (row workspace → linked workspace) e.g. {pairs[:3]}"))
        problems += cross
        if not cross:
            self.stdout.write("   ok — no row links to another workspace's data")

        if problems:
            self.stdout.write(self.style.ERROR(f"PROBLEMS FOUND: {problems}"))
            sys.exit(1)
        self.stdout.write(self.style.SUCCESS("CLEAN — tenant isolation intact"))
