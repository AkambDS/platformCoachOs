"""
Clients list sorting: names case-insensitive (local Postgres sorted capitals first:
"Bhatlapanumarti, Tanzoe, bhatlap"), and the default "recent" order = clients this
user opened most recently first. Archived clients still sort last.

Run: pytest test_client_list_sort.py -v
"""
import pytest

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


def _names(res):
    assert res.status_code == 200, res.content
    rows = res.json().get("results", res.json())
    return [f"{r['first_name']} {r['last_name']}" for r in rows]


@pytest.mark.django_db
def test_name_sorts_ignore_case_and_recent_follows_views():
    from apps.clients.models import Client
    ws, owner, *_ = _make_workspace("s")
    Client.objects.filter(workspace=ws).delete()
    mk = lambda f, l, **kw: Client.objects.create(workspace=ws, coach=owner, first_name=f, last_name=l,
                                                  email=f"{f}@s.test", **kw)
    sanvi, laura, shreya = mk("Sanvi", "Bhatlapanumarti"), mk("laura", "Tanzoe"), mk("shreya", "bhatlap")
    mk("Aaron", "Aardvark", status="Archive")
    api = _api(owner)

    assert _names(api.get("/api/clients/?ordering=last_name")) == [
        "shreya bhatlap", "Sanvi Bhatlapanumarti", "laura Tanzoe", "Aaron Aardvark"]
    assert _names(api.get("/api/clients/?ordering=first_name")) == [
        "laura Tanzoe", "Sanvi Bhatlapanumarti", "shreya bhatlap", "Aaron Aardvark"]

    # Nothing viewed yet → recent falls back to last name
    assert _names(api.get("/api/clients/"))[:3] == ["shreya bhatlap", "Sanvi Bhatlapanumarti", "laura Tanzoe"]

    # Open laura, then sanvi → sanvi first, laura second, never-opened shreya after
    api.get(f"/api/clients/{laura.id}/")
    api.get(f"/api/clients/{sanvi.id}/")
    assert _names(api.get("/api/clients/")) == [
        "Sanvi Bhatlapanumarti", "laura Tanzoe", "shreya bhatlap", "Aaron Aardvark"]


@pytest.mark.django_db
def test_recent_is_per_user_and_views_are_deduped():
    from apps.audit.models import AccessLog
    ws, owner, coach1, _, c1, c2 = _make_workspace("r")
    api = _api(owner)
    assert api.get(f"/api/clients/{c2.id}/").status_code == 200
    api.get(f"/api/clients/{c2.id}/")   # within 10 min → no second row
    assert AccessLog.objects.filter(user=owner, client_id=c2.id, action="viewed_client").count() == 1
    # coach1 never opened anything → coach1's order is unaffected by the owner's views
    assert not AccessLog.objects.filter(user=coach1, action="viewed_client").exists()
