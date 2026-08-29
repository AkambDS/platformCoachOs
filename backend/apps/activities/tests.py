"""Tests — activities app (scheduling / calendar / confirmation email)"""
import pytest
from datetime import timedelta
from django.utils import timezone


def _activity_payload(client_record):
    start = timezone.now() + timedelta(days=2)
    return {
        "client":        str(client_record.id),
        "activity_type": "session",
        "title":         "Coaching Session",
        "start_at":      start.isoformat(),
        "end_at":        (start + timedelta(hours=1)).isoformat(),
    }


@pytest.mark.django_db
def test_create_activity_schedules_and_triggers_calendar_sync(api_client, client_record, monkeypatch):
    """Scheduling a session should succeed and kick off the Google Calendar sync task
    — mocked here so the test doesn't depend on a Celery worker/Redis being up; this
    verifies the wiring is intact, not the real Google API call."""
    calls = []
    monkeypatch.setattr(
        "tasks.calendar.sync_to_google_calendar.delay",
        lambda *a, **kw: calls.append((a, kw)),
    )

    res = api_client.post("/api/activities/", _activity_payload(client_record), format="json")
    assert res.status_code == 201
    assert res.data["status"] == "scheduled"

    assert len(calls) == 1
    args, _ = calls[0]
    assert args == (res.data["id"], "create")


@pytest.mark.django_db
def test_create_activity_sends_confirmation_email(api_client, client_record, monkeypatch):
    """Scheduling a session with an emailed client should send a confirmation to the
    client and a copy to the coach. _fire normally runs this in a background thread
    (fire-and-forget) — patched to run inline so the test can assert on mail.outbox
    deterministically instead of racing a thread."""
    from django.core import mail

    monkeypatch.setattr(
        "apps.activities.serializers._fire",
        lambda fn, *args: fn(*args),
    )

    res = api_client.post("/api/activities/", _activity_payload(client_record), format="json")
    assert res.status_code == 201

    assert len(mail.outbox) == 2
    recipients = [addr for m in mail.outbox for addr in m.to]
    assert client_record.email in recipients
    assert client_record.coach.email in recipients


@pytest.mark.django_db
def test_activity_list_scoped_to_workspace(api_client, client_record):
    from apps.accounts.models import Workspace, User
    from apps.clients.models import Client
    from apps.activities.models import Activity

    other_ws = Workspace.objects.create(name="Other", slug="other-act")
    other_coach = User.objects.create_user(
        email="other-coach@x.com", password="x", full_name="Other Coach", workspace=other_ws)
    other_client = Client.objects.create(
        workspace=other_ws, coach=other_coach, first_name="Spy", last_name="Client", email="spy@x.com")
    start = timezone.now() + timedelta(days=1)
    Activity.objects.create(
        workspace=other_ws, coach=other_coach, client=other_client,
        activity_type="session", title="Should not appear",
        start_at=start, end_at=start + timedelta(hours=1),
    )

    res = api_client.get("/api/activities/")
    assert res.status_code == 200
    titles = [a["title"] for a in res.data["results"]]
    assert "Should not appear" not in titles
