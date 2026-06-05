from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_workspace_name_unique"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="address",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="workspace",
            name="city",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="workspace",
            name="state",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="workspace",
            name="zip_code",
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
