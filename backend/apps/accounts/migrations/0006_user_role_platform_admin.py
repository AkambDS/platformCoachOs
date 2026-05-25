from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0005_workspaceregistrationtoken'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[
                    ('platform_admin', 'Platform Admin'),
                    ('business_owner', 'Business Owner'),
                    ('coach', 'Coach'),
                    ('assistant', 'Assistant'),
                ],
                default='coach',
                max_length=20,
            ),
        ),
    ]
