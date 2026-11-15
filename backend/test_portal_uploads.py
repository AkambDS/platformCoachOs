"""
Client portal file uploads + per-client Portal Permissions (upload on/off, max size,
max file count, can-delete), and the owner/coach notification.

Run: pytest test_portal_uploads.py -v
"""
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from test_tenant_isolation import _api, _make_workspace, _portal_api, _no_side_effects  # noqa: F401


def _file(name="notes.pdf", size=1024):
    return SimpleUploadedFile(name, b"x" * size, content_type="application/pdf")


def _upload(client, **kw):
    return _portal_api(client).post("/api/portal/materials/upload/", {"file": _file(**kw)}, format="multipart")


@pytest.fixture
def storage(tmp_path, settings):
    # Keep test uploads off MinIO/S3.
    from django.core.files.storage import FileSystemStorage
    fs = FileSystemStorage(location=str(tmp_path))
    with mock.patch("django.core.files.storage.default_storage._wrapped", fs):
        yield fs


@pytest.mark.django_db
def test_defaults_upload_visibility_and_notification(storage, django_capture_on_commit_callbacks):
    from apps.library.models import KnowledgeItem
    ws, owner, coach1, coach2, client, _ = _make_workspace("pu")

    me = _portal_api(client).get("/api/portal/me/").json()
    assert me["uploads"] == {"enabled": True, "max_mb": 10, "max_files": 5, "used": 0, "can_delete": False}

    with mock.patch("tasks.email.send_client_file_uploaded.delay") as notify, \
         django_capture_on_commit_callbacks(execute=True):
        res = _upload(client)
    assert res.status_code == 201, res.content
    item = KnowledgeItem.objects.get(pk=res.json()["id"])
    notify.assert_not_called()                                   # private until shared
    assert item.uploaded_by_client == client and item.uploaded_by is None and item.workspace_id == ws.id
    assert item.visibility == "specific" and item.folder is None and item.shared_with_coach is False
    assert item.s3_key.startswith(f"library/{ws.id}/")
    assert item.shared_client_ids == [str(client.id)] and item.shared_user_ids == []

    ids = lambda u, q="": [i["id"] for i in (lambda d: d.get("results", d))(_api(u).get(f"/api/library/items/{q}").json())]
    # Private: only the client sees it — not the owner or coach, anywhere (list or by id)
    assert str(item.id) in [m["id"] for m in _portal_api(client).get("/api/portal/materials/").json()]
    for u in (owner, coach1):
        assert str(item.id) not in ids(u, "?client_uploads=1")
        assert str(item.id) not in ids(u, f"?shared_with_client={client.id}")
        assert _api(u).get(f"/api/library/items/{item.id}/").status_code == 404

    # Share with coach → owner + coach emailed, and now visible to them
    with mock.patch("tasks.email.send_client_file_uploaded.delay") as notify, \
         django_capture_on_commit_callbacks(execute=True):
        res = _portal_api(client).post(f"/api/portal/materials/{item.id}/share/", {"shared": True}, format="json")
    assert res.status_code == 200 and res.json()["shared_with_coach"] is True
    notify.assert_called_once_with(str(item.id))

    # Shared: NOT in anyone's Library → All Files, but on the Client Files page (+ the
    # client's Files tab) for the owner and their coach — not another coach.
    for u in (owner, coach1, coach2):
        assert str(item.id) not in ids(u)
    assert str(item.id) in ids(owner, "?client_uploads=1") and str(item.id) in ids(coach1, "?client_uploads=1")
    assert str(item.id) not in ids(coach2, "?client_uploads=1")
    assert str(item.id) in ids(owner, f"?client_uploads=1&client={client.id}")
    assert str(item.id) in ids(coach1, f"?shared_with_client={client.id}")
    row = _api(owner).get("/api/library/items/?client_uploads=1").json()
    assert (row.get("results", row))[0]["uploaded_by_client_name"] == client.full_name
    assert _portal_api(client).get("/api/portal/me/").json()["uploads"]["used"] == 1


@pytest.mark.django_db
def test_limits_and_switches(storage):
    from apps.clients.models import Client
    ws, owner, coach, _, client, _ = _make_workspace("pl")

    assert _upload(client, name="run.exe").status_code == 400                      # file type
    Client.objects.filter(pk=client.pk).update(portal_upload_max_mb=1)
    assert _upload(client, size=2 * 1024 * 1024).status_code == 400                # size
    Client.objects.filter(pk=client.pk).update(portal_upload_max_files=1)
    assert _upload(client).status_code == 201
    res = _upload(client)                                                          # count
    assert res.status_code == 400 and "limit of 1" in res.json()["detail"]
    Client.objects.filter(pk=client.pk).update(portal_upload_enabled=False, portal_upload_max_files=5)
    assert _upload(client).status_code == 403                                      # switched off


