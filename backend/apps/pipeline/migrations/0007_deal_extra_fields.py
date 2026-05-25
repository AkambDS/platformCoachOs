from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0006_deal_tags_dealprogress"),
    ]

    operations = [
        migrations.AddField(
            model_name="deal",
            name="deal_type",
            field=models.CharField(
                max_length=30, blank=True,
                choices=[
                    ("1_1_coaching",      "1:1 Coaching"),
                    ("group_program",     "Group Program"),
                    ("corporate_training","Corporate Training"),
                    ("workshop",         "Workshop"),
                    ("retainer",         "Retainer"),
                    ("other",            "Other"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="deal",
            name="expected_close_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="deal",
            name="probability",
            field=models.PositiveSmallIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="deal",
            name="next_action",
            field=models.CharField(max_length=300, blank=True),
        ),
        migrations.AddField(
            model_name="deal",
            name="next_action_date",
            field=models.DateField(null=True, blank=True),
        ),
    ]
