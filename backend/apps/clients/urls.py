from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r"", views.ClientViewSet, basename="client")

goal_router = DefaultRouter()
goal_router.register(r"", views.ClientGoalViewSet, basename="client-goal")

assessment_router = DefaultRouter()
assessment_router.register(r"", views.AssessmentViewSet, basename="assessment")

note_router = DefaultRouter()
note_router.register(r"", views.ClientNoteViewSet, basename="client-note")

message_router = DefaultRouter()
message_router.register(r"", views.ClientMessageDraftViewSet, basename="client-message-draft")

urlpatterns = [
    path("email-log/",             views.email_log_sent),
    path("email-log/scheduled/",   views.email_log_scheduled),
    path("email-log/<uuid:pk>/",   views.email_log_detail),
    path("", include(router.urls)),
    path("<uuid:client_pk>/goals/",       include(goal_router.urls)),
    path("<uuid:client_pk>/assessments/", include(assessment_router.urls)),
    path("<uuid:client_pk>/notes/",       include(note_router.urls)),
    path("<uuid:client_pk>/messages/",    include(message_router.urls)),
]
