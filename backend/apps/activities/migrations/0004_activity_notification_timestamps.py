from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("activities", "0003_activity_reminder_flags"),
    ]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="confirmation_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="activity",
            name="cancellation_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="activity",
            name="reminder_24h_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="activity",
            name="reminder_1h_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
