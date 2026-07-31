"""CoachOS — pipeline follow-up alert automation."""
import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="tasks.pipeline.dispatch_pipeline_alerts")
def dispatch_pipeline_alerts():
    """Daily: re-send a follow-up alert for every active deal that's overdue in its
    current stage — once per day — until the deal moves stage or its alert window
    closes. The window is set per-stage (PipelineStageConfig.alert_stop_after_days,
    configured in Settings > Pipeline) and can be overridden per-deal
    (Deal.alert_stop_date) for a specific deal that needs different handling."""
    from apps.pipeline.models import Deal, PipelineStageConfig
    from .email import send_pipeline_alert

    now   = timezone.now()
    today = timezone.localdate()

    active_deals = Deal.objects.exclude(
        stage__in=["closed_lost", "active_client"]
    ).select_related("workspace", "client", "coach")

    sent = 0
    for deal in active_deals:
        if deal.pipeline_alert_sent_at and timezone.localtime(deal.pipeline_alert_sent_at).date() == today:
            continue  # already alerted today

        try:
            cfg = PipelineStageConfig.objects.get(workspace=deal.workspace, slug=deal.stage)
        except PipelineStageConfig.DoesNotExist:
            continue
        if not cfg.follow_up_days:
            continue

        days_in_stage = (now - deal.stage_changed_at).days
        if days_in_stage < cfg.follow_up_days:
            continue

        # Per-deal override takes precedence over the stage's default stop window.
        if deal.alert_stop_date:
            if today > deal.alert_stop_date:
                continue
        elif cfg.alert_stop_after_days is not None and days_in_stage > cfg.alert_stop_after_days:
            continue

        try:
            send_pipeline_alert(str(deal.id))
            Deal.objects.filter(pk=deal.pk).update(pipeline_alert_sent_at=now)
            sent += 1
        except Exception as e:
            logger.error(f"Pipeline alert failed for deal {deal.id}: {e}")

    logger.info(f"dispatch_pipeline_alerts: sent {sent} alert(s)")
    return sent
