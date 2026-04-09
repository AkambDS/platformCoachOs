from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_alter_auditlog_id_alter_user_groups_alter_user_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspaceinvitation",
            name="email_sent",
            field=models.BooleanField(default=False),
        ),
    ]
