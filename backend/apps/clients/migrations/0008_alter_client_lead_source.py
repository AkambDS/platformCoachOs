from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0007_clienttagconfig'),
    ]

    operations = [
        migrations.AlterField(
            model_name='client',
            name='lead_source',
            field=models.CharField(max_length=200, blank=True),
        ),
    ]
