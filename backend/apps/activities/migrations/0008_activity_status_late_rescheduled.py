from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("activities", "0007_remove_activitytypeconfig_default_duration_mins"),
    ]

    operations = [
        migrations.AlterField(
            model_name="activity",
            name="status",
            field=models.CharField(
                choices=[
                    ("scheduled",   "Scheduled"),
                    ("completed",   "Completed"),
                    ("late",        "Late"),
                    ("rescheduled", "Rescheduled"),
                    ("missed",      "Missed Session"),
                    ("cancelled",   "Cancelled"),
                ],
                default="scheduled",
                max_length=20,
            ),
        ),
    ]
