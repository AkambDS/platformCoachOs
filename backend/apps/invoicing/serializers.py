from rest_framework import serializers
from .models import Invoice, InvoiceItem, Payment


class InvoiceItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model  = InvoiceItem
        fields = ["id", "description", "quantity", "unit_price", "discount", "line_total"]


class InvoiceListSerializer(serializers.ModelSerializer):
    client_name  = serializers.CharField(source="client.full_name", read_only=True)
    email_html   = serializers.SerializerMethodField()

    class Meta:
        model  = Invoice
        fields = ["id", "number", "status", "invoice_type", "total",
                  "amount_paid", "due_date", "client_name", "created_at", "email_html"]

    def get_email_html(self, obj):
        return _build_email_html(obj)


class InvoiceDetailSerializer(serializers.ModelSerializer):
    items       = InvoiceItemSerializer(many=True)
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    payments    = serializers.SerializerMethodField()
    email_html  = serializers.SerializerMethodField()

    class Meta:
        model  = Invoice
        fields = "__all__"
        read_only_fields = ["id", "workspace", "number", "total", "subtotal",
                            "amount_paid", "stripe_invoice_id", "pdf_s3_key",
                            "created_at", "updated_at"]

    def get_payments(self, obj):
        return PaymentSerializer(obj.payments.all(), many=True).data

    def get_email_html(self, obj):
        return _build_email_html(obj)

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        invoice = super().create(validated_data)
        for item in items_data:
            InvoiceItem.objects.create(invoice=invoice, **item)
        invoice.calculate_total()
        invoice.save()
        return invoice

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if items_data is not None:
            instance.items.all().delete()
            for item in items_data:
                InvoiceItem.objects.create(invoice=instance, **item)
        instance.calculate_total()
        instance.save()
        return instance


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Payment
        fields = ["id", "amount", "method", "stripe_payment_id", "notes", "paid_at", "recorded_by"]
        read_only_fields = ["id", "recorded_by"]


# ── Email HTML helper ────────────────────────────────────────────────────────────

def _build_email_html(invoice: Invoice) -> str:
    """Build the invoice email HTML preview for API responses."""
    try:
        from django.conf import settings
        from tasks.email_html import build_invoice_email
        from apps.accounts.models import User

        workspace    = invoice.workspace
        owner        = workspace.users.filter(role=User.Role.BUSINESS_OWNER).first()
        owner_email  = owner.email if owner else ""
        owner_name   = owner.full_name if owner else ""

        backend_base = getattr(settings, "BACKEND_URL", "").rstrip("/")
        if not backend_base:
            allowed = getattr(settings, "ALLOWED_HOSTS", [])
            host = next((h for h in allowed if "onrender.com" in h and not h.startswith(".")), None)
            backend_base = f"https://{host}" if host else "http://localhost:8000"
        logo_url = f"{backend_base}/api/settings/logo/{workspace.id}/" if workspace.logo_data else ""

        due_str = invoice.due_date.strftime("%B %d, %Y") if invoice.due_date else ""
        return build_invoice_email(
            invoice=invoice,
            workspace_name=workspace.name,
            logo_url=logo_url,
            due_str=due_str,
            owner_email=owner_email,
            owner_name=owner_name,
        )
    except Exception:
        return ""