@pytest.mark.django_db
def test_delete_only_own_and_only_when_allowed(storage):
    from apps.clients.models import Client
    from apps.library.models import KnowledgeItem
    ws, owner, coach, _, client, other_client = _make_workspace("pd")
    mine = _upload(client).json()["id"]
    coach_shared = KnowledgeItem.objects.create(workspace=ws, title="from coach", content_type="pdf",
                                                visibility="specific", shared_client_ids=[str(client.id)])
    others = _upload(other_client).json()["id"]
    api = _portal_api(client)

    assert api.delete(f"/api/portal/materials/{mine}/").status_code == 403         # off by default
    Client.objects.filter(pk=client.pk).update(portal_can_delete_uploads=True)
    assert api.delete(f"/api/portal/materials/{coach_shared.id}/").status_code == 404   # coach's file
    assert api.delete(f"/api/portal/materials/{others}/").status_code == 404            # another client's
    assert api.delete(f"/api/portal/materials/{mine}/").status_code == 204
    assert not KnowledgeItem.objects.filter(pk=mine).exists()
    assert KnowledgeItem.objects.filter(pk=coach_shared.id).exists()


@pytest.mark.django_db
def test_owner_and_coach_edit_permissions_with_bounds():
    ws, owner, coach, coach2, client, _ = _make_workspace("pp")
    url = f"/api/clients/{client.id}/"
    res = _api(coach).patch(url, {"portal_upload_max_files": 8, "portal_can_delete_uploads": True}, format="json")
    assert res.status_code == 200, res.content
    res = _api(owner).patch(url, {"portal_upload_enabled": False, "portal_upload_max_mb": 25}, format="json")
    assert res.status_code == 200, res.content
    client.refresh_from_db()
    assert (client.portal_upload_enabled, client.portal_upload_max_mb, client.portal_upload_max_files,
            client.portal_can_delete_uploads) == (False, 25, 8, True)
    assert _api(owner).patch(url, {"portal_upload_max_mb": 500}, format="json").status_code == 400  # > 100 MB cap
    assert _api(coach2).patch(url, {"portal_upload_max_files": 50}, format="json").status_code == 404  # not their client


@pytest.mark.django_db
def test_notification_email_goes_to_owner_and_coach(storage, settings, mailoutbox):
    from tasks.email import send_client_file_uploaded
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    ws, owner, coach, _, client, _ = _make_workspace("pn")
    item_id = _upload(client, name="Intake form.pdf").json()["id"]
    _portal_api(client).post(f"/api/portal/materials/{item_id}/share/", {"shared": True}, format="json")
    send_client_file_uploaded(item_id)
    assert sorted(m.to[0] for m in mailoutbox) == sorted([owner.email, coach.email])
    assert all("Intake form.pdf" in m.subject for m in mailoutbox)


@pytest.mark.django_db
def test_client_can_edit_own_uploads_only(storage):
    from apps.library.models import KnowledgeItem
    ws, owner, coach, _, client, _ = _make_workspace("pe")
    mine = _portal_api(client).post("/api/portal/materials/upload/",
                                    {"file": SimpleUploadedFile("plan.docx", b"x" * 100)}, format="multipart").json()["id"]
    shared = KnowledgeItem.objects.create(workspace=ws, title="Worksheet", content_type="document",
                                          file_name="worksheet.docx", s3_key=f"library/{ws.id}/w.docx",
                                          visibility="specific", shared_client_ids=[str(client.id)])
    api = _portal_api(client)
    cfg = lambda item_id, mode: api.get(f"/api/portal/materials/{item_id}/view-config/", {"mode": mode})
    with mock.patch("apps.library.views._doc_server_file_url", return_value="http://files/x"):
        res = cfg(mine, "edit")
        assert res.status_code == 200, res.content
        assert res.json()["config"]["editorConfig"]["mode"] == "edit"
        assert res.json()["config"]["document"]["permissions"]["edit"] is True
        assert cfg(shared.id, "edit").status_code == 403                       # coach's file
        res = cfg(shared.id, "view")
        assert res.status_code == 200 and res.json()["config"]["editorConfig"]["mode"] == "view"


