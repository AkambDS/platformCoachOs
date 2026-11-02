"""Delete ONE workspace and everything that belongs to it — LOCAL TESTING ONLY.

    python manage.py delete_workspace <slug>                    # dry run (default): show what would go
    python manage.py delete_workspace <slug> --confirm <slug>   # actually delete

Multi-tenant safety (PHASE2.md):
* Refuses to run unless settings.DEBUG is on — never in production.
* Builds Django's full delete plan (every cascade) first and REFUSES if any row of another
  workspace would be deleted or modified (e.g. another workspace's invitation that points
  at one of this workspace's users), listing exactly what and where.
* Counts every other workspace's rows before and after, inside one transaction, and rolls
  everything back if any of them changed.
Files in S3/MinIO under this workspace's prefixes are not touched (listed for reference).
"""
from collections import Counter

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models.deletion import Collector

from apps.accounts.models import Workspace

S3_PREFIXES = ("library", "assessments", "message-attachments", "email-template-attachments")


def _ws_id(obj):
    """The workspace an object belongs to, if its model records one."""
    if obj.__class__ is Workspace:
        return obj.pk
    return getattr(obj, "workspace_id", None)


def _other_workspace_counts(ws_id):
    """Row counts per workspace-scoped table for every workspace EXCEPT ws_id."""
    counts = {}
    for model in apps.get_models():
        if any(f.name == "workspace" and f.is_relation for f in model._meta.fields):
            counts[model._meta.label] = model._base_manager.exclude(workspace_id=ws_id).count()
    counts["accounts.Workspace"] = Workspace.objects.exclude(pk=ws_id).count()
    return counts


def delete_with_checks(ws, roots, deleted, foreign):
    """Delete `roots` (and their cascades) after checking every affected row belongs
    to `ws`; tallies counts into `deleted`, problems into `foreign`. Shared with the
    Superadmin console's workspace delete (apps/superadmin/views.py)."""
    collector = Collector(using="default")
    collector.collect(roots)
    for model, objs in collector.data.items():
        for obj in objs:
            deleted[model._meta.label] += 1
            owner = _ws_id(obj)
            if owner is not None and owner != ws.pk:
                foreign.append(f"DELETE {model._meta.label} pk={obj.pk} (workspace {owner})")
    for qs in collector.fast_deletes:
        model = qs.model
        deleted[model._meta.label] += qs.count()
        if any(f.name == "workspace" for f in model._meta.fields):
            for obj in qs.exclude(workspace_id=ws.pk):
                foreign.append(f"DELETE {model._meta.label} pk={obj.pk} (workspace {obj.workspace_id})")
    # Rows that would be MODIFIED (on_delete=SET_NULL etc.) — fine inside this
    # workspace, not fine if they belong to another one.
    for (field, _value), batches in collector.field_updates.items():
        for batch in batches:
            for obj in batch:
                owner = _ws_id(obj)
                if owner is not None and owner != ws.pk:
                    foreign.append(f"UPDATE {obj._meta.label}.{field.name} pk={obj.pk} (workspace {owner})")
    if not foreign:
        collector.delete()


class Command(BaseCommand):
    help = "LOCAL TESTING ONLY: delete one workspace and all of its data (dry run by default)."

    def add_arguments(self, parser):
        parser.add_argument("slug")
        parser.add_argument("--confirm", metavar="SLUG", help="Repeat the slug to actually delete.")

    def handle(self, slug, confirm=None, **opts):
        if not settings.DEBUG:
            raise CommandError("Refusing: delete_workspace is for local testing only (DEBUG is off).")
        try:
            ws = Workspace.objects.get(slug=slug)
        except Workspace.DoesNotExist:
            raise CommandError(f"No workspace with slug '{slug}'.")
        if confirm is not None and confirm != slug:
            raise CommandError("--confirm must repeat the workspace slug exactly.")

        from apps.invoicing.models import Invoice, Payment
        deleted, foreign = Counter(), []
        before = _other_workspace_counts(ws.pk)
        ws_label = f"{ws.name} | slug={ws.slug} | id={ws.pk} | created {ws.created_at:%Y-%m-%d}"

        class _DryRun(Exception):
            pass

        try:
            with transaction.atomic():
                # Payment→Invoice and Invoice→Client are on_delete=PROTECT, so remove this
                # workspace's payments, then invoices, before the workspace cascade.
                for roots in (list(Payment.objects.filter(workspace=ws)),
                              list(Invoice.objects.filter(workspace=ws)),
                              [ws]):
                    if roots and not foreign:
                        delete_with_checks(ws, roots, deleted, foreign)
                if foreign:
                    raise _DryRun()
                after = _other_workspace_counts(ws.pk)
                changed = {k: (before[k], after.get(k)) for k in before if before[k] != after.get(k)}
                if changed:
                    raise CommandError(f"Rolled back: other workspaces' row counts changed: {changed}")
                if confirm is None:
                    raise _DryRun()
        except _DryRun:
            pass   # everything above rolled back

        self.stdout.write(f"Workspace: {ws_label}")
        self.stdout.write("Deleted:" if (confirm and not foreign) else "Would delete:")
        for label, n in sorted(deleted.items()):
            self.stdout.write(f"  {n:6d}  {label}")
        self.stdout.write("S3/MinIO files are NOT deleted; this workspace's prefixes: "
                          + ", ".join(f"{p}/{ws.pk}/" for p in S3_PREFIXES))
        if foreign:
            # "DELETE app.Model pk=… (workspace …)" → summarise per action/table/workspace
            summary = Counter(f.split(" pk=")[0] + " in workspace " + f.rsplit("(workspace ", 1)[1].rstrip(")")
                              for f in foreign)
            names = dict(Workspace.objects.values_list("id", "name"))
            lines = [f"{n:5d} × {k}" for k, n in summary.most_common()]
            lines = [l.replace(str(wid), f"{wid} ({wname})") for l in lines for wid, wname in [next(
                ((w, nm) for w, nm in names.items() if str(w) in l), ("", ""))]]
            raise CommandError("Refusing (nothing deleted): this would touch OTHER workspaces' rows:\n  "
                               + "\n  ".join(lines)
                               + "\nFix or reassign those rows first, then re-run.")
        if confirm is None:
            self.stdout.write(self.style.WARNING(f"Dry run — nothing deleted. To delete: --confirm {slug}"))
            return
        self.stdout.write(self.style.SUCCESS(
            f"Deleted workspace '{ws.name}' and all of its data. Other workspaces unchanged "
            f"({sum(before.values())} rows checked across {len(before)} tables)."))
