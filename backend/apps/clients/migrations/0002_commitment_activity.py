import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0001_initial"),
        ("activities", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="commitment",
            name="activity",
            field=models.ForeignKey(
                null=True, blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="commitments",
                to="activities.activity",
            ),
        ),
    ]