@pytest.mark.django_db
def test_owner_and_coach_can_edit_client_files(storage):
    """Client page → Files: the owner and the client's coach can open client files and the
    client's portal uploads in edit mode; another coach can't, and a coach can't edit a
    shared Library file someone else uploaded (it may be shared with many clients)."""
    from apps.clients.models import Assessment
    from apps.library.models import KnowledgeItem
    ws, owner, coach, coach2, client, _ = _make_workspace("ce")
    upload = _portal_api(client).post("/api/portal/materials/upload/",
                                      {"file": SimpleUploadedFile("plan.docx", b"x" * 100)}, format="multipart").json()["id"]
    _portal_api(client).post(f"/api/portal/materials/{upload}/share/", {"shared": True}, format="json")
    from datetime import date
    vault = Assessment.objects.create(workspace=ws, client=client, uploaded_by=owner, assessment_type="other",
                                      date=date(2026, 11, 1),
                                      file_name="intake.docx", file_s3_key=f"clients/{ws.id}/i.docx")
    owners_doc = KnowledgeItem.objects.create(workspace=ws, title="Worksheet", content_type="document",
                                              file_name="w.docx", s3_key=f"library/{ws.id}/w.docx", uploaded_by=owner,
                                              visibility="specific", shared_client_ids=[str(client.id)],
                                              shared_user_ids=[str(coach.id)])
    lib  = lambda u, i: _api(u).get(f"/api/library/items/{i}/edit-config/", {"mode": "edit"}).status_code
    file = lambda u: _api(u).get(f"/api/clients/{client.id}/assessments/{vault.id}/edit-config/", {"mode": "edit"}).status_code
    with mock.patch("apps.library.views._doc_server_file_url", return_value="http://f/x"), \
         mock.patch("apps.clients.views.AssessmentViewSet._doc_server_file_url", return_value="http://f/x"):
        assert lib(owner, upload) == 200 and lib(coach, upload) == 200
        assert lib(coach2, upload) == 404                      # not their client — can't even see it
        assert lib(coach, owners_doc.id) == 403                # someone else's shared Library file
        assert file(owner) == 200 and file(coach) == 200
        assert file(coach2) == 404


@pytest.mark.django_db
def test_unshare_hides_again_and_only_own_files(storage):
    ws, owner, coach, _, client, other = _make_workspace("us")
    mine = _upload(client).json()["id"]
    theirs = _upload(other).json()["id"]
    api = _portal_api(client)
    share = lambda i, v: api.post(f"/api/portal/materials/{i}/share/", {"shared": v}, format="json")
    assert share(theirs, True).status_code == 404                      # another client's file
    assert share(mine, True).status_code == 200
    assert _api(owner).get(f"/api/library/items/{mine}/").status_code == 200
    assert share(mine, False).status_code == 200
    assert _api(owner).get(f"/api/library/items/{mine}/").status_code == 404


@pytest.mark.django_db
def test_uploads_are_per_workspace(storage):
    """The same person is a client of two workspaces (separate Client rows, separate portal
    logins). Each upload lives in its own workspace: stored under that workspace's prefix,
    visible only in that workspace's portal login and to that workspace's owner."""
    from apps.clients.models import Client
    ws_a, owner_a, *_ = _make_workspace("wa")
    ws_b, owner_b, *_ = _make_workspace("wb")
    alice_a = Client.objects.create(workspace=ws_a, coach=owner_a, first_name="Al", last_name="Ice", email="alice@x.test")
    alice_b = Client.objects.create(workspace=ws_b, coach=owner_b, first_name="Al", last_name="Ice", email="alice@x.test")

    a_file = _upload(alice_a).json()["id"]
    _portal_api(alice_a).post(f"/api/portal/materials/{a_file}/share/", {"shared": True}, format="json")
    from apps.library.models import KnowledgeItem
    assert KnowledgeItem.objects.get(pk=a_file).s3_key.startswith(f"library/{ws_a.id}/")

    # Workspace B's portal login for the same person doesn't see it, can't share/delete it
    assert a_file not in [m["id"] for m in _portal_api(alice_b).get("/api/portal/materials/").json()]
    assert _portal_api(alice_b).post(f"/api/portal/materials/{a_file}/share/", {"shared": False}, format="json").status_code == 404
    assert _portal_api(alice_b).get("/api/portal/me/").json()["uploads"]["used"] == 0
    # Workspace B's owner can't see it; workspace A's owner can
    ids = lambda u: [i["id"] for i in (lambda d: d.get("results", d))(_api(u).get("/api/library/items/?client_uploads=1").json())]
    assert a_file not in ids(owner_b) and a_file in ids(owner_a)
    assert _api(owner_b).get(f"/api/library/items/{a_file}/").status_code == 404


@pytest.mark.django_db
def test_shared_client_file_is_locked_against_resharing(storage):
    """Library → Shared with you: owner/coach can open, edit live and delete a client's
    shared file, but not change its sharing, swap the file or convert it into a copy."""
    ws, owner, coach, _, client, _ = _make_workspace("lk")
    fid = _upload(client, name="journal.docx").json()["id"]
    _portal_api(client).post(f"/api/portal/materials/{fid}/share/", {"shared": True}, format="json")
    for u in (owner, coach):
        api = _api(u)
        assert api.get(f"/api/library/items/{fid}/").status_code == 200
        assert api.patch(f"/api/library/items/{fid}/", {"visibility": "internal"}, format="json").status_code == 403
        assert api.post(f"/api/library/items/{fid}/replace-file/",
                        {"file": SimpleUploadedFile("x.docx", b"y")}, format="multipart").status_code == 403
        assert api.post(f"/api/library/items/{fid}/convert-to-pdf/", {}, format="json").status_code == 403
    assert _api(owner).delete(f"/api/library/items/{fid}/").status_code == 204
