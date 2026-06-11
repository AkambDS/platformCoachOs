from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0014_workspace_address_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="integrations",
            field=models.JSONField(default=dict, blank=True),
        ),
    ]
