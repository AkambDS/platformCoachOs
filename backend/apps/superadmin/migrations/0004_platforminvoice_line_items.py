from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("superadmin", "0003_platforminvoice"),
    ]

    operations = [
        migrations.AddField(
            model_name="platforminvoice",
            name="line_items",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
