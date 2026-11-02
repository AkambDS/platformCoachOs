"""
Tenant-isolation regression suite (PHASE2.md §1a — DB-1, DB-2, DB-8).

The basic multi-tenant rule: data is never read, changed, deleted, or linked across
workspaces — and inside one workspace a coach only reaches their own clients. Two
workspaces are built here:

  Workspace A: owner_a, coach_a1 (client_a1 + all its records), coach_a2 (client_a2)
  Workspace B: owner_b, coach_b1 (client_b1)

and every role is pointed at the other side's data. Any 2xx that exposes or touches
the other side's rows fails the suite. Runs against the pytest test DB only.

Run: pytest test_tenant_isolation.py -v
"""
import json
import uuid
from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

DENIED = (400, 403, 404)


# ── helpers ───────────────────────────────────────────────────────────────────

def _api(user):
    c = APIClient()
    r = RefreshToken.for_user(user)
    r["workspace_id"] = str(user.workspace_id) if user.workspace_id else None
    r["role"] = user.role
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.access_token}")
    return c


def _portal_api(client):
    c = APIClient()
    t = RefreshToken()
    t["client_id"] = str(client.id)
    t["workspace_id"] = str(client.workspace_id)
    t["role"] = "portal_client"
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {t.access_token}")
    return c


def _body(res):
    return res.content.decode(errors="ignore")


def _assert_hidden(res, *secret_ids):
    """Denied outright, or a 2xx that mentions none of the other side's ids."""
    if res.status_code in DENIED:
        return
    assert res.status_code < 300, f"unexpected {res.status_code}: {_body(res)[:300]}"
    body = _body(res)
    for sid in secret_ids:
        assert str(sid) not in body, f"leaked {sid} via {res.request['PATH_INFO']}"


# ── world ─────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _no_side_effects(monkeypatch):
    # Activity create/update fires calendar sync + emails in background threads.
    monkeypatch.setattr("apps.activities.serializers._fire", lambda fn, *a: None)


def _make_workspace(tag):
    from apps.accounts.models import Workspace, User
    from apps.clients.models import Client

    ws = Workspace.objects.create(name=f"WS {tag}", slug=f"ws-{tag}-{uuid.uuid4().hex[:6]}")
    mk = lambda role, n: User.objects.create_user(
        email=f"{n}-{uuid.uuid4().hex[:6]}@{tag}.test", password="x" * 12,
        full_name=n, workspace=ws, role=role)
    owner, coach1, coach2 = mk("business_owner", f"owner-{tag}"), mk("coach", f"coach1-{tag}"), mk("coach", f"coach2-{tag}")
    c1 = Client.objects.create(workspace=ws, coach=coach1, first_name=f"Cl1{tag}", last_name="X",
                               email=f"c1@{tag}.test", portal_access=True)
    c2 = Client.objects.create(workspace=ws, coach=coach2, first_name=f"Cl2{tag}", last_name="Y",
                               email=f"c2@{tag}.test", portal_access=True)
    return ws, owner, coach1, coach2, c1, c2


