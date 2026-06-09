from django.urls import path
from . import views

urlpatterns = [
    path("login/",                                   views.PortalLoginView.as_view(),          name="portal-login"),
    path("me/",                                      views.PortalMeView.as_view(),             name="portal-me"),
    path("goals/",                                   views.PortalGoalsView.as_view(),          name="portal-goals"),
    path("goals/<uuid:goal_id>/progress/",           views.PortalProgressView.as_view(),       name="portal-progress"),
    path("materials/",                               views.PortalMaterialsView.as_view(),      name="portal-materials"),
    path("invoices/",                                views.PortalInvoicesView.as_view(),       name="portal-invoices"),
    path("activities/",                              views.PortalActivitiesView.as_view(),     name="portal-activities"),
    path("activities/<uuid:activity_id>/respond/",   views.PortalActivityRespondView.as_view(),name="portal-activity-respond"),
    path("notes/",                                   views.PortalNotesView.as_view(),          name="portal-notes"),
    path("notes/<uuid:note_id>/",                    views.PortalNoteDetailView.as_view(),     name="portal-note-detail"),
]
