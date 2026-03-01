"""
CoachOS — accounts/models.py
Workspace, User, WorkspaceModel base, Invitation, AuditLog
"""
import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone as tz   # renamed to avoid clash with timezone CharField


class Workspace(models.Model):
    class Plan(models.TextChoices):
        TRIAL      = "trial",      "Trial"
        STARTER    = "starter",    "Starter"
        GROWTH     = "growth",     "Growth"
        ENTERPRISE = "enterprise", "Enterprise"

    id                 = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name               = models.CharField(max_length=200)
    slug               = models.SlugField(unique=True, max_length=80)
    plan               = models.CharField(max_length=20, choices=Plan.choices, default=Plan.TRIAL)
    stripe_customer_id = models.CharField(max_length=100, blank=True)
    # Branding
    logo_s3_key        = models.CharField(max_length=500, blank=True)
    primary_colour     = models.CharField(max_length=7, default="#1B3A6B")
    # Scheduling defaults
    workspace_timezone      = models.CharField(max_length=64, default="America/New_York")
    buffer_minutes     = models.PositiveSmallIntegerField(default=15)
    cancellation_hours = models.PositiveSmallIntegerField(default=48)
    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workspaces"

    def __str__(self):
        return self.name


class WorkspaceModel(models.Model):
    """Abstract base — every tenant-scoped model must inherit this."""
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="%(app_label)s_%(class)s_set",
        db_index=True,
    )

    class Meta:
        abstract = True


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        email = self.normalize_email(email)
        user  = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("role", "business_owner")
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        BUSINESS_OWNER = "business_owner", "Business Owner"
        COACH          = "coach",          "Coach"
        ASSISTANT      = "assistant",      "Assistant"

    id            = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace     = models.ForeignKey(
        Workspace, on_delete=models.CASCADE,
        null=True, blank=True, related_name="users"
    )
    email         = models.EmailField(unique=True)
    full_name     = models.CharField(max_length=200)
    role          = models.CharField(max_length=20, choices=Role.choices, default=Role.COACH)
    user_timezone = models.CharField(max_length=64, default="America/New_York")  # renamed
    avatar_url    = models.URLField(blank=True)
    is_active     = models.BooleanField(default=True)
    is_staff      = models.BooleanField(default=False)
    date_joined   = models.DateTimeField(default=tz.now)   # uses renamed import

    objects = UserManager()

    USERNAME_FIELD  = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        db_table = "users"

    def __str__(self):
        return f"{self.full_name} <{self.email}>"

    @property
    def is_business_owner(self):
        return self.role == self.Role.BUSINESS_OWNER

    @property
    def can_coach(self):
        return self.role in (self.Role.BUSINESS_OWNER, self.Role.COACH)


class WorkspaceInvitation(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace  = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invitations")
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    email      = models.EmailField()
    role       = models.CharField(max_length=20, choices=User.Role.choices, default=User.Role.COACH)
    token      = models.UUIDField(default=uuid.uuid4, unique=True)
    accepted   = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "workspace_invitations"

    def __str__(self):
        return f"Invite → {self.email} ({self.role})"


class AuditLog(models.Model):
    """Immutable audit trail. Append-only."""
    id         = models.BigAutoField(primary_key=True)
    workspace  = models.ForeignKey(Workspace, on_delete=models.CASCADE, null=True)
    user       = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    action     = models.CharField(max_length=20)
    table_name = models.CharField(max_length=100)
    record_id  = models.CharField(max_length=100)
    diff       = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} {self.table_name}:{self.record_id}"
