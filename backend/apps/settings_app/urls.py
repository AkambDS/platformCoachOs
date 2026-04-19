from django.urls import path
from . import views

urlpatterns = [
    path("branding/",              views.BrandingSettingsView.as_view(),   name="settings-branding"),
    path("scheduling/",            views.SchedulingSettingsView.as_view(), name="settings-scheduling"),
    path("workspace/",             views.WorkspaceSettingsView.as_view(),  name="settings-workspace"),
    path("logo/",                  views.logo_upload,                      name="settings-logo"),
    path("logo/<uuid:workspace_id>/", views.serve_workspace_logo,          name="settings-logo-public"),
]
