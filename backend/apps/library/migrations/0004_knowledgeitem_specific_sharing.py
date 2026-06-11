from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("library", "0003_knowledgeitem_video_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="knowledgeitem",
            name="shared_client_ids",
            field=models.JSONField(default=list, blank=True),
        ),
        migrations.AddField(
            model_name="knowledgeitem",
            name="shared_user_ids",
            field=models.JSONField(default=list, blank=True),
        ),
    ]
