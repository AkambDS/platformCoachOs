from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r"folders", views.FolderViewSet,       basename="library-folder")
router.register(r"items",   views.KnowledgeItemViewSet, basename="library-item")
urlpatterns = [path("", include(router.urls))]
