"""CoachOS — invoicing/views.py"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.dispatch import receiver
from djstripe.signals import WEBHOOK_SIGNALS

from .models import Invoice, Payment
from .serializers import InvoiceListSerializer, InvoiceDetailSerializer, PaymentSerializer
from apps.accounts.permissions import IsAssistantOrAbove


class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        qs = Invoice.objects.filter(workspace=self.request.user.workspace) \
                            .select_related("client", "coach") \
                            .prefetch_related("items", "payments")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def get_serializer_class(self):
        return InvoiceListSerializer if self.action == "list" else InvoiceDetailSerializer

    @action(detail=True, methods=["post"], url_path="send")
    def send_invoice(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT):
            return Response({"detail": "Can only send Draft or Sent invoices."}, status=400)
        from tasks.email import send_invoice_email
        send_invoice_email.delay(str(invoice.id))
        invoice.status  = Invoice.Status.SENT
        invoice.sent_at = timezone.now()
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        invoice = self.get_object()
        serializer = PaymentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        payment = serializer.save(
            invoice=invoice,
            workspace=invoice.workspace,
            recorded_by=request.user,
        )
        invoice.amount_paid += payment.amount
        invoice.status = (Invoice.Status.PAID
                          if invoice.amount_paid >= invoice.total
                          else Invoice.Status.PARTIALLY_PAID)
        if invoice.status == Invoice.Status.PAID:
            invoice.paid_at = timezone.now()
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="void")
    def void_invoice(self, request, pk=None):
        invoice = self.get_object()
        invoice.status = Invoice.Status.VOID
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)


# ── dj-stripe 2.9+ webhook handlers (Django signals, not djstripe_receiver) ──

@receiver(WEBHOOK_SIGNALS["invoice.payment_succeeded"])
def on_payment_succeeded(sender, event, **kwargs):
    stripe_invoice = event.data["object"]
    try:
        invoice = Invoice.objects.get(stripe_invoice_id=stripe_invoice["id"])
        invoice.status      = Invoice.Status.PAID
        invoice.amount_paid = invoice.total
        invoice.paid_at     = timezone.now()
        invoice.save()
    except Invoice.DoesNotExist:
        pass


@receiver(WEBHOOK_SIGNALS["invoice.payment_failed"])
def on_payment_failed(sender, event, **kwargs):
    stripe_invoice = event.data["object"]
    try:
        invoice = Invoice.objects.get(stripe_invoice_id=stripe_invoice["id"])
        if invoice.status not in (Invoice.Status.PAID,):
            invoice.status = Invoice.Status.OVERDUE
            invoice.save()
        from tasks.email import send_payment_failed_email
        send_payment_failed_email.delay(str(invoice.id))
    except Invoice.DoesNotExist:
        pass


@receiver(WEBHOOK_SIGNALS["charge.refunded"])
def on_charge_refunded(sender, event, **kwargs):
    charge            = event.data["object"]
    stripe_invoice_id = charge.get("invoice")
    if stripe_invoice_id:
        try:
            invoice        = Invoice.objects.get(stripe_invoice_id=stripe_invoice_id)
            invoice.status = Invoice.Status.REFUNDED
            invoice.save()
        except Invoice.DoesNotExist:
            pass
