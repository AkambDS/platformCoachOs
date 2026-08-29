from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0021_client_communication_tags_client_referral_name_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='clientgoal',
            name='visible_to_client',
            field=models.BooleanField(default=False, help_text='Share this goal with the client in their portal'),
        ),
    ]
