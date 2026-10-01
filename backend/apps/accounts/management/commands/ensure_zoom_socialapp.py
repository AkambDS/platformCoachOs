"""
Management command: ensure_zoom_socialapp

Same pattern as ensure_google_socialapp — allauth's Zoom "Connect" flow (see
apps.accounts.views.zoom_connect) looks up its client id/secret from a SocialApp row
in the database, not from settings/env directly. This command creates (or updates, if
the env values changed) that SocialApp row from ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET. It's
a no-op when those aren't set to real values, so it's safe to run on every deploy.

Usage:
    python manage.py ensure_zoom_socialapp
"""
from django.conf import settings
from django.core.management.base import BaseCommand

_PLACEHOLDER_VALUES = {"", "REPLACE_ME", "...", "CHANGE_ME"}


class Command(BaseCommand):
    help = "Create/update the Zoom SocialApp row from ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET"

    def handle(self, *args, **options):
        client_id     = getattr(settings, "ZOOM_CLIENT_ID", "")
        client_secret = getattr(settings, "ZOOM_CLIENT_SECRET", "")

        if client_id in _PLACEHOLDER_VALUES or client_secret in _PLACEHOLDER_VALUES:
            self.stdout.write(
                "ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET not set to real values — skipping "
                "(Connect Zoom will keep failing until they're filled in)."
            )
            return

        from allauth.socialaccount.models import SocialApp
        from django.contrib.sites.models import Site

        site = Site.objects.get(pk=settings.SITE_ID)

        app, created = SocialApp.objects.update_or_create(
            provider="zoom",
            defaults={
                "name":         "Zoom",
                "client_id":    client_id,
                "secret":       client_secret,
            },
        )
        app.sites.add(site)

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} Zoom SocialApp (site: {site.domain})"))
