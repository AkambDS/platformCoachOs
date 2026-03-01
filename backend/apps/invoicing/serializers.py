from rest_framework import serializers
from .models import Invoice, InvoiceItem, Payment


class InvoiceItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model  = InvoiceItem
        fields = ["id", "description", "quantity", "unit_price", "discount", "line_total"]


class InvoiceListSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.full_name", read_only=True)

    class Meta:
        model  = Invoice
        fields = ["id", "number", "status", "invoice_type", "total",
                  "amount_paid", "due_date", "client_name", "created_at"]


class InvoiceDetailSerializer(serializers.ModelSerializer):
    items       = InvoiceItemSerializer(many=True)
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    payments    = serializers.SerializerMethodField()

    class Meta:
        model  = Invoice
        fields = "__all__"
        read_only_fields = ["id", "workspace", "number", "total", "subtotal",
                            "amount_paid", "stripe_invoice_id", "pdf_s3_key",
                            "created_at", "updated_at"]

    def get_payments(self, obj):
        from .models import Payment
        return PaymentSerializer(obj.payments.all(), many=True).data

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        request    = self.context["request"]
        # Auto-generate invoice number
        import uuid
        workspace = request.user.workspace
        count     = Invoice.objects.filter(workspace=workspace).count() + 1
        validated_data["number"]    = f"INV-{count:04d}"
        validated_data["workspace"] = workspace
        validated_data.setdefault("coach", request.user)
        invoice = super().create(validated_data)
        for item in items_data:
            InvoiceItem.objects.create(invoice=invoice, **item)
        invoice.calculate_total()
        invoice.save()
        return invoice


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Payment
        fields = ["id", "amount", "method", "stripe_payment_id", "notes", "paid_at", "recorded_by"]
        read_only_fields = ["id", "recorded_by"]
