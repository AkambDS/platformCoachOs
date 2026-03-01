import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("accounts", "0001_initial"),
        ("clients", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Invoice",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("invoice_type", models.CharField(max_length=20, default="one_time")),
                ("status", models.CharField(max_length=20, default="draft")),
                ("number", models.CharField(max_length=50, unique=True)),
                ("currency", models.CharField(max_length=3, default="USD")),
                ("subtotal", models.DecimalField(max_digits=12, decimal_places=2, default=0)),
                ("discount_type", models.CharField(max_length=10, default="percent")),
                ("discount_value", models.DecimalField(max_digits=10, decimal_places=2, default=0)),
                ("tax_percent", models.DecimalField(max_digits=5, decimal_places=2, default=0)),
                ("total", models.DecimalField(max_digits=12, decimal_places=2, default=0)),
                ("amount_paid", models.DecimalField(max_digits=12, decimal_places=2, default=0)),
                ("notes", models.TextField(blank=True)),
                ("due_date", models.DateField(null=True, blank=True)),
                ("sent_at", models.DateTimeField(null=True, blank=True)),
                ("paid_at", models.DateTimeField(null=True, blank=True)),
                ("stripe_invoice_id", models.CharField(max_length=100, blank=True, db_index=True)),
                ("stripe_payment_link", models.URLField(blank=True)),
                ("stripe_subscription_id", models.CharField(max_length=100, blank=True)),
                ("pdf_s3_key", models.CharField(max_length=500, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_invoice_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("client", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="invoices", to="clients.client",
                )),
                ("coach", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "invoicing_invoice", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="InvoiceItem",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("description", models.CharField(max_length=300)),
                ("quantity", models.DecimalField(max_digits=8, decimal_places=2, default=1)),
                ("unit_price", models.DecimalField(max_digits=12, decimal_places=2)),
                ("discount", models.DecimalField(max_digits=5, decimal_places=2, default=0)),
                ("invoice", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="items", to="invoicing.invoice",
                )),
            ],
            options={"db_table": "invoicing_invoiceitem"},
        ),
        migrations.CreateModel(
            name="Payment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("amount", models.DecimalField(max_digits=12, decimal_places=2)),
                ("method", models.CharField(max_length=10)),
                ("stripe_payment_id", models.CharField(max_length=100, blank=True)),
                ("notes", models.TextField(blank=True)),
                ("paid_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="accounts_payment_set",
                    to="accounts.workspace", db_index=True,
                )),
                ("invoice", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="payments", to="invoicing.invoice",
                )),
                ("recorded_by", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to="accounts.user",
                )),
            ],
            options={"db_table": "invoicing_payment", "ordering": ["-paid_at"]},
        ),
    ]
