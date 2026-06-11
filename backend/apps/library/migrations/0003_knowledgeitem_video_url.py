from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("library", "0002_alter_knowledgefolder_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="knowledgeitem",
            name="video_url",
            field=models.URLField(blank=True),
        ),
    ]
