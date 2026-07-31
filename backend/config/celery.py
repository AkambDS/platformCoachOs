import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
app = Celery("coachos")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
app.conf.include = [
    'tasks.email',
    'tasks.reminders',
    'tasks.calendar',
    'tasks.sms',
    'tasks.invoicing',
    'tasks.pipeline',
]
