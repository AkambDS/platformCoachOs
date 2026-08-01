from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0019_workspaceinvitation_email_template_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="address",
            field=models.CharField(max_length=300, blank=True),
        ),
        migrations.AddField(
            model_name="user",
            name="city",
            field=models.CharField(max_length=100, blank=True),
        ),
        migrations.AddField(
            model_name="user",
            name="state",
            field=models.CharField(max_length=100, blank=True),
        ),
        migrations.AddField(
            model_name="user",
            name="zip_code",
            field=models.CharField(max_length=20, blank=True),
        ),
    ]
