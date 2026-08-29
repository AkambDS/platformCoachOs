"""Tests — pipeline app (deals / stage advancement / stall alerts)"""
import pytest
from datetime import timedelta
from django.utils import timezone


@pytest.mark.django_db
def test_create_deal(api_client, client_record):
    res = api_client.post("/api/pipeline/deals/", {
        "client": str(client_record.id),
        "deal_value": "2500.00",
        "deal_type": "1_1_coaching",
    }, format="json")
    assert res.status_code == 201
    assert res.data["stage"] == "lead_new"


@pytest.mark.django_db
def test_advance_deal_stage_logs_history(api_client, client_record, workspace):
    from apps.pipeline.models import Deal, StageHistory

    deal = Deal.objects.create(workspace=workspace, client=client_record, coach=client_record.coach)
    assert deal.stage == "lead_new"

    res = api_client.post(f"/api/pipeline/deals/{deal.id}/advance/",
                          {"stage": "discovery_scheduled"}, format="json")
    assert res.status_code == 200
    assert res.data["stage"] == "discovery_scheduled"

    history = StageHistory.objects.filter(deal=deal)
    assert history.count() == 1
    assert history.first().from_stage == "lead_new"
    assert history.first().to_stage == "discovery_scheduled"


@pytest.mark.django_db
def test_pipeline_stall_alert_sent_to_workspace_owner(client_record, workspace, business_owner):
    """A deal that's sat past its stage's follow_up_days window should get one alert
    emailed to the workspace owner when the daily beat task runs."""
    from django.core import mail
    from apps.pipeline.models import Deal, PipelineStageConfig
    from tasks.pipeline import dispatch_pipeline_alerts

    PipelineStageConfig.objects.create(
        workspace=workspace, slug="lead_new", label="New Lead",
        order=1, follow_up_days=1, alert_stop_after_days=30,
    )
    deal = Deal.objects.create(workspace=workspace, client=client_record, coach=client_record.coach)
    Deal.objects.filter(pk=deal.pk).update(
        stage_changed_at=timezone.now() - timedelta(days=5)
    )

    sent = dispatch_pipeline_alerts()

    assert sent == 1
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [business_owner.email]

    deal.refresh_from_db()
    assert deal.pipeline_alert_sent_at is not None
