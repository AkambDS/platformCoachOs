from django.urls import path, include
from django.views.decorators.csrf import csrf_exempt
from rest_framework.routers import DefaultRouter
from . import views
from .public_views import StripeWebhookView

router = DefaultRouter()
router.register(r"", views.InvoiceViewSet, basename="invoice")
urlpatterns = [
    path("service-catalog/",        views.service_catalog),
    path("service-catalog/<uuid:pk>/", views.service_catalog_detail),
    # Must come before the router include below — "stripe-webhook" would otherwise be
    # swallowed by the router's <pk> detail-route lookup pattern.
    path("stripe-webhook/<uuid:workspace_id>/", csrf_exempt(StripeWebhookView.as_view())),
    path("", include(router.urls)),
]
