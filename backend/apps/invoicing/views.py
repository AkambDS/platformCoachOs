"""CoachOS — invoicing/views.py"""
import logging
from decimal import Decimal
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Invoice, Payment, ServiceCatalogItem
from .serializers import InvoiceListSerializer, InvoiceDetailSerializer, PaymentSerializer
from apps.accounts.permissions import IsCoachOrAbove, IsAssistantOrAbove, require_tab

logger = logging.getLogger(__name__)


class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAssistantOrAbove]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAssistantOrAbove(), require_tab("invoices", "delete")()]
        if self.action in ("create", "update", "partial_update", "send_invoice",
                            "record_payment", "void_invoice", "issue_refund", "send_reminder",
                            "cancel_subscription", "archive", "unarchive"):
            return [IsAssistantOrAbove(), require_tab("invoices", "edit")()]
        return [IsAssistantOrAbove(), require_tab("invoices", "view")()]

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
        # Archived invoices are hidden from the default LIST view only — pass ?archived=1
        # to see only archived ones, or ?archived=all to see everything. Detail actions
        # (retrieve/void/archive/unarchive/etc.) must still be able to find an already-
        # archived invoice by id, so this filter never applies outside of "list".
        if self.action == "list":
            archived_param = self.request.query_params.get("archived")
            if archived_param in ("1", "true", "True"):
                qs = qs.filter(archived=True)
            elif archived_param != "all":
                qs = qs.filter(archived=False)
        return qs

    def get_serializer_class(self):
        return InvoiceListSerializer if self.action == "list" else InvoiceDetailSerializer

    def perform_destroy(self, instance):
        # Matches every mainstream invoicing tool: once sent, an invoice is permanent
        # record — Void it instead. Only an unsent draft can actually be deleted.
        if instance.status != Invoice.Status.DRAFT:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": "Only draft invoices can be deleted. Void a sent invoice instead."})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="send")
    def send_invoice(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT):
            return Response({"detail": "Can only send Draft or Sent invoices."}, status=400)
        from tasks.email import send_invoice_email
        try:
            send_invoice_email(str(invoice.id))
        except Exception as e:
            return Response({"detail": f"Failed to send invoice email: {e}"}, status=502)
        # send_invoice_email fetches and saves its own Invoice instance (e.g. to sync
        # stripe_payment_link) — refresh this one before writing, so an unscoped save()
        # below doesn't clobber that update with this stale in-memory copy.
        invoice.refresh_from_db()
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
        # Voiding a subscription invoice stops the series — otherwise the next period
        # would still auto-generate and email off a voided invoice.
        invoice.next_invoice_date = None
        invoice.save()
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="refund")
    def issue_refund(self, request, pk=None):
        """POST /api/invoices/{id}/refund/ — if the invoice was paid via Stripe, actually
        moves the money back to the client through Stripe's Refund API before recording
        it; if paid by cash/bank/cheque, it's bookkeeping-only (there's no gateway to call).
        The charge.refunded webhook (public_views.StripeWebhookView) reconciles refunds
        issued directly from the Stripe Dashboard the same way — see stripe_refund_ids."""
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.PAID, Invoice.Status.PARTIALLY_PAID,
                                   Invoice.Status.PARTIALLY_REFUNDED):
            return Response({"detail": "Can only refund paid invoices."}, status=400)
        amount = Decimal(str(request.data.get("amount", 0)))
        reason = request.data.get("reason", "")
        if amount <= 0:
            return Response({"detail": "Refund amount must be positive."}, status=400)
        remaining_refundable = invoice.amount_paid - invoice.refund_amount
        if amount > remaining_refundable:
            return Response(
                {"detail": f"Cannot refund more than the outstanding paid balance (${remaining_refundable})."},
                status=400,
            )

        stripe_payment = (Payment.objects.filter(invoice=invoice, method=Payment.Method.STRIPE)
                           .exclude(stripe_payment_id="").order_by("-paid_at").first())
        if stripe_payment:
            if amount > stripe_payment.amount:
                return Response(
                    {"detail": "This amount spans more than one Stripe charge — issue separate "
                                "refunds per payment, or refund it directly from your Stripe Dashboard."},
                    status=400,
                )
            cfg = (invoice.workspace.integrations or {}).get("stripe", {})
            secret_key_enc = cfg.get("secret_key_encrypted")
            if not secret_key_enc:
                return Response(
                    {"detail": "Stripe is no longer connected for this workspace — refund it directly "
                                "from your Stripe Dashboard."},
                    status=400,
                )
            import stripe
            from apps.accounts.crypto import decrypt_secret
            try:
                refund = stripe.Refund.create(
                    api_key=decrypt_secret(secret_key_enc),
                    payment_intent=stripe_payment.stripe_payment_id,
                    amount=int(amount * 100),
                    metadata={"invoice_id": str(invoice.id), "workspace_id": str(invoice.workspace_id)},
                )
            except stripe.error.StripeError as e:
                logger.error(f"Stripe refund failed for invoice {invoice.id}: {e}")
                return Response(
                    {"detail": f"Stripe refund failed: {getattr(e, 'user_message', None) or str(e)}"},
                    status=502,
                )
            ids = set(invoice.stripe_refund_ids or [])
            ids.add(refund.id)
            invoice.stripe_refund_ids = list(ids)

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
        try:
            send_invoice_email(str(invoice.id))
        except Exception as e:
            return Response({"detail": f"Failed to send reminder: {e}"}, status=502)
        return Response({"detail": "Reminder sent."})

    @action(detail=True, methods=["post"], url_path="cancel-subscription")
    def cancel_subscription(self, request, pk=None):
        """POST /api/invoices/{id}/cancel-subscription/ — stop future recurring billing
        (e.g. a client leaves mid-subscription). Only affects what happens going forward:
        does NOT void or change the status of this invoice — whatever's already been sent
        stays as-is, it just won't auto-generate a next one."""
        invoice = self.get_object()
        if invoice.invoice_type != Invoice.InvoiceType.SUBSCRIPTION:
            return Response({"detail": "Only subscription invoices can be cancelled."}, status=400)
        if not invoice.next_invoice_date and not invoice.subscription_auto_send:
            return Response({"detail": "Recurring billing is already stopped for this invoice."}, status=400)
        invoice.subscription_auto_send = False
        invoice.next_invoice_date = None
        invoice.save(update_fields=["subscription_auto_send", "next_invoice_date"])
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        """POST /api/invoices/{id}/archive/ — hide a closed-out invoice from the default
        list. Purely a view filter: doesn't touch status, amounts, or anything else, and
        is always reversible via unarchive. Only for invoices that are actually done
        (paid/void/refunded) — an open invoice still needing action shouldn't disappear."""
        invoice = self.get_object()
        if invoice.status not in (Invoice.Status.PAID, Invoice.Status.VOID,
                                   Invoice.Status.REFUNDED, Invoice.Status.PARTIALLY_REFUNDED):
            return Response({"detail": "Only paid, void, or refunded invoices can be archived."}, status=400)
        invoice.archived = True
        invoice.archived_at = timezone.now()
        invoice.save(update_fields=["archived", "archived_at"])
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        invoice = self.get_object()
        invoice.archived = False
        invoice.archived_at = None
        invoice.save(update_fields=["archived", "archived_at"])
        return Response(InvoiceDetailSerializer(invoice).data)


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
