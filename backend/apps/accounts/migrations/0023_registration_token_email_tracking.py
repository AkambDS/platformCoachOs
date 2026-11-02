from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0022_one_business_owner_per_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='email_status',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='email_error',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='email_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='email_send_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='resend_email_id',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='workspaceregistrationtoken',
            name='email_status_checked_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
