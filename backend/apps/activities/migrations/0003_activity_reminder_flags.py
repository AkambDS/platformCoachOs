from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("activities", "0002_activity_deal_alter_activity_activity_type_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="reminder_24h_sent",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="activity",
            name="reminder_1h_sent",
            field=models.BooleanField(default=False),
        ),
    ]
