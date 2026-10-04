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

    sent = dispatch_pipeline_alerts(respect_send_hour=False)

    assert sent == 1
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [business_owner.email]

    deal.refresh_from_db()
    assert deal.pipeline_alert_sent_at is not None


def test_pipeline_schedule_rules():
    """Once a week = on the chosen weekday; once a month = on a date (clamped to the
    month's end) or on the Nth / last chosen weekday."""
    from datetime import date
    from tasks.pipeline import _scheduled_today as on
    mon, tue = date(2026, 10, 5), date(2026, 10, 6)            # Mon 5 Oct, Tue 6 Oct 2026
    assert on("daily", {}, tue)
    assert on("weekly", {"weekday": 0}, mon) and not on("weekly", {"weekday": 0}, tue)
    assert on("weekly", {}, mon)                                 # defaults to Monday
    assert on("monthly", {"month_mode": "day", "month_day": 15}, date(2026, 10, 15))
    assert not on("monthly", {"month_mode": "day", "month_day": 15}, date(2026, 10, 16))
    assert on("monthly", {"month_mode": "day", "month_day": 31}, date(2026, 2, 28))   # clamped
    first_mon = {"month_mode": "nth", "month_week": 1, "month_weekday": 0}
    assert on("monthly", first_mon, mon)                        # 5 Oct is the 1st Monday
    assert not on("monthly", first_mon, date(2026, 10, 12))     # 2nd Monday
    last_fri = {"month_mode": "nth", "month_week": -1, "month_weekday": 4}
    assert on("monthly", last_fri, date(2026, 10, 30)) and not on("monthly", last_fri, date(2026, 10, 23))


@pytest.mark.django_db
def test_pipeline_alerts_per_recipient_and_schedule(client_record, workspace, business_owner, coach):
    """Owner, assigned coach and client each get their own email on their own schedule
    — and the client gets the friendly check-in, never the internal alert."""
    from zoneinfo import ZoneInfo
    from django.core import mail
    from apps.pipeline.models import Deal, PipelineStageConfig
    from tasks.pipeline import dispatch_pipeline_alerts

    today = timezone.now().astimezone(ZoneInfo(workspace.workspace_timezone or "UTC")).date()
    other_weekday = (today.weekday() + 3) % 7
    stage = PipelineStageConfig.objects.create(
        workspace=workspace, slug="lead_new", label="New Lead", order=1, follow_up_days=1,
        notify_owner=True, owner_frequency="daily",
        notify_coach=True, coach_frequency="weekly",
        notify_client=True, client_frequency="monthly",
        alert_schedule={"coach": {"weekday": today.weekday()},
                        "client": {"month_mode": "day", "month_day": today.day}},
    )
    deal = Deal.objects.create(workspace=workspace, client=client_record, coach=coach)
    Deal.objects.filter(pk=deal.pk).update(stage_changed_at=timezone.now() - timedelta(days=5))

    assert dispatch_pipeline_alerts(respect_send_hour=False) == 3
    by_recipient = {m.to[0]: m for m in mail.outbox}
    assert set(by_recipient) == {business_owner.email, coach.email, client_record.email}
    assert "Follow-up needed" not in by_recipient[client_record.email].subject
    assert "Checking in" in by_recipient[client_record.email].subject

    # Same day again: nobody gets a second email.
    mail.outbox.clear()
    assert dispatch_pipeline_alerts(respect_send_hour=False) == 0

    # Not the coach's weekday / the client's date: only the daily owner alert goes out.
    stage.alert_schedule = {"coach": {"weekday": other_weekday},
                            "client": {"month_mode": "day", "month_day": (today.day % 28) + 1}}
    stage.save()
    Deal.objects.filter(pk=deal.pk).update(pipeline_alert_sent_at=None, coach_alert_sent_at=None,
                                           client_alert_sent_at=None)
    assert dispatch_pipeline_alerts(respect_send_hour=False) == 1
    assert mail.outbox[0].to == [business_owner.email]


@pytest.mark.django_db
def test_pipeline_owner_not_emailed_when_notify_me_off(client_record, workspace):
    from django.core import mail
    from apps.pipeline.models import Deal, PipelineStageConfig
    from tasks.pipeline import dispatch_pipeline_alerts

    PipelineStageConfig.objects.create(
        workspace=workspace, slug="lead_new", label="New Lead", order=1, follow_up_days=1,
        notify_owner=False,
    )
    deal = Deal.objects.create(workspace=workspace, client=client_record, coach=client_record.coach)
    Deal.objects.filter(pk=deal.pk).update(stage_changed_at=timezone.now() - timedelta(days=5))
    assert dispatch_pipeline_alerts(respect_send_hour=False) == 0
    assert mail.outbox == []


@pytest.mark.django_db
def test_pipeline_alerts_only_at_8am_workspace_time(client_record, workspace, business_owner):
    """The hourly beat run only emails a workspace at 8 AM in its own timezone —
    America/New_York: 12:00 UTC in October (EDT), 13:00 UTC in December (EST)."""
    from datetime import datetime, timezone as dt_tz
    from unittest.mock import patch
    from django.core import mail
    from apps.pipeline.models import Deal, PipelineStageConfig
    from tasks.pipeline import dispatch_pipeline_alerts

    workspace.workspace_timezone = "America/New_York"
    workspace.save(update_fields=["workspace_timezone"])
    PipelineStageConfig.objects.create(workspace=workspace, slug="lead_new", label="New Lead",
                                       order=1, follow_up_days=1)
    deal = Deal.objects.create(workspace=workspace, client=client_record, coach=client_record.coach)

    for at_utc, expected in [
        (datetime(2026, 10, 7, 11, 0, tzinfo=dt_tz.utc), 0),   # 7 AM EDT
        (datetime(2026, 10, 7, 12, 0, tzinfo=dt_tz.utc), 1),   # 8 AM EDT
        (datetime(2026, 12, 9, 12, 0, tzinfo=dt_tz.utc), 0),   # 7 AM EST
        (datetime(2026, 12, 9, 13, 0, tzinfo=dt_tz.utc), 1),   # 8 AM EST
    ]:
        Deal.objects.filter(pk=deal.pk).update(stage_changed_at=at_utc - timedelta(days=5),
                                               pipeline_alert_sent_at=None)
        mail.outbox.clear()
        with patch("tasks.pipeline.timezone.now", return_value=at_utc):
            assert dispatch_pipeline_alerts() == expected, at_utc
