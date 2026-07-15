from rest_framework import serializers
from .models import Invoice, InvoiceItem, Payment


class InvoiceItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model  = InvoiceItem
        fields = ["id", "description", "quantity", "unit_price", "discount", "line_total"]


class InvoiceListSerializer(serializers.ModelSerializer):
    client_name    = serializers.CharField(source="client.full_name", read_only=True)
    client_company = serializers.CharField(source="client.company",   read_only=True)
    email_html     = serializers.SerializerMethodField()

    class Meta:
        model  = Invoice
        fields = ["id", "number", "status", "invoice_type", "total",
                  "amount_paid", "refund_amount", "due_date", "client_name",
                  "client_company", "created_at", "email_html"]

    def get_email_html(self, obj):
        return _build_email_html(obj)


class InvoiceDetailSerializer(serializers.ModelSerializer):
    items          = InvoiceItemSerializer(many=True)
    client_name    = serializers.CharField(source="client.full_name",  read_only=True)
    client_email   = serializers.CharField(source="client.email",      read_only=True)
    client_company = serializers.CharField(source="client.company",    read_only=True)
    client_phone   = serializers.CharField(source="client.phone",      read_only=True)
    payments       = serializers.SerializerMethodField()
    email_html     = serializers.SerializerMethodField()

    class Meta:
        model  = Invoice
        fields = "__all__"
        read_only_fields = ["id", "workspace", "number", "total", "subtotal",
                            "amount_paid", "stripe_invoice_id",
                            "stripe_subscription_id", "pdf_s3_key",
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
    """Build the invoice email HTML for the review-before-sending preview, matching what will be sent."""
    try:
        from django.conf import settings
        from tasks.email_html import build_invoice_email
        from tasks.email import _apply_tmpl, _logo_src
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

        due_str  = invoice.due_date.strftime("%B %d, %Y") if invoice.due_date else ""
        tmpl     = (workspace.email_templates or {}).get("invoice", {})

        _pay_link = invoice.stripe_payment_link or ""
        _pay_button = (
            f'<div style="margin:0 0 32px;">'
            f'<a href="{_pay_link}" style="display:inline-block;background:#1a2f4e;color:#fff;'
            f'text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;">'
            f'Pay Invoice</a></div>'
        ) if _pay_link else ""
        _view_instructions = (
            "You can view and pay the invoice by clicking the button below."
            if _pay_link else
            "You can view the invoice by clicking on the attached file."
        )
        tmpl_style = tmpl.get("style", {})
        custom_html = tmpl.get("custom_html", "").strip()
        # disable_style only applies when custom HTML is set
        disable_style = custom_html and tmpl.get("disable_style", False)
        _bf = tmpl_style.get("body_font", "")
        _hf = tmpl_style.get("heading_font", "")
        _show_logo = tmpl.get("show_logo", True) and not disable_style
        _logo_img = (
            f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
            f'<img src="{workspace.logo_data}" alt="{workspace.name}" '
            f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
            f'</td></tr></table>'
        ) if (workspace.logo_data and _show_logo) else ""
        tmpl_vars = dict(
            client_name=invoice.client.full_name,
            workspace_name=workspace.name,
            invoice_number=invoice.number,
            amount=str(invoice.total),
            due_date=due_str,
            owner_email=owner_email,
            owner_name=owner_name or owner_email,
            payment_link=_pay_link,
            pay_button=_pay_button,
            view_instructions=_view_instructions,
            logo_img=_logo_img,
            header_bg="#1a2f4e" if disable_style else tmpl_style.get("header_bg", "#1a2f4e"),
            accent_color="#b8922e" if disable_style else tmpl_style.get("accent_color", "#b8922e"),
            value_color="#1a1714" if disable_style else tmpl_style.get("value_color", "#1a1714"),
            body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if disable_style else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
            heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
        )

        custom_intro   = _apply_tmpl(tmpl.get("intro",   ""), **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
        tmpl_vars.update(dict(
            intro=custom_intro,
            closing=custom_closing,
            intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
            closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
        ))

        from tasks.email import _DEFAULT_INVOICE_HTML
        effective_tmpl = custom_html or _DEFAULT_INVOICE_HTML
        return _apply_tmpl(effective_tmpl, **tmpl_vars)
    except Exception:
        return ""
