from django.urls import path
from . import views

urlpatterns = [
    path("", views.workspace_audit_log),
]
