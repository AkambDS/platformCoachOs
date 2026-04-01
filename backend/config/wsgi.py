import os
from django.core.wsgi import get_wsgi_application

# Default to production for deployed environments, local for development
default_settings = "config.settings.production" if os.environ.get("RENDER") else "config.settings.local"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", default_settings)

application = get_wsgi_application()
