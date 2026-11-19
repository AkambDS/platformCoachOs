# The pay link's current Stripe Checkout session (one-time-pay.md, bug P3).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0014_payment_unique_stripe_payment_per_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='stripe_checkout_session_id',
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
