"""
Deploy regression tests — the failures that reached prod on 2026-11-10.

1. Package drift: a rebuild pulled celery/kombu 5.7, which need redis-py >= 6.4.
2. Broker: every .delay() then failed with kombu VersionMismatch, so the client portal
   login code (POST /api/portal/request-code/) returned 500.
3. Session end before start → DataError 500 (see test_activity_validation.py).

Run: pytest test_deploy_regression.py -v   (also run by ops/deploy.sh before building)
"""
import uuid
from unittest import mock

import pytest
from django.conf import settings


def test_installed_packages_match_lock():
    from apps.accounts.management.commands.deploy_check import LOCK_FILE, lock_drift
    assert LOCK_FILE.exists(), "backend/requirements.lock is missing"
    drift = lock_drift()
    assert not drift, (
        "Installed packages differ from requirements.lock — rebuild the image, or if the "
        f"upgrade is intended, test it and regenerate the lock: {drift[:10]}"
    )


def test_lock_is_consistent_with_requirements():
    """Every package named in requirements.txt is pinned in the lock."""
    from pathlib import Path
    base = Path(settings.BASE_DIR)
    lock = {l.split("==")[0].lower().replace("_", "-") for l in (base / "requirements.lock").read_text().splitlines()
            if "==" in l and not l.startswith("#")}
    missing = []
    for line in (base / "requirements.txt").read_text().splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        name = line.split("[")[0]
        for sep in ("==", ">=", "<=", "~=", "<", ">", "!="):
            name = name.split(sep)[0]
        if name.strip().lower().replace("_", "-") not in lock:
            missing.append(name.strip())
    assert not missing, f"In requirements.txt but not in requirements.lock — regenerate the lock: {missing}"


@pytest.mark.skipif(settings.CELERY_BROKER_URL.startswith("memory://"), reason="no real broker configured")
def test_celery_broker_channel_opens():
    """Opening a channel instantiates the redis client — exactly where the kombu
    VersionMismatch was raised. Publishes nothing."""
    from apps.accounts.management.commands.deploy_check import broker_check
    broker_check()


@pytest.mark.django_db
def test_portal_request_code_queues_email_and_returns_200():
    """The portal login-code request must succeed and hand the email to Celery."""
    from rest_framework.test import APIClient
    from apps.accounts.models import Workspace
    from apps.clients.models import Client
    ws = Workspace.objects.create(name="Reg WS", slug=f"reg-{uuid.uuid4().hex[:6]}")
    Client.objects.create(workspace=ws, first_name="Reg", last_name="T",
                          email="reg-portal@t.test", portal_access=True)
    with mock.patch("tasks.email.send_portal_login_code_email.delay") as delay:
        res = APIClient().post("/api/portal/request-code/", {"email": "reg-portal@t.test"}, format="json")
    assert res.status_code == 200, res.content
    delay.assert_called_once()
