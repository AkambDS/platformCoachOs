from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("clients", "0009_alter_clientstatusconfig_id_alter_clienttagconfig_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="clientnote",
            name="visible_to_client",
            field=models.BooleanField(default=False, help_text="Share this note with the client in their portal"),
        ),
    ]
