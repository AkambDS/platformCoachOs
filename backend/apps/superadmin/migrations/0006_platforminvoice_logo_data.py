from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("superadmin", "0005_platformpayment_recurring"),
    ]

    operations = [
        migrations.AddField(
            model_name="platforminvoice",
            name="logo_data",
            field=models.TextField(blank=True, default=''),
        ),
    ]
