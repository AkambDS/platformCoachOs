import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("activities", "0011_activity_client_confirmed"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="client_rsvp_status",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("needsAction", "Needs Action"),
                    ("accepted", "Accepted"),
                    ("declined", "Declined"),
                    ("tentative", "Tentative"),
                ],
                default="needsAction",
            ),
        ),
        migrations.AddField(
            model_name="activity",
            name="client_rsvp_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="GoogleCalendarWatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("channel_id", models.UUIDField(default=uuid.uuid4, editable=False)),
                ("resource_id", models.CharField(blank=True, max_length=200)),
                ("sync_token", models.TextField(blank=True)),
                ("expiration", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("coach", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="calendar_watch", to="accounts.user",
                )),
            ],
            options={"db_table": "activities_googlecalendarwatch"},
        ),
    ]