@pytest.fixture
def world(db):
    from apps.activities.models import Activity, AffiliationConfig
    from apps.clients.models import ClientNote, ClientGoal, Commitment, Assessment
    from apps.invoicing.models import Invoice
    from apps.pipeline.models import Deal
    from apps.library.models import KnowledgeFolder, KnowledgeItem
    from apps.feedback.models import FeedbackTicket

    ws_a, owner_a, coach_a1, coach_a2, client_a1, client_a2 = _make_workspace("a")
    ws_b, owner_b, coach_b1, coach_b2, client_b1, client_b2 = _make_workspace("b")

    start = timezone.now() + timedelta(days=3)
    a = {
        "client":     client_a1,
        "note":       ClientNote.objects.create(workspace=ws_a, client=client_a1, text="A1 private note", visible_to_client=True),
        "note_c2":    ClientNote.objects.create(workspace=ws_a, client=client_a2, text="A2 note", visible_to_client=True),
        "goal":       ClientGoal.objects.create(workspace=ws_a, client=client_a1, title="A1 goal", visible_to_client=True),
        "commitment": Commitment.objects.create(workspace=ws_a, client=client_a1, text="A1 commitment"),
        "assessment": Assessment.objects.create(workspace=ws_a, client=client_a1, assessment_type="disc",
                                                date=date.today(), file_s3_key=f"assessments/{ws_a.id}/x.pdf", file_name="x.pdf"),
        "activity":   Activity.objects.create(workspace=ws_a, client=client_a1, coach=coach_a1, activity_type="call",
                                              title="A1 session", start_at=start, end_at=start + timedelta(hours=1)),
        "invoice":    Invoice.objects.create(workspace=ws_a, client=client_a1, coach=coach_a1, number="INV-0001",
                                             issue_date=date.today(), due_date=date.today() + timedelta(days=7), status="sent"),
        "invoice_c2": Invoice.objects.create(workspace=ws_a, client=client_a2, coach=coach_a2, number="INV-0002",
                                             issue_date=date.today(), due_date=date.today() + timedelta(days=7), status="sent"),
        "deal":       Deal.objects.create(workspace=ws_a, client=client_a1, coach=coach_a1, stage="lead_new"),
        "folder":     KnowledgeFolder.objects.create(workspace=ws_a, name="A folder"),
        "affiliation": AffiliationConfig.objects.create(workspace=ws_a, name="A affiliation"),
        "ticket":     FeedbackTicket.objects.create(workspace=ws_a, submitted_by=owner_a, title="A ticket", description="d"),
    }
    a["item"] = KnowledgeItem.objects.create(workspace=ws_a, folder=a["folder"], content_type="document",
                                             title="A doc", visibility="client_visible", s3_key=f"library/{ws_a.id}/a.docx")
    return {
        "ws_a": ws_a, "owner_a": owner_a, "coach_a1": coach_a1, "coach_a2": coach_a2,
        "client_a1": client_a1, "client_a2": client_a2, "a": a,
        "ws_b": ws_b, "owner_b": owner_b, "coach_b1": coach_b1, "client_b1": client_b1,
    }


def _detail_urls(a):
    c = a["client"].id
    return [
        f"/api/clients/{c}/",
        f"/api/clients/{c}/notes/{a['note'].id}/",
        f"/api/clients/{c}/goals/{a['goal'].id}/",
        f"/api/clients/{c}/assessments/{a['assessment'].id}/",
        f"/api/activities/{a['activity'].id}/",
        f"/api/invoices/{a['invoice'].id}/",
        f"/api/pipeline/deals/{a['deal'].id}/",
        f"/api/library/folders/{a['folder'].id}/",
        f"/api/library/items/{a['item'].id}/",
        f"/api/feedback/{a['ticket'].id}/",
    ]


def _nested_list_urls(a):
    c = a["client"].id
    return [f"/api/clients/{c}/{n}/" for n in ("notes", "goals", "assessments", "messages", "availability")]


LIST_URLS = [
    "/api/clients/", "/api/activities/", "/api/invoices/", "/api/pipeline/deals/",
    "/api/library/folders/", "/api/library/items/", "/api/feedback/", "/api/clients/email-log/",
    "/api/audit/", "/api/auth/team/", "/api/reports/outstanding/", "/api/settings/affiliations/",
]


def _secret_ids(w):
    a = w["a"]
    return [w["client_a1"].id, w["client_a2"].id, w["coach_a1"].id] + [
        a[k].id for k in ("note", "goal", "assessment", "activity", "invoice", "deal", "folder", "item", "ticket")
    ] + ["A affiliation", "A1 private note", "Cl1a", "Cl2a"]   # names too (affiliation id is a small int)


# ── 1. Cross-workspace reads ──────────────────────────────────────────────────

@pytest.mark.django_db
@pytest.mark.parametrize("who", ["owner_b", "coach_b1"])
def test_other_workspace_cannot_read_details(world, who):
    api = _api(world[who])
    for url in _detail_urls(world["a"]) + _nested_list_urls(world["a"]):
        _assert_hidden(api.get(url), *_secret_ids(world))


@pytest.mark.django_db
@pytest.mark.parametrize("who", ["owner_b", "coach_b1"])
def test_other_workspace_lists_never_include_foreign_rows(world, who):
    api = _api(world[who])
    for url in LIST_URLS:
        _assert_hidden(api.get(url), *_secret_ids(world))


# ── 2. Cross-workspace update / delete ────────────────────────────────────────

