from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("superadmin", "0006_platforminvoice_logo_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="platforminvoice",
            name="show_platform_text",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="platforminvoice",
            name="billed_to_name",
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name="platforminvoice",
            name="billed_to_email",
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name="platforminvoice",
            name="billed_to_extra",
            field=models.TextField(blank=True, default=''),
        ),
    ]
