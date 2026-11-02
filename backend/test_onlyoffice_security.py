"""
OnlyOffice endpoint security (PHASE2.md DB-6).

The file and callback endpoints are AllowAny (the Document Server calls them, not a user),
so they must authenticate themselves: an item-bound `doc` token in the URL, plus — for the
save callback — a body signed by the Document Server, with only the signed values used and
downloads limited to our own OnlyOffice server. Without the secret they fail closed.

Run: pytest test_onlyoffice_security.py -v
"""
import io
import uuid
from datetime import date

import jwt
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

SECRET = "s" * 40
OO = dict(ONLYOFFICE_JWT_SECRET=SECRET, DEBUG=False,
          ONLYOFFICE_SERVER_URL="https://docs.example.com",
          ONLYOFFICE_INTERNAL_URL="http://onlyoffice",
          ONLYOFFICE_CALLBACK_BASE_URL="http://api:8000")


@pytest.fixture
def docs(db, workspace, business_owner, client_record):
    """One library item and one client file (assessment) in `workspace`, plus a library
    item in a second workspace."""
    from apps.accounts.models import Workspace
    from apps.library.models import KnowledgeItem
    from apps.clients.models import Assessment
    other_ws = Workspace.objects.create(name="Other", slug=f"other-{uuid.uuid4().hex[:6]}")
    return {
        "item": KnowledgeItem.objects.create(workspace=workspace, uploaded_by=business_owner, content_type="document",
                                             title="Doc", s3_key=f"library/{workspace.id}/a.docx", file_name="a.docx"),
        "other_ws_item": KnowledgeItem.objects.create(workspace=other_ws, content_type="document", title="Theirs",
                                                      s3_key=f"library/{other_ws.id}/b.docx", file_name="b.docx"),
        "assessment": Assessment.objects.create(workspace=workspace, client=client_record, assessment_type="disc",
                                                date=date.today(), file_s3_key=f"assessments/{workspace.id}/c.docx",
                                                file_name="c.docx"),
    }


@pytest.fixture
def fake_storage(monkeypatch):
    saved = {}
    monkeypatch.setattr("django.core.files.storage.default_storage.open", lambda *a, **k: io.BytesIO(b"DOC"))

    def save(name, content):
        saved[name] = content.read()
        return name
    monkeypatch.setattr("django.core.files.storage.default_storage.save", save)
    return saved


@pytest.fixture
def fake_fetch(monkeypatch):
    calls = []

    class R:
        status_code = 200
        content = b"EDITED"

    def get(url, timeout=None):
        calls.append(url)
        return R()
    monkeypatch.setattr("requests.get", get)
    return calls


def _path(url):
    return url.replace("http://api:8000", "")


def _ds_signed(body):
    """A callback body as the Document Server sends it: the body plus a token over it."""
    return {**body, "token": jwt.encode(body, SECRET, algorithm="HS256")}


# ── file endpoint ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
@override_settings(**OO)
def test_file_endpoint_needs_a_token_for_that_exact_document(docs, fake_storage):
    from apps.library.views import _doc_server_file_url
    from apps.clients.views import AssessmentViewSet
    api = APIClient()
    item, theirs, a = docs["item"], docs["other_ws_item"], docs["assessment"]
    own_url = _path(_doc_server_file_url(item))
    base = own_url.split("?")[0]

    assert api.get(base).status_code == 403                                       # no token
    assert api.get(base + "?doc=garbage").status_code == 403                      # forged
    assert api.get(base + "?" + _doc_server_file_url(theirs).split("?")[1]).status_code == 403  # other workspace's doc
    a_url = AssessmentViewSet()._doc_server_file_url(a)
    assert api.get(base + "?" + a_url.split("?")[1]).status_code == 403           # client-file token on a library doc
    cb_token = jwt.encode({"oo": "library-callback", "id": str(item.id)}, SECRET, algorithm="HS256")
    assert api.get(base + f"?doc={cb_token}").status_code == 403                  # callback token used as file token
    old_style = jwt.encode({"iid": str(item.id)}, SECRET, algorithm="HS256")
    assert api.get(base + f"?token={old_style}").status_code == 403               # pre-fix any-item token
    assert api.get(own_url).status_code == 200                                     # its own token works
    assert api.get(_path(a_url)).status_code == 200                                # client file with its own token


@pytest.mark.django_db
@override_settings(**{**OO, "ONLYOFFICE_JWT_SECRET": ""})
def test_file_endpoint_fails_closed_without_secret_in_production(docs, fake_storage):
    item = docs["item"]
    assert APIClient().get(f"/api/library/items/{item.id}/onlyoffice-file/").status_code == 403


@pytest.mark.django_db
@override_settings(**OO)
def test_expired_doc_token_is_refused(docs, fake_storage):
    from datetime import datetime, timezone as tz
    item = docs["item"]
    expired = jwt.encode({"oo": "library-file", "id": str(item.id), "exp": datetime(2020, 1, 1, tzinfo=tz.utc)},
                         SECRET, algorithm="HS256")
    assert APIClient().get(f"/api/library/items/{item.id}/onlyoffice-file/?doc={expired}").status_code == 403