@pytest.mark.django_db
def test_other_workspace_cannot_modify_or_delete(world):
    from apps.clients.models import Client, ClientNote
    from apps.invoicing.models import Invoice
    from apps.activities.models import Activity
    from apps.pipeline.models import Deal
    from apps.library.models import KnowledgeItem

    api, a = _api(world["owner_b"]), world["a"]
    for url in _detail_urls(a):
        assert api.patch(url, {"title": "pwned", "first_name": "pwned", "text": "pwned"}, format="json").status_code in DENIED, url
        assert api.delete(url).status_code in DENIED, url

    assert Client.objects.get(pk=a["client"].pk).first_name == "Cl1a"
    assert ClientNote.objects.get(pk=a["note"].pk).text == "A1 private note"
    for M, key in ((Invoice, "invoice"), (Activity, "activity"), (Deal, "deal"), (KnowledgeItem, "item")):
        assert M.objects.filter(pk=a[key].pk).exists(), key


# ── 3. Cross-workspace linking (DB-1) ─────────────────────────────────────────

def _activity_payload(day=5, **fk):
    s = timezone.now() + timedelta(days=day)
    return {"title": "x", "activity_type": "call", "start_at": s.isoformat(),
            "end_at": (s + timedelta(hours=1)).isoformat(), "send_confirmation": False, **fk}


def _invoice_payload(**fk):
    return {"issue_date": str(date.today()), "due_date": str(date.today() + timedelta(days=7)), "items": [], **fk}


@pytest.mark.django_db
def test_cannot_create_records_pointing_at_other_workspace(world):
    from apps.invoicing.models import Invoice
    from apps.pipeline.models import Deal
    from apps.activities.models import Activity

    api, a = _api(world["owner_b"]), world["a"]
    foreign_client, foreign_coach = str(world["client_a1"].id), str(world["coach_a1"].id)
    own_client = str(world["client_b1"].id)

    cases = [
        ("/api/invoices/",       _invoice_payload(client=foreign_client)),
        ("/api/invoices/",       _invoice_payload(client=own_client, coach=foreign_coach)),
        ("/api/pipeline/deals/", {"client": foreign_client, "stage": "lead_new"}),
        ("/api/pipeline/deals/", {"client": own_client, "coach": foreign_coach, "stage": "lead_new"}),
        ("/api/activities/",     _activity_payload(client=foreign_client)),
        ("/api/activities/",     _activity_payload(client=own_client, coach=foreign_coach)),
        ("/api/activities/",     _activity_payload(client=own_client, deal=str(a["deal"].id))),
        ("/api/activities/",     _activity_payload(client=own_client, affiliation=a["affiliation"].id)),
        ("/api/library/folders/", {"name": "x", "parent": str(a["folder"].id)}),
        ("/api/library/items/",  {"title": "x", "content_type": "document", "folder": str(a["folder"].id)}),
        ("/api/library/items/",  {"title": "x", "content_type": "document", "s3_key": a["item"].s3_key}),
    ]
    for url, payload in cases:
        res = api.post(url, payload, format="json")
        assert res.status_code in DENIED, f"{url} {payload} -> {res.status_code} {_body(res)[:200]}"

    # Nothing in workspace B ended up attached to workspace A's client.
    for M in (Invoice, Deal, Activity):
        assert not M.objects.filter(workspace=world["ws_b"], client__workspace=world["ws_a"]).exists(), M.__name__


@pytest.mark.django_db
def test_cannot_reassign_existing_records_to_other_workspace(world):
    from apps.clients.models import Client
    api = _api(world["owner_b"])
    b_client = world["client_b1"]
    res = api.patch(f"/api/clients/{b_client.id}/", {"coach": str(world["coach_a1"].id)}, format="json")
    assert res.status_code in DENIED
    assert Client.objects.get(pk=b_client.pk).coach_id != world["coach_a1"].id


@pytest.mark.django_db
def test_library_share_lists_drop_foreign_ids(world):
    api = _api(world["owner_b"])
    res = api.post("/api/library/items/", {
        "title": "share test", "content_type": "document", "visibility": "specific",
        "shared_client_ids": [str(world["client_a1"].id), str(world["client_b1"].id), "not-a-uuid"],
        "shared_user_ids": [str(world["owner_a"].id), str(world["owner_b"].id)],
    }, format="json")
    assert res.status_code == 201, _body(res)
    assert res.data["shared_client_ids"] == [str(world["client_b1"].id)]
    assert res.data["shared_user_ids"] == [str(world["owner_b"].id)]


