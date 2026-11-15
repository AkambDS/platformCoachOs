"""
Client affiliations: a client can belong to several of its workspace's affiliations
(Settings → Affiliation), never to another workspace's.

Run: pytest test_client_affiliations.py -v
"""
import pytest

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


@pytest.mark.django_db
def test_set_read_clear_and_workspace_scoping():
    from apps.activities.models import AffiliationConfig
    ws_a, owner_a, coach_a, _, client_a, _ = _make_workspace("a")
    ws_b, *_ = _make_workspace("b")
    rass = AffiliationConfig.objects.create(workspace=ws_a, name="Rass Consulting")
    lmt  = AffiliationConfig.objects.create(workspace=ws_a, name="LMT Consulting")
    other_ws = AffiliationConfig.objects.create(workspace=ws_b, name="Other WS biz")
    url = f"/api/clients/{client_a.id}/"

    # Owner sets two
    res = _api(owner_a).patch(url, {"affiliations": [rass.id, lmt.id]}, format="json")
    assert res.status_code == 200, res.content
    assert sorted(res.json()["affiliations"]) == sorted([rass.id, lmt.id])

    # The client's own coach can change them too (same rights as other client fields)
    res = _api(coach_a).patch(url, {"affiliations": [lmt.id]}, format="json")
    assert res.status_code == 200, res.content
    assert _api(owner_a).get(url).json()["affiliations"] == [lmt.id]

    # Another workspace's affiliation is rejected, and nothing changes
    res = _api(owner_a).patch(url, {"affiliations": [other_ws.id]}, format="json")
    assert res.status_code == 400, res.content
    assert "affiliations" in res.json()
    assert list(client_a.affiliations.values_list("id", flat=True)) == [lmt.id]

    # Deleting an affiliation in Settings drops it from the client
    assert _api(owner_a).delete(f"/api/settings/affiliations/{lmt.id}/").status_code == 204
    assert _api(owner_a).get(url).json()["affiliations"] == []

    # Clearing works
    _api(owner_a).patch(url, {"affiliations": [rass.id]}, format="json")
    res = _api(owner_a).patch(url, {"affiliations": []}, format="json")
    assert res.status_code == 200 and res.json()["affiliations"] == []


@pytest.mark.django_db
def test_only_owner_manages_the_list():
    ws, owner, coach, *_ = _make_workspace("o")
    assert _api(coach).post("/api/settings/affiliations/", {"name": "X"}, format="json").status_code == 403
    assert _api(coach).get("/api/settings/affiliations/").status_code == 200   # coaches can read to pick
    assert _api(owner).post("/api/settings/affiliations/", {"name": "X"}, format="json").status_code == 201
