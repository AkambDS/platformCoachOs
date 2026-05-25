from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0004_invoice_issue_date_subscription_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='refund_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='invoice',
            name='refund_reason',
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name='invoice',
            name='refunded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='invoice',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', 'Draft'), ('sent', 'Sent'),
                    ('partially_paid', 'Partially Paid'), ('paid', 'Paid'),
                    ('overdue', 'Overdue'), ('void', 'Void'),
                    ('refunded', 'Refunded'), ('partially_refunded', 'Partially Refunded'),
                ],
                default='draft', max_length=20,
            ),
        ),
    ]
