"""CoachOS — clients/models.py (FR-CRM-*)"""
import uuid
from django.contrib.postgres.fields import ArrayField
from django.db import models
from apps.accounts.models import WorkspaceModel, User


class Client(WorkspaceModel):
    """Core client CRM record (FR-CRM-01 to 15)."""
    class LeadSource(models.TextChoices):
        REFERRAL   = "referral",    "Referral"
        WEBSITE    = "website",     "Website"
        LINKEDIN   = "linkedin",    "LinkedIn"
        CONFERENCE = "conference",  "Conference"
        OTHER      = "other",       "Other"

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coach        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="clients")
    # Core fields
    first_name   = models.CharField(max_length=100)
    last_name    = models.CharField(max_length=100)
    company      = models.CharField(max_length=200, blank=True)
    job_title    = models.CharField(max_length=200, blank=True)
    email        = models.EmailField()
    phone        = models.CharField(max_length=30, blank=True)
    website      = models.URLField(blank=True)
    linkedin_url = models.URLField(blank=True)
    # Address
    primary_address  = models.JSONField(default=dict, blank=True)
    billing_address  = models.JSONField(default=dict, blank=True)
    # CRM metadata (FR-CRM-02/03/06)
    tags         = ArrayField(models.CharField(max_length=50), default=list, blank=True)
    active_flag  = models.BooleanField(default=False, help_text="Manually set by coach (FR-CRM-03)")
    portal_access = models.BooleanField(default=False, help_text="Enables client portal login (FR-CP-11)")
    lead_source  = models.CharField(max_length=20, choices=LeadSource.choices, blank=True)
    birth_date   = models.DateField(null=True, blank=True)
    anniversary_date = models.DateField(null=True, blank=True)
    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_client"
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"


class Assessment(WorkspaceModel):
    """Assessment PDFs uploaded per client (FR-CRM-10 to 13)."""
    class AssessmentType(models.TextChoices):
        DISC       = "disc",       "DISC"
        MOTIVATORS = "motivators", "Motivators"
        OTHER      = "other",      "Other"

    id               = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client           = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="assessments")
    assessment_type  = models.CharField(max_length=20, choices=AssessmentType.choices)
    date             = models.DateField()
    file_s3_key      = models.CharField(max_length=500)
    file_name        = models.CharField(max_length=255)
    visible_to_client = models.BooleanField(default=False, help_text="Shows in portal (FR-CP-12)")
    uploaded_by      = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_assessment"
        ordering = ["-date"]


class ClientGoal(WorkspaceModel):
    """Goals per client, set by coach (FR-CP-02)."""
    class Status(models.TextChoices):
        ACTIVE    = "active",    "Active"
        COMPLETED = "completed", "Completed"
        PAUSED    = "paused",    "Paused"

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client      = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="goals")
    title       = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    target_date = models.DateField(null=True, blank=True)
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    created_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_clientgoal"
        ordering = ["-created_at"]


class Commitment(WorkspaceModel):
    """Post-session commitment recorded by coach (FR-CP-03)."""
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client     = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="commitments")
    activity   = models.ForeignKey("activities.Activity", on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="commitments")
    text       = models.TextField()
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_commitment"
        ordering = ["-created_at"]


class GoalProgress(WorkspaceModel):
    """Free-form progress entry by client (FR-CP-04)."""
    id            = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client        = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="progress_entries")
    goal          = models.ForeignKey(ClientGoal, on_delete=models.CASCADE, related_name="progress_entries")
    progress_text = models.TextField()
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_goalprogress"
        ordering = ["-created_at"]
