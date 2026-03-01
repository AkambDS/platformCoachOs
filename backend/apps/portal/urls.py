from django.urls import path
from . import views

urlpatterns = [
    path("goals/",                              views.PortalGoalsView.as_view(),    name="portal-goals"),
    path("goals/<uuid:goal_id>/progress/",      views.PortalProgressView.as_view(), name="portal-progress"),
    path("materials/",                          views.PortalMaterialsView.as_view(),name="portal-materials"),
    path("invoices/",                           views.PortalInvoicesView.as_view(), name="portal-invoices"),
]
