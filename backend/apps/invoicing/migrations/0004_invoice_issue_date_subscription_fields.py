from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0003_invoice_number_unique_per_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='issue_date',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invoice',
            name='billing_cycle',
            field=models.CharField(
                blank=True,
                choices=[('monthly', 'Monthly'), ('quarterly', 'Quarterly'), ('yearly', 'Yearly')],
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='invoice',
            name='billing_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invoice',
            name='subscription_start',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invoice',
            name='subscription_auto_send',
            field=models.BooleanField(default=True),
        ),
    ]
