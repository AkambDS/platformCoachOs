from django.contrib import admin
from .models import Invoice, InvoiceItem, Payment

class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0

@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display   = ["number", "client", "status", "total", "amount_paid", "due_date", "created_at"]
    list_filter    = ["status", "invoice_type", "workspace"]
    search_fields  = ["number", "client__first_name", "client__last_name"]
    readonly_fields = ["id", "stripe_invoice_id", "pdf_s3_key", "created_at"]
    inlines        = [InvoiceItemInline]

@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["invoice", "amount", "method", "paid_at"]
    list_filter  = ["method"]
