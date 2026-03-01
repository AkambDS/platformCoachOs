from django.urls import path
from . import views

urlpatterns = [
    path("branding/",    views.BrandingSettingsView.as_view(),   name="settings-branding"),
    path("scheduling/",  views.SchedulingSettingsView.as_view(), name="settings-scheduling"),
]
