"""CoachOS — external health/SSL monitoring for the production site.

Runs from inside our own infra (Celery Beat) rather than depending on the public site
being reachable to alert about itself — this is what catches the failure class behind
the 2026-09 outage: nginx, Django, and Celery were all perfectly healthy the whole time,
but the public HTTPS certificate had silently failed to renew for months with nothing
watching for it. The app's own error-alert system (capture_error/send_error_alert_email)
never saw it, since certbot runs as a host-level process entirely outside Django/Celery.
"""
import logging
import socket
import ssl
from datetime import datetime, timezone as dt_timezone

import requests
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.core.mail import EmailMessage

logger = logging.getLogger(__name__)

ALERT_TO      = "rassconsulting.co@gmail.com"
SITE_URL      = "https://coachos.rass-consulting.com/"
SITE_HOST     = "coachos.rass-consulting.com"
SSL_WARN_DAYS = 14  # matches certbot's own renew_before_expiry window


def _send_alert(subject: str, body: str):
    try:
        EmailMessage(
            subject=f"[CoachOS Health] {subject}",
            body=body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "CoachOS <noreply@coachos.app>"),
            to=[ALERT_TO],
        ).send()
    except Exception as e:
        logger.error(f"check_site_health: failed to send alert email: {e}")


def _check_reachable() -> tuple[bool, str]:
    try:
        resp = requests.get(SITE_URL, timeout=10)
        if resp.status_code >= 500:
            return False, f"Site returned HTTP {resp.status_code}"
        return True, ""
    except Exception as e:
        return False, str(e)


def _check_ssl_expiry() -> tuple[int, str]:
    """Returns (days_until_expiry, error_message). days is -1 if the check itself failed."""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((SITE_HOST, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=SITE_HOST) as ssock:
                cert = ssock.getpeercert()
        expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt_timezone.utc)
        days_left = (expires - datetime.now(dt_timezone.utc)).days
        return days_left, ""
    except Exception as e:
        return -1, str(e)


@shared_task(name="tasks.health.check_site_health")
def check_site_health():
    """Beat task — checks the public site is reachable and its SSL cert isn't close to
    expiring; alerts ALERT_TO on either problem.

    Downtime alerts fire on every failed check (rare + urgent, so the check interval
    itself is a fine alert cadence). SSL-expiring-soon alerts are de-duped to once per
    day via cache — otherwise a cert stuck in the 14-day warning window would trigger a
    fresh email every single run for two weeks straight.
    """
    reachable, reach_error = _check_reachable()
    if not reachable:
        _send_alert(
            "Site unreachable",
            f"{SITE_URL} is not reachable.\n\n"
            f"Error: {reach_error}\n\n"
            f"Checked at {datetime.now(dt_timezone.utc).isoformat()}",
        )
        logger.error(f"check_site_health: site unreachable — {reach_error}")
        return

    days_left, ssl_error = _check_ssl_expiry()
    if ssl_error:
        _send_alert(
            "Could not check SSL certificate",
            f"Site is reachable but the SSL certificate check itself failed for {SITE_HOST}.\n\n"
            f"Error: {ssl_error}",
        )
        logger.error(f"check_site_health: SSL check failed — {ssl_error}")
        return

    if days_left <= SSL_WARN_DAYS:
        dedupe_key = f"health_ssl_alert_sent:{datetime.now(dt_timezone.utc).date().isoformat()}"
        if not cache.get(dedupe_key):
            _send_alert(
                "SSL certificate expiring soon",
                f"The SSL certificate for {SITE_HOST} expires in {days_left} day(s).\n\n"
                f"This is the exact failure class behind the 2026-09 outage — certbot's "
                f"auto-renewal may be failing silently again. SSH in and check "
                f"/var/log/letsencrypt/letsencrypt.log, or run the renewal manually:\n\n"
                f"  sudo certbot renew --dry-run",
            )
            cache.set(dedupe_key, True, timeout=60 * 60 * 25)  # just over a day
        logger.warning(f"check_site_health: SSL cert expires in {days_left} days")
