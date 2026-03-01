"""CoachOS — pipeline/models.py (FR-SF-*)"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel, User
from apps.clients.models import Client


class Deal(WorkspaceModel):
    """Single pipeline deal. Stage history tracked for FR-SF-08."""

    class Stage(models.TextChoices):
        LEAD_NEW             = "lead_new",             "Lead – New"
        DISCOVERY_SCHEDULED  = "discovery_scheduled",  "Discovery Scheduled"
        DISCOVERY_COMPLETED  = "discovery_completed",  "Discovery Completed"
        PROPOSAL_SENT        = "proposal_sent",        "Proposal Sent"
        VERBAL_YES           = "verbal_yes",           "Verbal Yes"
        ACTIVE_CLIENT        = "active_client",        "Active Client"
        ON_HOLD              = "on_hold",              "On Hold"
        CLOSED_LOST          = "closed_lost",          "Closed – Lost"

    id               = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client           = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="deals")
    coach            = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="deals")
    stage            = models.CharField(max_length=30, choices=Stage.choices, default=Stage.LEAD_NEW)
    stage_changed_at = models.DateTimeField(auto_now_add=True)
    deal_value       = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    source           = models.CharField(max_length=100, blank=True)
    notes            = models.TextField(blank=True)
    closed_at        = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pipeline_deal"
        ordering = ["-updated_at"]

    def advance_stage(self, new_stage):
        from django.utils import timezone
        self.stage            = new_stage
        self.stage_changed_at = timezone.now()
        if new_stage == self.Stage.CLOSED_LOST:
            self.closed_at = timezone.now()
        self.save()


class StageHistory(WorkspaceModel):
    """Immutable record of every stage transition (FR-SF-08)."""
    id         = models.BigAutoField(primary_key=True)
    deal       = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="stage_history")
    from_stage = models.CharField(max_length=30, blank=True)
    to_stage   = models.CharField(max_length=30)
    changed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pipeline_stagehistory"
        ordering = ["-changed_at"]
