# One Payment per Stripe payment id per workspace (one-time-pay.md, bug P1).
# Fails if duplicates already exist — run the pre-deploy check in one-time-pay.md first.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0013_invoice_due_upon_receipt'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.UniqueConstraint(
                condition=models.Q(('stripe_payment_id', ''), _negated=True),
                fields=('workspace', 'stripe_payment_id'),
                name='unique_stripe_payment_per_workspace',
            ),
        ),
    ]
