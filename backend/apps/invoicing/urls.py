from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r"", views.InvoiceViewSet, basename="invoice")
urlpatterns = [path("", include(router.urls))]