# ── save callback ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
@override_settings(**OO)
def test_callback_rejects_unsigned_forged_or_misdirected_saves(docs, fake_storage, fake_fetch):
    from apps.library.views import _doc_server_callback_url
    from apps.library.models import KnowledgeItem
    item, theirs = docs["item"], docs["other_ws_item"]
    api = APIClient()
    cb = _path(_doc_server_callback_url(item))
    good = {"status": 2, "url": "https://docs.example.com/cache/files/x/output.docx", "key": "k"}

    # 1. Unsigned body (a user who saw the callback URL in their editor config)
    assert api.post(cb, good, format="json").data == {"error": 1}
    # 2. Signed body, but the URL's doc token is missing / for another workspace's item
    assert api.post(cb.split("?")[0], _ds_signed(good), format="json").data == {"error": 1}
    their_cb = _path(_doc_server_callback_url(theirs))
    assert api.post(cb.split("?")[0] + "?" + their_cb.split("?")[1], _ds_signed(good), format="json").data == {"error": 1}
    # 3. Signed body, but the plain body is tampered: only the SIGNED url may be used
    tampered = {**_ds_signed(good), "url": "http://169.254.169.254/latest/meta-data/"}
    assert api.post(cb, tampered, format="json").data == {"error": 0}
    assert fake_fetch == ["http://onlyoffice/cache/files/x/output.docx"]           # signed url, mapped internal
    fake_fetch.clear()
    # 4. Signed body pointing outside our OnlyOffice server → never fetched (no SSRF)
    evil = {"status": 2, "url": "http://169.254.169.254/latest/meta-data/", "key": "k"}
    version_before = KnowledgeItem.objects.get(pk=item.pk).version
    assert api.post(cb, _ds_signed(evil), format="json").data == {"error": 0}
    assert fake_fetch == []
    item.refresh_from_db()
    assert item.version == version_before                                          # refused save changed nothing


@pytest.mark.django_db
@override_settings(**OO)
def test_callback_header_token_form_and_valid_save(docs, fake_storage, fake_fetch):
    """Document Server's header-token form wraps the body in `payload`."""
    from apps.accounts.onlyoffice_auth import sign_doc_url
    from apps.clients.views import AssessmentViewSet
    a = docs["assessment"]
    api = APIClient()
    body = {"status": 6, "url": "http://onlyoffice/cache/files/y/output.docx", "key": "k"}
    header_token = jwt.encode({"payload": body}, SECRET, algorithm="HS256")
    path = f"/api/clients/{a.client_id}/assessments/{a.id}/onlyoffice-callback/"
    cb = _path(sign_doc_url(f"http://api:8000{path}", "assessment-callback", a.id))
    # the file's token (wrong purpose) can't be used on the callback
    file_token_qs = AssessmentViewSet()._doc_server_file_url(a).split("?")[1]
    assert api.post(f"{path}?{file_token_qs}", body, format="json",
                    HTTP_AUTHORIZATION=f"Bearer {header_token}").data == {"error": 1}
    before = a.version
    res = api.post(cb, body, format="json", HTTP_AUTHORIZATION=f"Bearer {header_token}")
    assert res.data == {"error": 0}
    a.refresh_from_db()
    assert a.version == before + 1 and fake_fetch == ["http://onlyoffice/cache/files/y/output.docx"]


# ── configs we hand out carry item-bound URLs ─────────────────────────────────

@pytest.mark.django_db
@override_settings(**OO)
def test_edit_config_urls_are_item_bound(docs, api_client):
    item = docs["item"]
    cfg = api_client.get(f"/api/library/items/{item.id}/edit-config/?mode=view").data["config"]
    for url, kind in ((cfg["document"]["url"], "library-file"), (cfg["editorConfig"]["callbackUrl"], "library-callback")):
        claims = jwt.decode(url.split("doc=")[1], SECRET, algorithms=["HS256"])
        assert claims["oo"] == kind and claims["id"] == str(item.id)


@override_settings(**OO)
def test_token_lifetimes():
    """File tokens (end up in browsers) are short; callback tokens outlive a long edit session."""
    from datetime import datetime, timezone as tz
    from apps.accounts.onlyoffice_auth import sign_doc_url
    def hours_left(url):
        exp = jwt.decode(url.split("doc=")[1], SECRET, algorithms=["HS256"])["exp"]
        return (datetime.fromtimestamp(exp, tz.utc) - datetime.now(tz.utc)).total_seconds() / 3600
    assert 1.9 < hours_left(sign_doc_url("http://x/f", "library-file", "1")) <= 2
    assert 29 * 24 < hours_left(sign_doc_url("http://x/c", "library-callback", "1")) <= 30 * 24
