"""Read-only runtime health check, run after every deploy (ops/postdeploy_health.sh).

    python manage.py deploy_check            # all checks
    python manage.py deploy_check --no-worker  # skip the live Celery worker ping

Checks the things a clean build can still get wrong at runtime:
  1. Database reachable.
  2. Installed Python packages == requirements.lock (no silent version drift).
  3. Celery broker (Redis) usable from this image — opens a real channel, which is where
     2026-11-10's kombu/redis VersionMismatch broke every .delay().
  4. A Celery worker answers a ping (the background jobs are actually running).
  5. Tenant integrity (same as check_tenant_integrity).
Sends nothing and writes nothing. Exit code 0 = healthy, 1 = a check failed.
"""
import sys
from importlib import metadata
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection

LOCK_FILE = Path(settings.BASE_DIR) / "requirements.lock"
_SKIP = {"pip", "setuptools", "wheel"}


def _norm(name):
    return name.lower().replace("_", "-").replace(".", "-")


def lock_drift(lock_file=LOCK_FILE):
    """[(package, locked, installed)] for every locked package whose installed version
    differs (installed=None if missing). Empty list = no drift."""
    locked = {}
    for line in lock_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "==" in line:
            name, ver = line.split("==", 1)
            if _norm(name) not in _SKIP:
                locked[_norm(name)] = ver.strip()
    installed = {_norm(d.metadata["Name"]): d.version for d in metadata.distributions()}
    return sorted((n, v, installed.get(n)) for n, v in locked.items() if installed.get(n) != v)


def broker_check():
    """Open a real broker connection + channel (raises on e.g. kombu VersionMismatch)."""
    from config.celery import app
    with app.connection_for_write() as conn:
        conn.ensure_connection(max_retries=1, timeout=5)
        conn.default_channel  # creating the channel is what instantiates the redis client
    return app.conf.broker_url.split("@")[-1]  # host part only, never the password


class Command(BaseCommand):
    help = "Read-only post-deploy health check (exit 1 if anything is unhealthy)."

    def add_arguments(self, parser):
        parser.add_argument("--no-worker", action="store_true", help="Skip the Celery worker ping.")

    def handle(self, no_worker=False, **opts):
        failed = []

        def ok(msg):
            self.stdout.write(self.style.SUCCESS(f"  ✅ {msg}"))

        def bad(name, msg):
            failed.append(name)
            self.stdout.write(self.style.ERROR(f"  ❌ {msg}"))

        self.stdout.write("1. Database")
        try:
            with connection.cursor() as c:
                c.execute("SELECT 1")
            ok(f"connected ({connection.settings_dict.get('HOST') or 'local'})")
        except Exception as e:
            bad("database", f"{type(e).__name__}: {e}")

        self.stdout.write("2. Package versions vs requirements.lock")
        if not LOCK_FILE.exists():
            bad("lock", f"{LOCK_FILE.name} missing from the image")
        else:
            drift = lock_drift()
            if drift:
                for name, want, have in drift[:20]:
                    self.stdout.write(self.style.ERROR(f"     {name}: locked {want}, installed {have or 'MISSING'}"))
                bad("lock", f"{len(drift)} package(s) differ from requirements.lock")
            else:
                ok("every installed package matches the lock")

        self.stdout.write("3. Celery broker")
        try:
            ok(f"broker channel opened ({broker_check()})")
        except Exception as e:
            bad("broker", f"{type(e).__name__}: {e}")

        self.stdout.write("4. Celery worker")
        if no_worker:
            self.stdout.write("  – skipped (--no-worker)")
        else:
            try:
                from config.celery import app
                import time
                replies = []
                for _ in range(6):  # a freshly restarted worker needs a few seconds
                    replies = app.control.ping(timeout=5) or []
                    if replies:
                        break
                    time.sleep(5)
                if replies:
                    ok(f"{len(replies)} worker(s) answered: {', '.join(k for r in replies for k in r)}")
                else:
                    bad("worker", "no Celery worker answered the ping (is the celery container up?)")
            except Exception as e:
                bad("worker", f"{type(e).__name__}: {e}")

        self.stdout.write("5. Tenant integrity")
        out = StringIO()
        try:
            call_command("check_tenant_integrity", stdout=out)
            ok("CLEAN — tenant isolation intact")
        except SystemExit:
            self.stdout.write(out.getvalue())
            bad("tenancy", "check_tenant_integrity found problems (output above)")

        if failed:
            self.stdout.write(self.style.ERROR(f"UNHEALTHY: {', '.join(failed)}"))
            sys.exit(1)
        self.stdout.write(self.style.SUCCESS("HEALTHY — all deploy checks passed"))
