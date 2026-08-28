"""
Management command: ensure_google_socialapp

allauth's Google "Connect" flow (see accounts.views.google_calendar_connect) looks up
its client id/secret from a SocialApp row in the database, not from settings/env directly.
Nothing else in the codebase creates that row, so GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in
.env had no effect and "Connect Google Calendar" 500'd on every click.

This command creates (or updates, if the env values changed) that SocialApp row and
attaches it to the current Site, from GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. It's a no-op
when those aren't set to real values, so it's safe to run on every deploy.

Usage:
    python manage.py ensure_google_socialapp
"""
from django.conf import settings
from django.core.management.base import BaseCommand

_PLACEHOLDER_VALUES = {"", "REPLACE_ME", "...", "CHANGE_ME"}


class Command(BaseCommand):
    help = "Create/update the Google SocialApp row from GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET"

    def handle(self, *args, **options):
        client_id     = getattr(settings, "GOOGLE_CLIENT_ID", "")
        client_secret = getattr(settings, "GOOGLE_CLIENT_SECRET", "")

        if client_id in _PLACEHOLDER_VALUES or client_secret in _PLACEHOLDER_VALUES:
            self.stdout.write(
                "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set to real values — skipping "
                "(Connect Google Calendar will keep 500ing until they're filled in)."
            )
            return

        from allauth.socialaccount.models import SocialApp
        from django.contrib.sites.models import Site

        site = Site.objects.get(pk=settings.SITE_ID)

        app, created = SocialApp.objects.update_or_create(
            provider="google",
            defaults={
                "name":         "Google",
                "client_id":    client_id,
                "secret":       client_secret,
            },
        )
        app.sites.add(site)

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} Google SocialApp (site: {site.domain})"))
