import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("accounts", "0001_initial"),
        ("clients", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Activity",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("activity_type", models.CharField(max_length=20)),
                ("title", models.CharField(max_length=300)),
                ("status", models.CharField(max_length=20, default="scheduled")),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                ("location", models.CharField(max_length=300, blank=True)),
                ("notes", models.TextField(blank=True)),
                ("rrule", models.TextField(blank=True)),
                ("recurrence_id", models.UUIDField(null=True, blank=True)),
                ("google_cal_uid", models.CharField(max_length=500, blank=True)),
                ("caldav_uid", models.CharField(max_length=500, blank=True)),
                ("edit_history", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_activity_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("coach", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="activities", to="accounts.user",
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="activities", to="clients.client",
                )),
            ],
            options={"db_table": "activities_activity", "ordering": ["-start_at"]},
        ),
    ]
