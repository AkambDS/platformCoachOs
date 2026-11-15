"""
Website / LinkedIn typed without https:// ("www.linkedin.com/in/x") must save, with
https:// added — not fail with a bare "Enter a valid URL.".

Run: pytest test_client_url_fields.py -v
"""
import pytest

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


@pytest.mark.django_db
def test_scheme_less_urls_get_https_and_garbage_still_rejected():
    ws, owner, _, _, client, _ = _make_workspace("u")
    api = _api(owner)
    url = f"/api/clients/{client.id}/"

    res = api.patch(url, {"linkedin_url": "www.linkedin.com/in/arti-kamboj/",
                          "website": "  example.com  "}, format="json")
    assert res.status_code == 200, res.content
    client.refresh_from_db()
    assert client.linkedin_url == "https://www.linkedin.com/in/arti-kamboj/"
    assert client.website == "https://example.com"

    # Already-complete URLs and blanks are left alone
    res = api.patch(url, {"linkedin_url": "https://www.linkedin.com/in/arti-kamboj/", "website": ""}, format="json")
    assert res.status_code == 200, res.content
    client.refresh_from_db()
    assert client.linkedin_url == "https://www.linkedin.com/in/arti-kamboj/"
    assert client.website == ""

    # Real garbage is still a 400, keyed by the field so the UI can name it
    res = api.patch(url, {"linkedin_url": "not a url"}, format="json")
    assert res.status_code == 400
    assert "linkedin_url" in res.json()


@pytest.mark.django_db
def test_linkedin_must_be_a_linkedin_profile():
    ws, owner, _, _, client, _ = _make_workspace("l")
    api = _api(owner)
    url = f"/api/clients/{client.id}/"

    # Typo'd / country subdomains of linkedin.com → the canonical www host
    for typed in ("ww.linkedin.com/in/arti-kamboj/", "uk.linkedin.com/in/arti-kamboj/",
                  "http://linkedin.com/in/arti-kamboj/"):
        res = api.patch(url, {"linkedin_url": typed}, format="json")
        assert res.status_code == 200, (typed, res.content)
        client.refresh_from_db()
        assert client.linkedin_url == "https://www.linkedin.com/in/arti-kamboj/", typed

    # Not LinkedIn at all, a misspelt domain, or no profile path → 400, value unchanged
    for typed in ("linkdin.com/in/arti", "www.google.com/in/arti", "linkedin.com.evil.io/in/x",
                  "www.linkedin.com", "www.linkedin.com/"):
        res = api.patch(url, {"linkedin_url": typed}, format="json")
        assert res.status_code == 400, (typed, res.content)
        assert "linkedin_url" in res.json()
    client.refresh_from_db()
    assert client.linkedin_url == "https://www.linkedin.com/in/arti-kamboj/"


@pytest.mark.django_db
def test_pre_existing_non_linkedin_value_does_not_block_other_edits():
    from apps.clients.models import Client
    ws, owner, _, _, client, _ = _make_workspace("p")
    Client.objects.filter(pk=client.pk).update(linkedin_url="https://example.com/me")
    res = _api(owner).patch(f"/api/clients/{client.id}/",
                            {"linkedin_url": "https://example.com/me", "job_title": "CEO"}, format="json")
    assert res.status_code == 200, res.content
    client.refresh_from_db()
    assert client.job_title == "CEO"
