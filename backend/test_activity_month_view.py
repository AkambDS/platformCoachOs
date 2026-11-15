"""
Activities list = one month at a time (start/end query params, as the page sends them —
JS toISOString() UTC instants), still role-scoped: owner sees the workspace, a coach only
sessions they run.

Run: pytest test_activity_month_view.py -v
"""
from datetime import datetime, timedelta, timezone as dt_tz

import pytest

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


@pytest.mark.django_db
def test_month_range_and_role_scope():
    from apps.activities.models import Activity
    ws, owner, coach1, coach2, c1, c2 = _make_workspace("mv")
    at = lambda y, m, d: datetime(y, m, d, 15, 0, tzinfo=dt_tz.utc)
    mk = lambda when, coach, client: Activity.objects.create(
        workspace=ws, coach=coach, client=client, title=f"{when:%b%d}", activity_type="call",
        start_at=when, end_at=when + timedelta(hours=1))
    mk(at(2026, 10, 31), coach1, c1)        # previous month
    mk(at(2026, 11, 1), coach1, c1)
    mk(at(2026, 11, 30), coach2, c2)
    mk(at(2026, 12, 1), coach1, c1)         # next month

    q = "/api/activities/?page_size=200&start=2026-11-01T04:00:00.000Z&end=2026-12-01T04:59:59.999Z"
    titles = lambda u: sorted(a["title"] for a in (lambda d: d.get("results", d))(_api(u).get(q).json()))
    assert titles(owner)  == ["Nov01", "Nov30"]      # whole workspace, November only
    assert titles(coach1) == ["Nov01"]               # only sessions coach1 runs
    assert titles(coach2) == ["Nov30"]
