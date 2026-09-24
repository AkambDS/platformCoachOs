"""
Idempotently provisions the shared "CoachOS Demo" workspace used by the public
"Log In as Demo User" button on the Login page (frontend/src/pages/auth/Login.tsx).

Safe to re-run — every object is keyed by a stable natural key via get_or_create, so
running this again (e.g. to top up data after demo visitors have edited/deleted things)
never creates duplicates. Credentials here must match frontend/src/constants/demo.ts.

Usage (production): docker compose -f docker-compose.prod.yml exec backend \
    python manage.py seed_demo_workspace
"""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import User, Workspace
from apps.activities.models import Activity
from config.middleware import invalidate_demo_workspace_cache
from apps.clients.models import Client, ClientGoal, Commitment, GoalProgress
from apps.invoicing.models import Invoice, InvoiceItem, Payment
from apps.library.models import KnowledgeFolder, KnowledgeItem
from apps.pipeline.models import Deal
from apps.settings_app.views import (
    _seed_activity_types,
    _seed_client_statuses,
    _seed_lead_sources,
    _seed_pipeline_stages,
)

DEMO_SLUG = "coachos-demo"
DEMO_EMAIL = "demo@coachos.rass-consulting.com"
DEMO_PASSWORD = "CoachOSDemo!2026"
DEMO_WORKSPACE_NAME = "CoachOS Demo"

CLIENTS = [
    dict(first_name="Maria", last_name="Chen", company="Chen Strategy Group", job_title="CEO",
         email="maria.chen@example.com", status="Active", active_flag=True, portal_access=True,
         lead_source="referral"),
    dict(first_name="David", last_name="Okafor", company="Okafor & Partners", job_title="Managing Partner",
         email="david.okafor@example.com", status="Active", active_flag=True, portal_access=True,
         lead_source="linkedin"),
    dict(first_name="Priya", last_name="Nair", company="Nair Consulting", job_title="Founder",
         email="priya.nair@example.com", status="Active", active_flag=True, portal_access=False,
         lead_source="website"),
    dict(first_name="Tom", last_name="Whitfield", company="Whitfield Manufacturing", job_title="COO",
         email="tom.whitfield@example.com", status="Lead", active_flag=False, portal_access=False,
         lead_source="conference"),
    dict(first_name="Sarah", last_name="Kim", company="Kim Design Studio", job_title="Creative Director",
         email="sarah.kim@example.com", status="Lead", active_flag=False, portal_access=False,
         lead_source="website"),
    dict(first_name="James", last_name="Rutherford", company="Rutherford Holdings", job_title="President",
         email="james.rutherford@example.com", status="Inactive", active_flag=False, portal_access=False,
         lead_source="referral"),
]

DEALS = [
    # (client index, stage, deal_type, value, probability, next_action)
    (0, "active_client", "retainer", 4500, 100, "Quarterly check-in call"),
    (1, "active_client", "1_1_coaching", 3200, 100, "Send Q3 goals recap"),
    (2, "verbal_yes", "group_program", 6000, 80, "Send contract for signature"),
    (3, "proposal_sent", "corporate_training", 12000, 50, "Follow up on proposal"),
    (4, "discovery_scheduled", "1_1_coaching", 2400, 30, "Confirm discovery call time"),
    (5, "closed_lost", "1_1_coaching", 1800, 0, ""),
]

LIBRARY_ITEMS = [
    ("Coaching Agreement Template", "document", "Standard 1:1 coaching engagement agreement."),
    ("Discovery Call Script", "document", "Talking points for first-call discovery sessions."),
    ("Goal-Setting Worksheet", "document", "Client-facing worksheet used at kickoff."),
]


