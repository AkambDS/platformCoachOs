from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('superadmin', '0001_initial'),
    ]

    operations = [
        # Delete the singleton row (empty message, no longer useful)
        migrations.RunSQL(
            "DELETE FROM superadmin_maintenancebanner WHERE id = 1;",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.AddField(
            model_name='maintenancebanner',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, default=timezone.now),
            preserve_default=False,
        ),
    ]
