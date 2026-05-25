import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0005_rework_pipelinestageconfig_schema"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="deal",
            name="tags",
            field=models.JSONField(default=list, blank=True),
        ),
        migrations.CreateModel(
            name="DealProgress",
            fields=[
                ("id",         models.BigAutoField(primary_key=True)),
                ("field_name", models.CharField(max_length=50)),
                ("old_value",  models.TextField(blank=True)),
                ("new_value",  models.TextField(blank=True)),
                ("note",       models.TextField(blank=True)),
                ("changed_at", models.DateTimeField(auto_now_add=True)),
                ("deal",       models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="progress_log",
                    to="pipeline.deal",
                )),
                ("changed_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True,
                    to="accounts.user",
                )),
                ("workspace",  models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="pipeline_dealprogress_set",
                    to="accounts.workspace",
                )),
            ],
            options={"db_table": "pipeline_dealprogress", "ordering": ["-changed_at"]},
        ),
    ]
