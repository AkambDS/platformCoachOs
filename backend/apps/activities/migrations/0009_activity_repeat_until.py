from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('activities', '0008_activity_status_late_rescheduled'),
    ]

    operations = [
        migrations.AddField(
            model_name='activity',
            name='repeat_until',
            field=models.DateField(blank=True, help_text='End date for recurring series', null=True),
        ),
    ]
