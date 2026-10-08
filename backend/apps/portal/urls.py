from django.urls import path
from . import views

urlpatterns = [
    path("request-code/",                            views.PortalRequestCodeView.as_view(),    name="portal-request-code"),
    path("login/",                                   views.PortalLoginView.as_view(),          name="portal-login"),
    path("demo-login/",                              views.PortalDemoLoginView.as_view(),      name="portal-demo-login"),
    path("me/",                                      views.PortalMeView.as_view(),             name="portal-me"),
    path("goals/",                                   views.PortalGoalsView.as_view(),          name="portal-goals"),
    path("goals/<uuid:goal_id>/",                    views.PortalGoalDetailView.as_view(),     name="portal-goal-detail"),
    path("goals/<uuid:goal_id>/progress/",           views.PortalProgressView.as_view(),       name="portal-progress"),
    path("materials/",                               views.PortalMaterialsView.as_view(),      name="portal-materials"),
    path("materials/<uuid:material_id>/view-config/", views.PortalMaterialViewConfigView.as_view(), name="portal-material-view-config"),
    path("invoices/",                                views.PortalInvoicesView.as_view(),       name="portal-invoices"),
    path("activities/",                              views.PortalActivitiesView.as_view(),     name="portal-activities"),
    path("activities/<uuid:activity_id>/respond/",   views.PortalActivityRespondView.as_view(),name="portal-activity-respond"),
    path("notes/",                                   views.PortalNotesView.as_view(),          name="portal-notes"),
    path("notes/<uuid:note_id>/",                    views.PortalNoteDetailView.as_view(),     name="portal-note-detail"),
]
