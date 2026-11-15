"""
Session end time before start time must be a clear 400, not a 500.
(Prod ErrorLog: DataError "range lower bound must be less than or equal to range upper
bound" from the activity_no_overlapping_coach_bookings tstzrange constraint.)

Run: pytest test_activity_validation.py -v
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


@pytest.mark.django_db
def test_end_before_start_is_rejected_on_create_and_update():
    from apps.activities.models import Activity
    ws, owner, coach, _, client, _ = _make_workspace("t")
    s = timezone.now() + timedelta(days=5)
    api = _api(owner)
    base = {"title": "x", "activity_type": "call", "client": str(client.id), "send_confirmation": False}

    res = api.post("/api/activities/", {**base, "start_at": s.isoformat(),
                                        "end_at": (s - timedelta(hours=1)).isoformat()}, format="json")
    assert res.status_code == 400, res.content
    assert "end_at" in res.json()
    assert not Activity.objects.filter(workspace=ws).exists()

    res = api.post("/api/activities/", {**base, "start_at": s.isoformat(),
                                        "end_at": (s + timedelta(hours=1)).isoformat()}, format="json")
    assert res.status_code == 201, res.content
    aid = res.json()["id"]

    # PATCH only end_at — checked against the saved start_at
    res = api.patch(f"/api/activities/{aid}/", {"end_at": (s - timedelta(minutes=30)).isoformat(),
                                                "send_update": False}, format="json")
    assert res.status_code == 400, res.content
    assert Activity.objects.get(pk=aid).end_at == s + timedelta(hours=1)


@pytest.mark.django_db
def test_mark_as_status_rules():
    """The Calendar/Activities "Mark as" menu PATCHes status: allowed moves work and send
    nothing; Completed/Missed need the session to have started; cancelled stays cancelled."""
    from apps.activities.models import Activity
    ws, owner, coach, _, client, _ = _make_workspace("m")
    now = timezone.now()
    mk = lambda start, **kw: Activity.objects.create(workspace=ws, coach=coach, client=client, title="s",
                                                      activity_type="call", start_at=start,
                                                      end_at=start + timedelta(hours=1), **kw)
    past, future = mk(now - timedelta(hours=2)), mk(now + timedelta(days=2))
    api = _api(coach)
    patch = lambda a, s: api.patch(f"/api/activities/{a.id}/", {"status": s, "send_update": False}, format="json")

    for s in ("completed", "missed", "late", "scheduled"):          # past session: every move, incl. undo
        assert patch(past, s).status_code == 200, s
        past.refresh_from_db(); assert past.status == s

    for s in ("completed", "missed"):                              # future: not yet
        res = patch(future, s)
        assert res.status_code == 400 and "status" in res.json(), s
    for s in ("late", "rescheduled", "scheduled"):                 # future: fine
        assert patch(future, s).status_code == 200, s

    cancelled = mk(now - timedelta(hours=3), status="cancelled")
    res = patch(cancelled, "scheduled")
    assert res.status_code == 400 and "status" in res.json()
    cancelled.refresh_from_db(); assert cancelled.status == "cancelled"
