import uuid
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [('auth', '0001_initial'), ('contenttypes', '0001_initial')]

    operations = [
        migrations.CreateModel(
            name="Workspace",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("name", models.CharField(max_length=200)),
                ("slug", models.SlugField(unique=True, max_length=80)),
                ("plan", models.CharField(max_length=20, default="trial",
                    choices=[("trial","Trial"),("starter","Starter"),("growth","Growth"),("enterprise","Enterprise")])),
                ("stripe_customer_id", models.CharField(max_length=100, blank=True)),
                ("logo_s3_key", models.CharField(max_length=500, blank=True)),
                ("primary_colour", models.CharField(max_length=7, default="#1B3A6B")),
                ("workspace_timezone", models.CharField(max_length=64, default="America/New_York")),
                ("buffer_minutes", models.PositiveSmallIntegerField(default=15)),
                ("cancellation_hours", models.PositiveSmallIntegerField(default=48)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "workspaces"},
        ),
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(default=False)),
                ("email", models.EmailField(unique=True)),
                ("full_name", models.CharField(max_length=200)),
                ("role", models.CharField(max_length=20, default="coach",
                    choices=[("business_owner","Business Owner"),("coach","Coach"),("assistant","Assistant")])),
                ("user_timezone", models.CharField(max_length=64, default="America/New_York")),
                ("avatar_url", models.URLField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("is_staff", models.BooleanField(default=False)),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now)),
                ("workspace", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="users",
                    to="accounts.workspace",
                )),
            ],
            options={"db_table": "users"},
        ),
        migrations.CreateModel(
            name="WorkspaceInvitation",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("email", models.EmailField()),
                ("role", models.CharField(max_length=20, default="coach")),
                ("token", models.UUIDField(default=uuid.uuid4, unique=True)),
                ("accepted", models.BooleanField(default=False)),
                ("expires_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="invitations",
                    to="accounts.workspace",
                )),
                ("invited_by", models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "workspace_invitations"},
        ),
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("action", models.CharField(max_length=20)),
                ("table_name", models.CharField(max_length=100)),
                ("record_id", models.CharField(max_length=100)),
                ("diff", models.JSONField(default=dict)),
                ("ip_address", models.GenericIPAddressField(null=True, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("workspace", models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    to="accounts.workspace",
                )),
                ("user", models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "audit_log", "ordering": ["-created_at"]},
        ),
        # Required by PermissionsMixin
        migrations.AddField(
            model_name="user",
            name="groups",
            field=models.ManyToManyField(
                blank=True, related_name="user_set", related_query_name="user",
                to="auth.Group", verbose_name="groups",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="user_permissions",
            field=models.ManyToManyField(
                blank=True, related_name="user_set", related_query_name="user",
                to="auth.Permission", verbose_name="user permissions",
            ),
        ),
    ]
