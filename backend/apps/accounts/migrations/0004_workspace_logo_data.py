from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_workspaceinvitation_email_sent"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="logo_data",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
    ]
