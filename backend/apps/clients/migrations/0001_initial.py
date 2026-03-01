import uuid
import django.contrib.postgres.fields
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Client",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("first_name", models.CharField(max_length=100)),
                ("last_name", models.CharField(max_length=100)),
                ("company", models.CharField(max_length=200, blank=True)),
                ("job_title", models.CharField(max_length=200, blank=True)),
                ("email", models.EmailField()),
                ("phone", models.CharField(max_length=30, blank=True)),
                ("website", models.URLField(blank=True)),
                ("linkedin_url", models.URLField(blank=True)),
                ("primary_address", models.JSONField(default=dict, blank=True)),
                ("billing_address", models.JSONField(default=dict, blank=True)),
                ("tags", django.contrib.postgres.fields.ArrayField(
                    base_field=models.CharField(max_length=50), default=list, blank=True)),
                ("active_flag", models.BooleanField(default=False)),
                ("portal_access", models.BooleanField(default=False)),
                ("lead_source", models.CharField(max_length=20, blank=True)),
                ("birth_date", models.DateField(null=True, blank=True)),
                ("anniversary_date", models.DateField(null=True, blank=True)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_client_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("coach", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="clients", to="accounts.user",
                )),
            ],
            options={"db_table": "clients_client", "ordering": ["last_name", "first_name"]},
        ),
        migrations.CreateModel(
            name="Assessment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("assessment_type", models.CharField(max_length=20)),
                ("date", models.DateField()),
                ("file_s3_key", models.CharField(max_length=500)),
                ("file_name", models.CharField(max_length=255)),
                ("visible_to_client", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_assessment_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="assessments", to="clients.client",
                )),
                ("uploaded_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "clients_assessment", "ordering": ["-date"]},
        ),
        migrations.CreateModel(
            name="ClientGoal",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("title", models.CharField(max_length=300)),
                ("description", models.TextField(blank=True)),
                ("target_date", models.DateField(null=True, blank=True)),
                ("status", models.CharField(max_length=20, default="active")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_clientgoal_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="goals", to="clients.client",
                )),
                ("created_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "clients_clientgoal", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Commitment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("text", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_commitment_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="commitments", to="clients.client",
                )),
                ("created_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "clients_commitment", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="GoalProgress",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("progress_text", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_goalprogress_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="progress_entries", to="clients.client",
                )),
                ("goal", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="progress_entries", to="clients.clientgoal",
                )),
            ],
            options={"db_table": "clients_goalprogress", "ordering": ["-created_at"]},
        ),
    ]