@pytest.mark.django_db
def test_csv_import_stays_in_importers_workspace(world):
    """Import creates clients (and deals) only in the importer's workspace; a coach_email
    from another workspace never resolves — the row falls back to the importer's own owner."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from apps.clients.models import Client
    from apps.pipeline.models import Deal

    csv_text = (
        "first_name,last_name,email_1,coach_email,pipeline\n"
        f"Imp,One,imp1@b.test,{world['coach_a1'].email},lead_new\n"   # A's coach — must not resolve
        f"Imp,Two,{world['client_a1'].email},,\n"                      # same email as A's client — not a dup in B
    )
    api = _api(world["owner_b"])
    res = api.post("/api/clients/import/",
                   {"file": SimpleUploadedFile("c.csv", csv_text.encode(), content_type="text/csv")},
                   format="multipart")
    assert res.status_code == 201, _body(res)
    assert res.data["created"] == 2, res.data
    assert "already exists" not in _body(res)                         # A's client not revealed

    imported = Client.objects.filter(email__in=["imp1@b.test", world["client_a1"].email], first_name="Imp")
    assert imported.count() == 2
    for c in imported:
        assert c.workspace_id == world["ws_b"].id
        assert c.coach_id == world["owner_b"].id                        # fallback, never A's coach
    assert Deal.objects.filter(client__in=imported, workspace=world["ws_b"]).count() == 1
    assert not Client.objects.filter(workspace=world["ws_a"], first_name="Imp").exists()


@pytest.mark.django_db
def test_coach_without_clients_edit_cannot_create_or_import(world):
    """Tab permissions gate client creation by every route: a coach the owner set to
    Clients = view-only can't add a client via the form OR bulk-create via CSV import."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from apps.accounts.models import TabPermission
    from apps.clients.models import Client

    coach = world["coach_a1"]
    TabPermission.objects.create(workspace=world["ws_a"], user=coach, tab="clients",
                                 can_view=True, can_edit=False, can_delete=False)
    api = _api(coach)
    before = Client.objects.filter(workspace=world["ws_a"]).count()

    res = api.post("/api/clients/", {"first_name": "No", "last_name": "Edit", "email": "noedit@a.test"}, format="json")
    assert res.status_code == 403, _body(res)
    csv_text = "first_name,last_name,email_1\nNo,Import,noimport@a.test\n"
    res = api.post("/api/clients/import/",
                   {"file": SimpleUploadedFile("c.csv", csv_text.encode(), content_type="text/csv")},
                   format="multipart")
    assert res.status_code == 403, _body(res)
    assert Client.objects.filter(workspace=world["ws_a"]).count() == before

    # Export only needs view — still allowed.
    assert api.get("/api/clients/export/").status_code == 200

    # With the default coach permissions (edit allowed), import works again.
    TabPermission.objects.filter(user=coach).delete()
    res = api.post("/api/clients/import/",
                   {"file": SimpleUploadedFile("c.csv", csv_text.encode(), content_type="text/csv")},
                   format="multipart")
    assert res.status_code == 201, _body(res)


@pytest.mark.django_db
def test_only_owner_can_grant_or_revoke_portal_access(world, monkeypatch):
    """Portal access is a workspace-owner decision: coaches can't invite/revoke (even on
    their own client, even with Clients edit), and can't flip portal_access via a plain edit."""
    from apps.clients.models import Client
    monkeypatch.setattr("tasks.email.send_portal_invite_email", lambda *a, **kw: None)
    client = world["client_a1"]                       # coach_a1's own client
    Client.objects.filter(pk=client.pk).update(portal_access=False)
    coach = _api(world["coach_a1"])

    assert coach.post(f"/api/clients/{client.id}/invite-portal/").status_code == 403
    coach.patch(f"/api/clients/{client.id}/", {"portal_access": True}, format="json")
    client.refresh_from_db(); assert client.portal_access is False

    owner = _api(world["owner_a"])
    assert owner.post(f"/api/clients/{client.id}/invite-portal/").status_code == 200
    client.refresh_from_db(); assert client.portal_access is True
    assert coach.post(f"/api/clients/{client.id}/revoke-portal/").status_code == 403
    client.refresh_from_db(); assert client.portal_access is True
    assert owner.post(f"/api/clients/{client.id}/revoke-portal/").status_code == 200
    client.refresh_from_db(); assert client.portal_access is False