class Command(BaseCommand):
    help = "Idempotently seed the 'CoachOS Demo' workspace with sample data for the public product tour."

    def handle(self, *args, **options):
        now = timezone.now()

        workspace, ws_created = Workspace.objects.get_or_create(
            slug=DEMO_SLUG,
            defaults=dict(
                name=DEMO_WORKSPACE_NAME,
                owner_email=DEMO_EMAIL,
                plan=Workspace.Plan.GROWTH,
                is_active=True,
                primary_colour="#1B3A6B",
            ),
        )

        owner, user_created = User.objects.get_or_create(
            email=DEMO_EMAIL,
            defaults=dict(
                workspace=workspace,
                full_name="Jordan Reyes",
                role=User.Role.BUSINESS_OWNER,
                password=make_password(DEMO_PASSWORD),
            ),
        )
        if not user_created:
            # Keep the password/workspace pinned in case either drifted (e.g. a prior
            # manual edit) — this command is the single source of truth for this account.
            owner.workspace = workspace
            owner.role = User.Role.BUSINESS_OWNER
            owner.set_password(DEMO_PASSWORD)
            owner.is_active = True
            owner.save()

        # Reuse the exact same builtin-default logic the app applies to every real new
        # workspace on first visit to Settings (apps/settings_app/views.py) — avoids
        # duplicating the stage/status/source/type lists here and risking drift.
        _seed_pipeline_stages(workspace)
        _seed_client_statuses(workspace)
        _seed_lead_sources(workspace)
        _seed_activity_types(workspace)

        clients = {}
        for c in CLIENTS:
            client, _ = Client.objects.get_or_create(
                workspace=workspace, email=c["email"],
                defaults={**c, "coach": owner},
            )
            clients[c["email"]] = client

        client_list = list(clients.values())

        # Goals + commitments + progress for the two flagship active clients.
        goal, _ = ClientGoal.objects.get_or_create(
            workspace=workspace, client=client_list[0], title="Improve executive presence in board meetings",
            defaults=dict(description="Focus on concise framing and confident delivery.",
                          target_date=(now + timedelta(days=60)).date(),
                          status=ClientGoal.Status.ACTIVE, visible_to_client=True, created_by=owner),
        )
        GoalProgress.objects.get_or_create(
            workspace=workspace, client=client_list[0], goal=goal,
            progress_text="Delivered Q3 board update with noticeably tighter structure — strong first step.",
        )
        Commitment.objects.get_or_create(
            workspace=workspace, client=client_list[0],
            text="Draft opening framing for next board meeting before our next session.",
            defaults=dict(created_by=owner),
        )

        goal2, _ = ClientGoal.objects.get_or_create(
            workspace=workspace, client=client_list[1], title="Build a 90-day leadership transition plan",
            defaults=dict(description="Structured plan for the new managing-partner role.",
                          target_date=(now + timedelta(days=90)).date(),
                          status=ClientGoal.Status.ACTIVE, visible_to_client=True, created_by=owner),
        )
        GoalProgress.objects.get_or_create(
            workspace=workspace, client=client_list[1], goal=goal2,
            progress_text="First 30-day milestones reviewed — on track.",
        )

        # Pipeline deals across every stage, so the kanban board looks genuinely populated.
        for idx, stage, deal_type, value, probability, next_action in DEALS:
            Deal.objects.get_or_create(
                workspace=workspace, client=client_list[idx], deal_type=deal_type,
                defaults=dict(
                    coach=owner, stage=stage, deal_value=Decimal(value), probability=probability,
                    next_action=next_action,
                    next_action_date=(now + timedelta(days=3)).date() if next_action else None,
                    expected_close_date=(now + timedelta(days=21)).date(),
                    closed_at=now if stage == "closed_lost" else None,
                ),
            )

        # Activities: a recent past session (completed) + two upcoming ones, so both the
        # Calendar and the Dashboard's "upcoming sessions" widget have content. Keyed on
        # (workspace, client, title) only — start_at/end_at are recomputed from `now` on
        # every run via update_or_create, so re-running keeps the demo's dates "current"
        # instead of drifting into the past or creating duplicate rows each time.
        past_client, upcoming_client = client_list[0], client_list[1]
        Activity.objects.update_or_create(
            workspace=workspace, client=past_client, title="Monthly Coaching Session",
            defaults=dict(
                coach=owner, activity_type=Activity.ActivityType.SESSION,
                status=Activity.Status.COMPLETED,
                start_at=now - timedelta(days=6),
                end_at=now - timedelta(days=6) + timedelta(hours=1),
                notes="Covered Q3 board presentation prep.",
            ),
        )
        Activity.objects.update_or_create(
            workspace=workspace, client=upcoming_client, title="Discovery Follow-Up Call",
            defaults=dict(
                coach=owner, activity_type=Activity.ActivityType.CALL,
                status=Activity.Status.SCHEDULED,
                start_at=now + timedelta(days=2, hours=15),
                end_at=now + timedelta(days=2, hours=16),
            ),
        )
        Activity.objects.update_or_create(
            workspace=workspace, client=past_client, title="Quarterly Coaching Session",
            defaults=dict(
                coach=owner, activity_type=Activity.ActivityType.SESSION,
                status=Activity.Status.SCHEDULED,
                start_at=now + timedelta(days=5, hours=14),
                end_at=now + timedelta(days=5, hours=15),
            ),
        )

        # Invoices: one paid, one sent/outstanding, one overdue — Reports and the
        # Invoices list both have something real to show.
        self._seed_invoice(workspace, owner, client_list[0], "DEMO-1001",
                            Invoice.Status.PAID, Decimal("1500.00"), now - timedelta(days=20), paid=True)
        self._seed_invoice(workspace, owner, client_list[1], "DEMO-1002",
                            Invoice.Status.SENT, Decimal("1200.00"), now + timedelta(days=10), paid=False)
        self._seed_invoice(workspace, owner, client_list[2], "DEMO-1003",
                            Invoice.Status.OVERDUE, Decimal("900.00"), now - timedelta(days=5), paid=False)

        # Library — a folder with a few reference documents.
        folder, _ = KnowledgeFolder.objects.get_or_create(workspace=workspace, name="Coaching Templates", parent=None)
        for title, content_type, description in LIBRARY_ITEMS:
            KnowledgeItem.objects.get_or_create(
                workspace=workspace, folder=folder, title=title,
                defaults=dict(
                    content_type=content_type, description=description,
                    rich_text=f"<p>{description}</p>", uploaded_by=owner,
                    visibility=KnowledgeItem.Visibility.INTERNAL,
                ),
            )

        invalidate_demo_workspace_cache()

        self.stdout.write(self.style.SUCCESS(
            f"Demo workspace ready — login at /login: {DEMO_EMAIL} / {DEMO_PASSWORD}"
        ))

    def _seed_invoice(self, workspace, owner, client, number, invoice_status, amount, due_date, paid):
        invoice, created = Invoice.objects.get_or_create(
            workspace=workspace, number=number,
            defaults=dict(
                client=client, coach=owner, status=invoice_status,
                subtotal=amount, total=amount,
                amount_paid=amount if paid else Decimal("0"),
                due_date=due_date.date() if hasattr(due_date, "date") else due_date,
                issue_date=timezone.now().date(),
                sent_at=timezone.now(), paid_at=timezone.now() if paid else None,
            ),
        )
        if created:
            InvoiceItem.objects.create(
                invoice=invoice, description="Executive Coaching — Monthly Retainer",
                quantity=1, unit_price=amount,
            )
            if paid:
                Payment.objects.create(
                    workspace=workspace, invoice=invoice, amount=amount,
                    method=Payment.Method.STRIPE, paid_at=timezone.now(), recorded_by=owner,
                )
        return invoice
