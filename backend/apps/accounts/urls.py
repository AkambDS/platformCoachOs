from django.urls import path
from rest_framework_simplejwt.views import TokenBlacklistView
from . import views

urlpatterns = [
    path("login/",         views.LoginView.as_view(),       name="auth-login"),
    path("refresh/",       views.RefreshView.as_view(),     name="auth-refresh"),
    path("logout/",        TokenBlacklistView.as_view(),    name="auth-logout"),
    path("register/",      views.register,                  name="auth-register"),
    path("invite/",               views.invite_user,               name="auth-invite"),
    path("invite-email-preview/", views.invite_email_preview,      name="auth-invite-email-preview"),
    path("accept-invite/",        views.accept_invite,             name="auth-accept-invite"),
    path("me/",            views.MeView.as_view(),          name="auth-me"),
    path("team/",          views.TeamView.as_view(),        name="auth-team"),
    path("team/<uuid:pk>/",          views.team_member_detail,      name="auth-team-member"),
    path("password-reset/",          views.password_reset_request,  name="auth-password-reset"),
    path("password-reset/confirm/",  views.password_reset_confirm,  name="auth-password-reset-confirm"),
]
