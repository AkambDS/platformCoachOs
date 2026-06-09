from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("activities", "0010_activity_meeting_link"),
    ]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="client_confirmed",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="activity",
            name="client_confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
