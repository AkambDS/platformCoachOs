from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r"", views.InvoiceViewSet, basename="invoice")
urlpatterns = [
    path("service-catalog/",        views.service_catalog),
    path("service-catalog/<uuid:pk>/", views.service_catalog_detail),
    path("", include(router.urls)),
]
