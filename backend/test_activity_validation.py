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