@pytest.mark.django_db
def test_only_one_business_owner_per_workspace(world):
    """The DB refuses a second business owner in a workspace (as the pre-fix login fallback
    once created); coaches/assistants can still be added, and other workspaces keep theirs."""
    from django.db import IntegrityError, transaction
    from apps.accounts.models import User
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            User.objects.create_user(email="owner2@a.test", password="x" * 12, full_name="Owner Two",
                                     workspace=world["ws_a"], role="business_owner")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            User.objects.filter(pk=world["coach_a1"].pk).update(role="business_owner")   # promote → refused
    User.objects.create_user(email="coach3@a.test", password="x" * 12, full_name="Coach Three",
                             workspace=world["ws_a"], role="coach")
    assert User.objects.filter(workspace=world["ws_a"], role="business_owner").count() == 1
    assert User.objects.filter(workspace=world["ws_b"], role="business_owner").count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["platform_admin", "business_owner"])
def test_invite_cannot_create_owner_or_superadmin(world, role, monkeypatch):
    """An owner can only invite coach/assistant/limited — never a second business owner, and
    never a platform admin (who would see every workspace). Also refused at accept time for
    invitations stored before the restriction."""
    from datetime import timedelta
    from django.utils import timezone
    from apps.accounts.models import User, WorkspaceInvitation
    monkeypatch.setattr("tasks.email.send_invite_email", lambda *a, **kw: None)
    owner = _api(world["owner_a"])
    res = owner.post("/api/auth/invite/", {"email": f"esc-{role}@x.test", "role": role}, format="json")
    assert res.status_code == 400, _body(res)
    assert not WorkspaceInvitation.objects.filter(email=f"esc-{role}@x.test").exists()

    legacy = WorkspaceInvitation.objects.create(workspace=world["ws_a"], invited_by=world["owner_a"],
                                                email=f"legacy-{role}@x.test", role=role,
                                                expires_at=timezone.now() + timedelta(hours=48))
    res = APIClient().post("/api/auth/accept-invite/", {"token": str(legacy.token), "password": "longpassword1",
                                                        "full_name": "Legacy"}, format="json")
    assert res.status_code == 400, _body(res)
    assert not User.objects.filter(email=f"legacy-{role}@x.test").exists()

    # control: a normal coach invite still works
    assert owner.post("/api/auth/invite/", {"email": "ok-coach@x.test", "role": "coach"}, format="json").status_code in (200, 201)


@pytest.mark.django_db
def test_branding_is_never_another_workspaces(world):
    """Pre-login branding is neutral unless a workspace is named; the portal shows the
    client's OWN workspace logo/name (this used to return the oldest workspace's to all)."""
    from apps.accounts.models import Workspace
    Workspace.objects.filter(pk=world["ws_a"].pk).update(logo_data="data:image/png;base64,AAAA")
    anon = APIClient()
    assert anon.get("/api/settings/public-branding/").data["name"] == "CoachOS"
    assert anon.get("/api/settings/public-branding/").data["logo_url"] == ""
    a = anon.get(f"/api/settings/public-branding/?workspace={world['ws_a'].slug}").data
    assert a["name"] == world["ws_a"].name and str(world["ws_a"].id) in a["logo_url"]
    b = anon.get(f"/api/settings/public-branding/?workspace={world['ws_b'].slug}").data
    assert b["name"] == world["ws_b"].name and b["logo_url"] == ""

    me_b = _portal_api(world["client_b1"]).get("/api/portal/me/").data
    assert me_b["workspace_name"] == world["ws_b"].name and me_b["workspace_logo_url"] == ""
    me_a = _portal_api(world["client_a1"]).get("/api/portal/me/").data
    assert str(world["ws_a"].id) in me_a["workspace_logo_url"]


# ── 4. Inside one workspace: coach sees only their own clients ───────────────

@pytest.mark.django_db
def test_coach_cannot_reach_another_coachs_client(world):
    api, a = _api(world["coach_a2"]), world["a"]
    for url in _detail_urls(a)[:7] + _nested_list_urls(a):   # client-owned records
        _assert_hidden(api.get(url), world["client_a1"].id, a["note"].id, a["invoice"].id, a["activity"].id, a["deal"].id)

    foreign = str(world["client_a1"].id)
    for url, payload in (
        ("/api/invoices/",       _invoice_payload(client=foreign)),
        ("/api/pipeline/deals/", {"client": foreign, "stage": "lead_new"}),
        ("/api/activities/",     _activity_payload(client=foreign)),
    ):
        assert api.post(url, payload, format="json").status_code in DENIED, url


