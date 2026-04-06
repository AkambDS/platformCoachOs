"""CoachOS — Celery email tasks"""
from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

FRONTEND_URL = getattr(settings, "FRONTEND_URL", "http://localhost:5173")


@shared_task(name="tasks.email.send_invite_email")
def send_invite_email(invitation_id: str):
    from apps.accounts.models import WorkspaceInvitation
    try:
        invite = WorkspaceInvitation.objects.select_related("workspace","invited_by").get(id=invitation_id)
        from django.conf import settings as django_settings
        frontend_url = getattr(django_settings, "FRONTEND_URL", "http://localhost:5173")
        accept_url = f"{frontend_url}/accept-invite?token={invite.token}"
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


@shared_task(name="tasks.email.send_activity_confirmation_email")
def send_activity_confirmation_email(activity_id: str):
    """Email the client confirming a newly scheduled activity."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        dt = activity.start_at.strftime("%A, %B %-d at %-I:%M %p")
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        send_mail(
            subject=f"Confirmed: {activity.title} with {coach_name}",
            message=(
                f"Hi {client.first_name},\n\n"
                f"Your {activity.activity_type} has been scheduled.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}{location_line}\n"
                f"  Coach:  {coach_name}\n\n"
                f"You will receive a reminder 24 hours before your session.\n\n"
                f"If you need to reschedule, please contact {coach_name} directly.\n\n"
                f"— {activity.workspace.name}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[client.email],
        )
        logger.info(f"Confirmation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_confirmation_email failed: {e}")


@shared_task(name="tasks.email.send_activity_reminder_email")
def send_activity_reminder_email(activity_id: str, hours_before: int = 24):
    """Email the client a reminder before their session."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return
        if activity.status != "scheduled":
            return  # don't remind for cancelled/missed activities

        dt = activity.start_at.strftime("%A, %B %-d at %-I:%M %p")
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        location_line = f"\nLocation: {activity.location}" if activity.location else ""
        time_label = "24 hours" if hours_before == 24 else f"{hours_before} hour{'s' if hours_before != 1 else ''}"

        send_mail(
            subject=f"Reminder: {activity.title} in {time_label}",
            message=(
                f"Hi {client.first_name},\n\n"
                f"This is a reminder that you have a {activity.activity_type} in {time_label}.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}{location_line}\n"
                f"  Coach:  {coach_name}\n\n"
                f"If you need to reschedule, please contact {coach_name} as soon as possible.\n\n"
                f"— {activity.workspace.name}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[client.email],
        )
        logger.info(f"Reminder email ({hours_before}h) sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reminder_email failed: {e}")


@shared_task(name="tasks.email.send_activity_cancellation_email")
def send_activity_cancellation_email(activity_id: str):
    """Email the client when a scheduled activity is cancelled."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        dt = activity.start_at.strftime("%A, %B %-d at %-I:%M %p")
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name

        send_mail(
            subject=f"Cancelled: {activity.title} on {activity.start_at.strftime('%b %-d')}",
            message=(
                f"Hi {client.first_name},\n\n"
                f"Your upcoming {activity.activity_type} has been cancelled.\n\n"
                f"  What:   {activity.title}\n"
                f"  Was:    {dt}\n"
                f"  Coach:  {coach_name}\n\n"
                f"Please contact {coach_name} to reschedule.\n\n"
                f"— {activity.workspace.name}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[client.email],
        )
        logger.info(f"Cancellation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_cancellation_email failed: {e}")


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
