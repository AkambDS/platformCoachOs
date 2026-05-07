"""CoachOS — invoicing/views.py"""
import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Invoice, Payment
from .serializers import InvoiceListSerializer, InvoiceDetailSerializer, PaymentSerializer
from apps.accounts.permissions import IsCoachOrAbove

logger = logging.getLogger(__name__)


class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsCoachOrAbove]

    def perform_create(self, serializer):
        workspace = self.request.user.workspace
        count     = Invoice.objects.filter(workspace=workspace).count() + 1
        serializer.save(
            workspace=workspace,
            coach=self.request.user,
            number=f"INV-{count:04d}",
        )

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except Exception as exc:
            logger.exception("Invoice create failed: %s", exc)
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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
        send_invoice_email(str(invoice.id))
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


# ── Stripe webhook handlers — disabled (Stripe removed from INSTALLED_APPS)
# Re-enable when porting to AWS with full Stripe integration
# on_payment_succeeded, on_payment_failed, on_charge_refunded
