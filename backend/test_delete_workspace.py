"""
`delete_workspace` management command — local-testing tool that must delete exactly ONE
workspace's data and never touch another workspace's rows.

Run: pytest test_delete_workspace.py -v
"""
import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone


def _populate(tag):
    """A workspace with an owner, a coach, a client and one of most record types."""
    from apps.accounts.models import Workspace, User, WorkspaceInvitation
    from apps.clients.models import Client, ClientNote, ClientGoal, Commitment
    from apps.activities.models import Activity
    from apps.invoicing.models import Invoice, InvoiceItem
    from apps.pipeline.models import Deal
    from apps.library.models import KnowledgeFolder, KnowledgeItem

    ws = Workspace.objects.create(name=f"WS {tag} {uuid.uuid4().hex[:4]}", slug=f"ws-{tag}-{uuid.uuid4().hex[:6]}")
    owner = User.objects.create_user(email=f"owner-{tag}-{uuid.uuid4().hex[:4]}@t.test", password="x" * 12,
                                     full_name="Owner", workspace=ws, role="business_owner")
    coach = User.objects.create_user(email=f"coach-{tag}-{uuid.uuid4().hex[:4]}@t.test", password="x" * 12,
                                     full_name="Coach", workspace=ws, role="coach")
    client = Client.objects.create(workspace=ws, coach=coach, first_name="C", last_name=tag, email=f"c-{tag}@t.test")
    ClientNote.objects.create(workspace=ws, client=client, text="note", created_by=coach)
    ClientGoal.objects.create(workspace=ws, client=client, title="goal")
    Commitment.objects.create(workspace=ws, client=client, text="commit")
    start = timezone.now() + timedelta(days=2)
    Activity.objects.create(workspace=ws, client=client, coach=coach, activity_type="call", title="s",
                            start_at=start, end_at=start + timedelta(hours=1))
    inv = Invoice.objects.create(workspace=ws, client=client, coach=coach, number="INV-0001",
                                 issue_date=date.today(), due_date=date.today())
    InvoiceItem.objects.create(invoice=inv, description="x", quantity=1, unit_price=10)
    Deal.objects.create(workspace=ws, client=client, coach=coach, stage="lead_new")
    folder = KnowledgeFolder.objects.create(workspace=ws, name="f")
    KnowledgeItem.objects.create(workspace=ws, folder=folder, content_type="document", title="d", uploaded_by=owner)
    WorkspaceInvitation.objects.create(workspace=ws, invited_by=owner, email=f"inv-{tag}@t.test", role="coach",
                                       expires_at=timezone.now() + timedelta(days=1))
    return ws, owner, coach, client


def _snapshot(ws):
    """Row counts of everything belonging to `ws`."""
    from django.apps import apps
    out = {}
    for model in apps.get_models():
        if any(f.name == "workspace" and f.is_relation for f in model._meta.fields):
            out[model._meta.label] = model._base_manager.filter(workspace=ws).count()
    return out


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_dry_run_deletes_nothing():
    from apps.accounts.models import Workspace
    a, *_ = _populate("a")
    before = _snapshot(a)
    call_command("delete_workspace", a.slug)
    assert Workspace.objects.filter(pk=a.pk).exists()
    assert _snapshot(a) == before


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_deletes_only_that_workspace():
    from apps.accounts.models import Workspace, User
    from apps.clients.models import Client
    from apps.invoicing.models import InvoiceItem
    a, a_owner, a_coach, a_client = _populate("a")
    b, b_owner, b_coach, b_client = _populate("b")
    b_before = _snapshot(b)
    b_items = InvoiceItem.objects.filter(invoice__workspace=b).count()

    call_command("delete_workspace", a.slug, confirm=a.slug)

    assert not Workspace.objects.filter(pk=a.pk).exists()
    assert not User.objects.filter(pk__in=[a_owner.pk, a_coach.pk]).exists()      # emails reusable
    assert not Client.objects.filter(pk=a_client.pk).exists()
    assert not InvoiceItem.objects.filter(invoice__workspace_id=a.pk).exists()     # no workspace_id column, still gone
    assert _snapshot(b) == b_before                                                 # B untouched
    assert InvoiceItem.objects.filter(invoice__workspace=b).count() == b_items
    assert User.objects.filter(pk__in=[b_owner.pk, b_coach.pk]).count() == 2


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_refuses_when_another_workspace_points_at_it():
    """Like the local Arti case: B's invitation was sent by a user who lives in A. Deleting A
    would cascade into B's row — the command must refuse and change nothing."""
    from apps.accounts.models import Workspace, WorkspaceInvitation
    a, a_owner, *_ = _populate("a")
    b, *_ = _populate("b")
    WorkspaceInvitation.objects.create(workspace=b, invited_by=a_owner, email="cross@t.test", role="coach",
                                       expires_at=timezone.now() + timedelta(days=1))
    b_before = _snapshot(b)
    with pytest.raises(CommandError, match="OTHER workspaces"):
        call_command("delete_workspace", a.slug, confirm=a.slug)
    assert Workspace.objects.filter(pk=a.pk).exists()
    assert _snapshot(b) == b_before


@pytest.mark.django_db
@override_settings(DEBUG=False)
def test_refuses_outside_local_debug():
    a, *_ = _populate("a")
    with pytest.raises(CommandError, match="local testing only"):
        call_command("delete_workspace", a.slug, confirm=a.slug)


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_confirm_must_match_slug():
    from apps.accounts.models import Workspace
    a, *_ = _populate("a")
    with pytest.raises(CommandError, match="repeat the workspace slug"):
        call_command("delete_workspace", a.slug, confirm="wrong")
    assert Workspace.objects.filter(pk=a.pk).exists()


# ── check_tenant_integrity ────────────────────────────────────────────────────

@pytest.mark.django_db
def test_integrity_check_clean_then_flags_cross_workspace_link():
    from io import StringIO
    from apps.activities.models import CoachAvailabilityRule
    a, a_owner, a_coach, a_client = _populate("a")
    b, b_owner, b_coach, b_client = _populate("b")
    out = StringIO()
    call_command("check_tenant_integrity", stdout=out)              # clean → no SystemExit
    assert "CLEAN" in out.getvalue()

    # B's availability rule whose coach lives in A — exactly the leftover a user move creates
    CoachAvailabilityRule.objects.create(workspace=b, coach=a_coach, client=b_client, weekday=0,
                                         start_time="09:00", end_time="10:00")
    out = StringIO()
    with pytest.raises(SystemExit) as exc:
        call_command("check_tenant_integrity", stdout=out)
    assert exc.value.code == 1
    assert "CoachAvailabilityRule.coach" in out.getvalue()
