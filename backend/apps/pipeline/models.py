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
    stage            = models.CharField(max_length=50, default=Stage.LEAD_NEW)
    stage_changed_at    = models.DateTimeField(auto_now_add=True)
    pipeline_alert_sent_at = models.DateTimeField(null=True, blank=True)
    # Per-deal override of the stage's alert_stop_after_days (PipelineStageConfig) — once
    # set, follow-up alerts for THIS deal stop after this date regardless of the stage
    # default. Blank = use the stage's standard alert_stop_after_days rule.
    alert_stop_date        = models.DateField(null=True, blank=True)
    # How many follow-up alerts have actually gone out to the CLIENT for this deal's
    # current stage visit — separate from pipeline_alert_sent_at (which just tracks "was
    # anything sent today", for the owner+client combined). Compared against the stage's
    # client_alert_max_count so client reminders can stop earlier than the coach's own,
    # even while the coach keeps getting alerted per the stage's day-based stop window.
    # Reset alongside stage_changed_at/pipeline_alert_sent_at in advance_stage() below.
    client_alert_count     = models.PositiveIntegerField(default=0)
    # Last follow-up email to the assigned coach / the client for the current stage visit
    # — each recipient repeats on its own frequency (PipelineStageConfig.*_frequency), so
    # each needs its own "last sent". The owner's is pipeline_alert_sent_at above.
    coach_alert_sent_at    = models.DateTimeField(null=True, blank=True)
    client_alert_sent_at   = models.DateTimeField(null=True, blank=True)
    class DealType(models.TextChoices):
        COACHING_1_1    = "1_1_coaching",       "1:1 Coaching"
        GROUP_PROGRAM   = "group_program",       "Group Program"
        CORPORATE       = "corporate_training",  "Corporate Training"
        WORKSHOP        = "workshop",            "Workshop"
        RETAINER        = "retainer",            "Retainer"
        OTHER           = "other",               "Other"

    deal_value         = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    deal_type          = models.CharField(max_length=30, choices=DealType.choices, blank=True)
    tags               = models.JSONField(default=list, blank=True)
    source             = models.CharField(max_length=100, blank=True)
    notes              = models.TextField(blank=True)
    expected_close_date = models.DateField(null=True, blank=True)
    probability        = models.PositiveSmallIntegerField(null=True, blank=True)  # 0-100
    next_action        = models.CharField(max_length=300, blank=True)
    next_action_date   = models.DateField(null=True, blank=True)
    closed_at          = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pipeline_deal"
        ordering = ["-updated_at"]

    def advance_stage(self, new_stage):
        from django.utils import timezone
        self.stage                  = new_stage
        self.stage_changed_at       = timezone.now()
        self.pipeline_alert_sent_at = None
        self.coach_alert_sent_at    = None
        self.client_alert_sent_at   = None
        self.client_alert_count     = 0
        if new_stage == self.Stage.CLOSED_LOST:
            self.closed_at = timezone.now()
        self.save()


class PipelineStageConfig(WorkspaceModel):
    """Workspace-configurable pipeline stage definitions + follow-up timeline."""
    slug           = models.CharField(max_length=50)
    label          = models.CharField(max_length=50)
    color          = models.CharField(max_length=7, default="#1e3a5f")
    order          = models.PositiveIntegerField(default=0)
    follow_up_days = models.PositiveIntegerField(null=True, blank=True)
    # Alerts start at follow_up_days and repeat per recipient frequency below; they stop
    # once a deal has spent this many days in the stage. Blank = until the deal moves.
    alert_stop_after_days = models.PositiveIntegerField(null=True, blank=True)
    class Frequency(models.TextChoices):
        DAILY   = "daily",   "Daily"
        WEEKLY  = "weekly",  "Weekly"
        MONTHLY = "monthly", "Monthly"

    # Who gets follow-up emails once a deal passes follow_up_days, and how often each
    # one repeats (tasks.pipeline.dispatch_pipeline_alerts) until alert_stop_after_days.
    notify_owner     = models.BooleanField(default=True)
    owner_frequency  = models.CharField(max_length=10, choices=Frequency.choices, default=Frequency.DAILY)
    notify_coach     = models.BooleanField(default=False)
    coach_frequency  = models.CharField(max_length=10, choices=Frequency.choices, default=Frequency.DAILY)
    notify_client    = models.BooleanField(default=False)
    client_frequency = models.CharField(max_length=10, choices=Frequency.choices, default=Frequency.WEEKLY)
    # Which day a weekly / monthly follow-up goes out, per recipient:
    #   {"owner": {"weekday": 0,                       # weekly: 0=Mon … 6=Sun
    #              "month_mode": "day" | "nth",        # monthly: a date, or "Nth <weekday>"
    #              "month_day": 15,                    #   "day": 1–31 (clamped to month end)
    #              "month_week": 1,                    #   "nth": 1–4, or -1 = last
    #              "month_weekday": 0}, "coach": {…}, "client": {…}}
    # Missing keys fall back to Monday / the 1st (tasks.pipeline._scheduled_today).
    alert_schedule   = models.JSONField(default=dict, blank=True)
    # Independent cap on CLIENT reminders specifically — once a deal has received this
    # many client-facing alerts, stop notifying the client, even though the coach (via
    # notify_owner) keeps getting alerted per alert_stop_after_days as before. Blank =
    # no separate cap; client alerts stop only when the coach's own alerts do.
    client_alert_max_count = models.PositiveIntegerField(null=True, blank=True)
    is_builtin     = models.BooleanField(default=False)

    class Meta:
        db_table        = "pipeline_stageconfigconfig"
        unique_together = ["workspace", "slug"]
        ordering        = ["order"]

    def __str__(self):
        return f"{self.workspace} / {self.label} ({self.follow_up_days}d)"


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


class DealProgress(WorkspaceModel):
    """Tracks every field edit on a deal (value, source, notes, tags). Stage moves go to StageHistory."""
    id         = models.BigAutoField(primary_key=True)
    deal       = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="progress_log")
    changed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    field_name = models.CharField(max_length=50)
    old_value  = models.TextField(blank=True)
    new_value  = models.TextField(blank=True)
    note       = models.TextField(blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pipeline_dealprogress"
        ordering = ["-changed_at"]
