"""
pytest-django conftest — factories and shared fixtures for all tests.
"""
import threading

import pytest
from django.utils import timezone
from datetime import timedelta
import uuid


def pytest_configure(config):
    # Throttle counters must not live in the dev Redis: shared with the running app and
    # with earlier test runs, they made login/rate-limited tests fail with random 429s.
    # (Not cache.clear() on Redis — that would also wipe the dev Celery queue.)
    from django.conf import settings
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@pytest.fixture(autouse=True)
def _isolate_side_effects(monkeypatch):
    """Keep async side effects inside the test that caused them.

    * Celery `.delay()` runs inline (eager) instead of going to the dev worker, which
      reads the dev DB — so emails land in `mail.outbox` and tasks see the test's rows.
    * Background threads started by app code (activities' `_fire`, portal/contract
      notices) run synchronously: a real thread opens its own DB connection outside the
      test transaction, can't see the test's rows, and its ErrorLog writes leak into
      later tests.
    * Fresh cache per test, so throttle counts don't carry over between tests.
    """
    from django.core.cache import cache
    from config.celery import app as celery_app

    cache.clear()
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", False)

    real_start = threading.Thread.start

    def start(self):
        target = getattr(self, "_target", None)
        if (getattr(target, "__module__", "") or "").startswith(("tasks.", "apps.")):
            self.run()
        else:
            real_start(self)

    monkeypatch.setattr(threading.Thread, "start", start)

@pytest.fixture
def workspace(db):
    from apps.accounts.models import Workspace
    return Workspace.objects.create(
        name="Test Coaching Co",
        slug=f"test-{uuid.uuid4().hex[:6]}",
    )

@pytest.fixture
def business_owner(db, workspace):
    from apps.accounts.models import User
    return User.objects.create_user(
        email="owner@test.com",
        password="testpassword123",
        full_name="Test Owner",
        workspace=workspace,
        role="business_owner",
    )

@pytest.fixture
def coach(db, workspace):
    from apps.accounts.models import User
    return User.objects.create_user(
        email="coach@test.com",
        password="testpassword123",
        full_name="Test Coach",
        workspace=workspace,
        role="coach",
    )

@pytest.fixture
def client_record(db, workspace, coach):
    from apps.clients.models import Client
    return Client.objects.create(
        workspace=workspace,
        coach=coach,
        first_name="Sarah",
        last_name="Chen",
        email="sarah@example.com",
    )

@pytest.fixture
def api_client(db, business_owner):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    client = APIClient()
    refresh = RefreshToken.for_user(business_owner)
    refresh["workspace_id"] = str(business_owner.workspace_id)
    refresh["role"]         = business_owner.role
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return client


@pytest.fixture
def portal_api_client(db):
    """Factory: portal_api_client(client_record, workspace) -> APIClient authenticated
    as that client via a portal_client-scoped JWT (mirrors PortalLoginView's token)."""
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import AccessToken

    def _make(client_record, workspace):
        token = AccessToken()
        token["client_id"]    = str(client_record.id)
        token["workspace_id"] = str(workspace.id)
        token["role"]         = "portal_client"
        token["email"]        = client_record.email
        api = APIClient()
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {str(token)}")
        return api

    return _make