# ── 5. Positive controls: normal work still succeeds ─────────────────────────

@pytest.mark.django_db
def test_owner_and_coach_can_still_work_with_their_own_clients(world):
    owner, coach = _api(world["owner_a"]), _api(world["coach_a1"])
    c1 = str(world["client_a1"].id)
    for day, api in ((10, owner), (12, coach)):   # separate slots — same coach's calendar
        for url, payload in (
            ("/api/invoices/",       _invoice_payload(client=c1)),
            ("/api/pipeline/deals/", {"client": c1, "stage": "lead_new"}),
            ("/api/activities/",     _activity_payload(day=day, client=c1, coach=str(world["coach_a1"].id))),
        ):
            res = api.post(url, payload, format="json")
            assert res.status_code == 201, f"{url} -> {res.status_code} {_body(res)[:300]}"
    # Owner may assign any coach in the workspace.
    res = owner.patch(f"/api/clients/{c1}/", {"coach": str(world["coach_a2"].id)}, format="json")
    assert res.status_code == 200, _body(res)


# ── 6. Client portal ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_portal_client_sees_only_their_own_records(world):
    a = world["a"]
    api = _portal_api(world["client_a2"])
    for url in ("/api/portal/goals/", "/api/portal/notes/", "/api/portal/invoices/", "/api/portal/activities/"):
        _assert_hidden(api.get(url), world["client_a1"].id, a["note"].id, a["goal"].id, a["invoice"].id, a["activity"].id)
    assert api.get(f"/api/portal/goals/{a['goal'].id}/progress/").status_code in DENIED + (405,)

    other_ws = _portal_api(world["client_b1"])
    for url in ("/api/portal/goals/", "/api/portal/notes/", "/api/portal/invoices/",
                "/api/portal/activities/", "/api/portal/materials/"):
        _assert_hidden(other_ws.get(url), *_secret_ids(world))


# ── 7. DB-2: workspace-less login is refused, never attached elsewhere ───────

@pytest.mark.django_db
def test_login_without_workspace_is_refused(world):
    from apps.accounts.models import User
    orphan = User.objects.create_user(email="orphan@test.com", password="orphanpass123",
                                      full_name="Orphan", workspace=None, role="coach")
    res = APIClient().post("/api/auth/login/", {"email": "orphan@test.com", "password": "orphanpass123"}, format="json")
    assert res.status_code == 403
    assert "access_token" not in res.cookies
    orphan.refresh_from_db()
    assert orphan.workspace_id is None


@pytest.mark.django_db
def test_normal_login_still_works(world):
    world["owner_a"].set_password("ownerpass1234"); world["owner_a"].save()
    res = APIClient().post("/api/auth/login/", {"email": world["owner_a"].email, "password": "ownerpass1234"}, format="json")
    assert res.status_code == 200, _body(res)
    assert "access_token" in res.cookies
    assert res.data["workspace"]["id"] == str(world["ws_a"].id)


# ── 8. Guard: every writable FK on every ModelSerializer is workspace-scoped ─

def test_every_writable_relation_is_workspace_scoped():
    import importlib, inspect, pkgutil
    from rest_framework import serializers as s
    from apps.accounts.tenancy import WorkspaceScopedPrimaryKeyRelatedField
    import apps

    unscoped = []
    for m in pkgutil.iter_modules(apps.__path__):
        for sub in ("serializers", "views", "public_views"):
            try:
                mod = importlib.import_module(f"apps.{m.name}.{sub}")
            except ImportError:
                continue
            for name, cls in inspect.getmembers(mod, inspect.isclass):
                if cls.__module__ != mod.__name__ or not issubclass(cls, s.ModelSerializer):
                    continue
                for fname, f in cls().get_fields().items():
                    rel = f.child_relation if isinstance(f, s.ManyRelatedField) else f
                    if isinstance(rel, s.RelatedField) and not f.read_only \
                            and not isinstance(rel, WorkspaceScopedPrimaryKeyRelatedField):
                        unscoped.append(f"{cls.__module__}.{name}.{fname}")
    assert not unscoped, f"Writable relations not workspace-scoped: {unscoped}"
