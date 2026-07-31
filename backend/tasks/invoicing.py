"""CoachOS — recurring subscription invoice generation + send."""
import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="tasks.invoicing.dispatch_subscription_invoices")
def dispatch_subscription_invoices():
    """Daily: for every subscription invoice whose next_invoice_date has arrived, clone
    it into a new invoice for the upcoming period and email it — the automated
    equivalent of a coach manually creating + sending each period's invoice."""
    from apps.invoicing.models import Invoice

    today = timezone.now().date()
    due = Invoice.objects.filter(
        invoice_type=Invoice.InvoiceType.SUBSCRIPTION,
        subscription_auto_send=True,
        next_invoice_date__isnull=False,
        next_invoice_date__lte=today,
    ).exclude(status=Invoice.Status.VOID)

    for invoice in due:
        try:
            _generate_and_send_next(invoice)
        except Exception as e:
            logger.error(f"dispatch_subscription_invoices failed for invoice {invoice.id}: {e}")


def _generate_and_send_next(invoice):
    from apps.invoicing.models import Invoice, InvoiceItem
    from .email import send_invoice_email

    workspace = invoice.workspace
    # Mirrors InvoiceViewSet.perform_create's numbering scheme.
    existing = Invoice.objects.filter(
        workspace=workspace, number__startswith="INV-"
    ).values_list("number", flat=True)
    max_n = 0
    for num in existing:
        try:
            max_n = max(max_n, int(num[4:]))
        except (ValueError, IndexError):
            pass

    new_invoice = Invoice.objects.create(
        workspace=workspace, client=invoice.client, coach=invoice.coach,
        invoice_type=Invoice.InvoiceType.SUBSCRIPTION, number=f"INV-{max_n + 1:04d}",
        currency=invoice.currency,
        discount_type=invoice.discount_type, discount_value=invoice.discount_value,
        tax_percent=invoice.tax_percent, notes=invoice.notes,
        due_date=invoice.next_invoice_date, issue_date=timezone.now().date(),
        billing_cycle=invoice.billing_cycle, billing_day=invoice.billing_day,
        subscription_start=invoice.subscription_start, subscription_end=invoice.subscription_end,
        subscription_auto_send=invoice.subscription_auto_send,
        email_template_id=invoice.email_template_id,
        status=Invoice.Status.DRAFT,
    )
    for item in invoice.items.all():
        InvoiceItem.objects.create(
            invoice=new_invoice, description=item.description,
            quantity=item.quantity, unit_price=item.unit_price, discount=item.discount,
        )
    new_invoice.calculate_total()
    new_invoice.save()

    # This invoice already fired — clear its schedule so it's never picked up again;
    # the new invoice becomes the series anchor going forward.
    invoice.next_invoice_date = None
    invoice.save(update_fields=["next_invoice_date"])

    send_invoice_email(str(new_invoice.id))
    new_invoice.status = Invoice.Status.SENT
    new_invoice.sent_at = timezone.now()
    new_invoice.next_invoice_date = new_invoice.compute_next_invoice_date()
    new_invoice.save(update_fields=["status", "sent_at", "next_invoice_date"])
    logger.info(f"Generated + sent subscription invoice {new_invoice.number} (from {invoice.number})")
