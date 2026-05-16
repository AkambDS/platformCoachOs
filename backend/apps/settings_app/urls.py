from django.urls import path
from . import views

urlpatterns = [
    path("branding/",              views.BrandingSettingsView.as_view(),   name="settings-branding"),
    path("scheduling/",            views.SchedulingSettingsView.as_view(), name="settings-scheduling"),
    path("workspace/",             views.WorkspaceSettingsView.as_view(),  name="settings-workspace"),
    path("logo/",                  views.logo_upload,                      name="settings-logo"),
    path("logo/<uuid:workspace_id>/", views.serve_workspace_logo,          name="settings-logo-public"),
    path("public-branding/",       views.public_branding,                  name="settings-public-branding"),
    path("pipeline-stages/",         views.pipeline_stage_configs,           name="settings-pipeline-stages"),
    path("pipeline-stages/<int:pk>/", views.pipeline_stage_config_detail,    name="settings-pipeline-stage-detail"),
    path("activity-types/",        views.activity_type_configs,            name="settings-activity-types"),
    path("activity-types/<int:pk>/", views.activity_type_config_detail,    name="settings-activity-type-detail"),
]
