"""CoachOS — Celery email tasks"""
from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


@shared_task(name="tasks.email.send_invite_email")
def send_invite_email(invitation_id: str):
    from apps.accounts.models import WorkspaceInvitation
    try:
        invite = WorkspaceInvitation.objects.select_related("workspace","invited_by").get(id=invitation_id)
        accept_url = f"http://localhost:5173/accept-invite?token={invite.token}"
        send_mail(
            subject=f"You're invited to join {invite.workspace.name} on CoachOS",
            message=f"Hi,\n\n{invite.invited_by.full_name} has invited you to join "
                    f"{invite.workspace.name} as {invite.get_role_display()}.\n\n"
                    f"Accept here: {accept_url}\n\nThis link expires in 48 hours.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invite.email],
        )
        logger.info(f"Invite email sent to {invite.email}")
    except Exception as e:
        logger.error(f"send_invite_email failed: {e}")


@shared_task(name="tasks.email.send_invoice_email")
def send_invoice_email(invoice_id: str):
    """Generate PDF and email invoice to client."""
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        # TODO: WeasyPrint PDF generation + attach to email
        send_mail(
            subject=f"Invoice #{invoice.number} from {invoice.workspace.name}",
            message=f"Hi {invoice.client.first_name},\n\n"
                    f"Please find attached invoice #{invoice.number} for ${invoice.total}.\n\n"
                    f"Due: {invoice.due_date}\n\n"
                    f"{'Pay online: ' + invoice.stripe_payment_link if invoice.stripe_payment_link else ''}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invoice.client.email],
        )
        logger.info(f"Invoice email sent for {invoice.number}")
    except Exception as e:
        logger.error(f"send_invoice_email failed: {e}")


@shared_task(name="tasks.email.send_payment_failed_email")
def send_payment_failed_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach").get(id=invoice_id)
        # Notify coach
        send_mail(
            subject=f"Payment failed — Invoice #{invoice.number}",
            message=f"Payment failed for invoice #{invoice.number} (${invoice.total}) "
                    f"for {invoice.client.full_name}.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invoice.coach.email],
        )
    except Exception as e:
        logger.error(f"send_payment_failed_email failed: {e}")
