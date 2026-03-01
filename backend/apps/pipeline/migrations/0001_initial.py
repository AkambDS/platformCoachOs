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
            name="Deal",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("stage", models.CharField(max_length=30, default="lead_new")),
                ("stage_changed_at", models.DateTimeField(auto_now_add=True)),
                ("deal_value", models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)),
                ("source", models.CharField(max_length=100, blank=True)),
                ("notes", models.TextField(blank=True)),
                ("closed_at", models.DateTimeField(null=True, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_deal_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="deals", to="clients.client",
                )),
                ("coach", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="deals", to="accounts.user",
                )),
            ],
            options={"db_table": "pipeline_deal", "ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="StageHistory",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("from_stage", models.CharField(max_length=30, blank=True)),
                ("to_stage", models.CharField(max_length=30)),
                ("changed_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_stagehistory_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("deal", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="stage_history", to="pipeline.deal",
                )),
                ("changed_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "pipeline_stagehistory", "ordering": ["-changed_at"]},
        ),
    ]
