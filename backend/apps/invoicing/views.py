"""CoachOS — invoicing/views.py"""
import logging
from decimal import Decimal
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Invoice, Payment, ServiceCatalogItem
from .serializers import InvoiceListSerializer, InvoiceDetailSerializer, PaymentSerializer
from apps.accounts.permissions import IsCoachOrAbove

logger = logging.getLogger(__name__)


class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsCoachOrAbove]

    def perform_create(self, serializer):
        workspace = self.request.user.workspace
        # Derive next number from the highest existing number, not count,
        # so deleted invoices don't cause duplicate-key collisions.
        existing = Invoice.objects.filter(
            workspace=workspace, number__startswith="INV-"
        ).values_list("number", flat=True)
        max_n = 0
        for num in existing:
            try:
                max_n = max(max_n, int(num[4:]))
            except (ValueError, IndexError):
                pass
        serializer.save(
            workspace=workspace,
            coach=self.request.user,
            number=f"INV-{max_n + 1:04d}",
        )

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except Exception as exc:
            logger.exception("Invoice create failed: %s", exc)
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    def get_queryset(self):
        user = self.request.user
        qs = Invoice.objects.filter(workspace=user.workspace) \
                            .select_related("client", "coach") \
                            .prefetch_related("items", "payments")
        if user.role != "business_owner":
            qs = qs.filter(client__coach=user)
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        client_filter = self.request.query_params.get("client")
        if client_filter:
            qs = qs.filter(client__id=client_filter)
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
        was_paid = invoice.status == Invoice.Status.PAID
        invoice.status = (Invoice.Status.PAID
                          if invoice.amount_paid >= invoice.total
                          else Invoice.Status.PARTIALLY_PAID)
        if invoice.status == Invoice.Status.PAID:
            invoice.paid_at = timezone.now()
        invoice.save()
        # Send receipt email when invoice is fully settled
        if not was_paid and invoice.status == Invoice.Status.PAID:
            try:
                from tasks.email import send_payment_receipt_email
                send_payment_receipt_email(str(invoice.id))
            except Exception:
                pass
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="void")
    def void_invoice(self, request, pk=None):
        invoice = self.get_object()
        invoice.status = Invoice.Status.VOID
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="refund")
    def issue_refund(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.PAID, Invoice.Status.PARTIALLY_PAID,
                                   Invoice.Status.PARTIALLY_REFUNDED):
            return Response({"detail": "Can only refund paid invoices."}, status=400)
        amount = Decimal(str(request.data.get("amount", 0)))
        reason = request.data.get("reason", "")
        if amount <= 0:
            return Response({"detail": "Refund amount must be positive."}, status=400)
        invoice.refund_amount += amount
        invoice.refund_reason  = reason
        invoice.refunded_at    = timezone.now()
        invoice.status = (Invoice.Status.REFUNDED
                          if invoice.refund_amount >= invoice.amount_paid
                          else Invoice.Status.PARTIALLY_REFUNDED)
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="remind")
    def send_reminder(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.SENT, Invoice.Status.OVERDUE,
                                   Invoice.Status.PARTIALLY_PAID):
            return Response({"detail": "Reminder only for sent/overdue invoices."}, status=400)
        from tasks.email import send_invoice_email
        send_invoice_email(str(invoice.id))
        return Response({"detail": "Reminder sent."})


# ── Stripe webhook handlers — disabled (Stripe removed from INSTALLED_APPS)
# Re-enable when porting to AWS with full Stripe integration
# on_payment_succeeded, on_payment_failed, on_charge_refunded


# ── Service Catalog ───────────────────────────────────────────────────────────

from rest_framework.decorators import api_view, permission_classes as pc
from rest_framework.request import Request

def _serialize_catalog(item):
    return {
        "id":          str(item.id),
        "name":        item.name,
        "description": item.description,
        "unit_price":  str(item.unit_price),
        "sort_order":  item.sort_order,
    }

@api_view(["GET", "POST"])
@pc([IsCoachOrAbove])
def service_catalog(request: Request):
    ws = request.user.workspace
    if request.method == "GET":
        items = ServiceCatalogItem.objects.filter(workspace=ws)
        return Response([_serialize_catalog(i) for i in items])

    data  = request.data
    name  = (data.get("name") or "").strip()
    if not name:
        return Response({"detail": "name is required"}, status=400)
    item = ServiceCatalogItem.objects.create(
        workspace   = ws,
        name        = name,
        description = (data.get("description") or "").strip(),
        unit_price  = data.get("unit_price") or 0,
        sort_order  = data.get("sort_order") or 0,
    )
    return Response(_serialize_catalog(item), status=201)


@api_view(["PATCH", "DELETE"])
@pc([IsCoachOrAbove])
def service_catalog_detail(request: Request, pk):
    try:
        item = ServiceCatalogItem.objects.get(pk=pk, workspace=request.user.workspace)
    except ServiceCatalogItem.DoesNotExist:
        return Response(status=404)

    if request.method == "DELETE":
        item.delete()
        return Response(status=204)

    data = request.data
    if "name"        in data: item.name        = (data["name"] or "").strip()
    if "description" in data: item.description = (data["description"] or "").strip()
    if "unit_price"  in data: item.unit_price  = data["unit_price"]
    if "sort_order"  in data: item.sort_order  = data["sort_order"]
    item.save()
    return Response(_serialize_catalog(item))
