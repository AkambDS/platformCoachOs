"""
End-to-end smoke test — a single chained walk through the core client lifecycle,
meant to be run before pushing to prod as a fast sanity check that the main paths
still work together: CSV import -> create client -> edit client -> notes/goals ->
pipeline -> scheduling -> confirmation email.

This is deliberately a happy-path smoke test, not exhaustive coverage — per-feature
edge cases belong in each app's own tests.py (apps/clients/tests.py,
apps/activities/tests.py, apps/pipeline/tests.py).

Run just this file: pytest test_smoke_e2e.py -v
"""
import io
import pytest
from datetime import timedelta
from django.core import mail
from django.utils import timezone


@pytest.mark.django_db
def test_full_client_lifecycle_smoke(api_client, portal_api_client, workspace, monkeypatch):
    # ── 1. CSV import ────────────────────────────────────────────────────────
    csv_content = (
        "first_name,last_name,email,company\n"
        "Alice,Smith,alice.smoke@example.com,Acme Inc\n"
        "Bob,Jones,bob.smoke@example.com,Beta LLC\n"
    )
    f = io.BytesIO(csv_content.encode())
    f.name = "import.csv"
    res = api_client.post("/api/clients/import/", {"file": f}, format="multipart")
    assert res.status_code == 201
    assert res.data["created"] == 2

    # ── 2. Create a client directly ─────────────────────────────────────────
    res = api_client.post("/api/clients/", {
        "first_name": "Kareem",
        "last_name":  "Abu Zeid",
        "email":      "kareem.smoke@example.com",
        "company":    "Zeid Consulting",
    }, format="json")
    assert res.status_code == 201
    client_id = res.data["id"]

    # ── 3. Edit the client ───────────────────────────────────────────────────
    res = api_client.patch(f"/api/clients/{client_id}/", {
        "status": "Active",
        "portal_access": True,
    }, format="json")
    assert res.status_code == 200
    assert res.data["status"] == "Active"

    # ── 4. Add a note ────────────────────────────────────────────────────────
    res = api_client.post(f"/api/clients/{client_id}/notes/", {
        "text": "Kickoff call — strong alignment on goals.",
        "note_type": "session",
    }, format="json")
    assert res.status_code == 201

    # ── 5. Add a goal, confirm it's private by default, then share it ──────
    res = api_client.post(f"/api/clients/{client_id}/goals/", {
        "title": "Land VP promotion",
        "target_date": (timezone.now().date() + timedelta(days=180)).isoformat(),
    }, format="json")
    assert res.status_code == 201
    goal_id = res.data["id"]
    assert res.data["visible_to_client"] is False

    from apps.clients.models import Client
    client_record = Client.objects.get(pk=client_id)
    portal = portal_api_client(client_record, workspace)
    assert portal.get("/api/portal/goals/").data["goals"] == []

    res = api_client.patch(f"/api/clients/{client_id}/goals/{goal_id}/",
                           {"visible_to_client": True}, format="json")
    assert res.status_code == 200
    assert len(portal.get("/api/portal/goals/").data["goals"]) == 1

    # Sharing a goal (False -> True) fires a notification email to the client.
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["kareem.smoke@example.com"]
    mail.outbox.clear()

    # ── 6. Pipeline: create a deal for this client, advance its stage ──────
    res = api_client.post("/api/pipeline/deals/", {
        "client": client_id,
        "deal_value": "5000.00",
        "deal_type": "1_1_coaching",
    }, format="json")
    assert res.status_code == 201
    deal_id = res.data["id"]
    assert res.data["stage"] == "lead_new"

    res = api_client.post(f"/api/pipeline/deals/{deal_id}/advance/",
                          {"stage": "discovery_scheduled"}, format="json")
    assert res.status_code == 200
    assert res.data["stage"] == "discovery_scheduled"

    from apps.pipeline.models import StageHistory
    # 2 entries expected: one logged at deal creation ("" -> lead_new), one from advance()
    # ("lead_new" -> "discovery_scheduled") — see DealSerializer.create / DealViewSet.advance.
    history = StageHistory.objects.filter(deal_id=deal_id).order_by("changed_at")
    assert history.count() == 2
    assert history.last().from_stage == "lead_new"
    assert history.last().to_stage == "discovery_scheduled"

    # ── 7. Calendar: schedule a session, confirm sync fires + confirmation email sends ──
    calendar_calls = []
    monkeypatch.setattr(
        "tasks.calendar.sync_to_google_calendar.delay",
        lambda *a, **kw: calendar_calls.append(a),
    )
    monkeypatch.setattr(
        "apps.activities.serializers._fire",
        lambda fn, *args: fn(*args),
    )

    start = timezone.now() + timedelta(days=3)
    res = api_client.post("/api/activities/", {
        "client":        client_id,
        "activity_type": "session",
        "title":         "Strategy Session",
        "start_at":      start.isoformat(),
        "end_at":        (start + timedelta(hours=1)).isoformat(),
    }, format="json")
    assert res.status_code == 201
    activity_id = res.data["id"]

    assert calendar_calls == [(activity_id, "create")]

    assert len(mail.outbox) == 2  # client confirmation + coach copy
    recipients = {addr for m in mail.outbox for addr in m.to}
    assert "kareem.smoke@example.com" in recipients

    # ── 8. Client can see the scheduled session in their portal ─────────────
    res = portal.get("/api/portal/activities/")
    assert res.status_code == 200
    titles = [a["title"] for a in res.data] if isinstance(res.data, list) else \
             [a["title"] for a in res.data.get("results", [])]
    assert "Strategy Session" in titles
