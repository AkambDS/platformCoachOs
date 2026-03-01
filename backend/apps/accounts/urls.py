from django.urls import path
from rest_framework_simplejwt.views import TokenBlacklistView
from . import views

urlpatterns = [
    path("login/",         views.LoginView.as_view(),       name="auth-login"),
    path("refresh/",       views.RefreshView.as_view(),     name="auth-refresh"),
    path("logout/",        TokenBlacklistView.as_view(),    name="auth-logout"),
    path("register/",      views.register,                  name="auth-register"),
    path("invite/",        views.invite_user,               name="auth-invite"),
    path("accept-invite/", views.accept_invite,             name="auth-accept-invite"),
    path("me/",            views.MeView.as_view(),          name="auth-me"),
    path("team/",          views.TeamView.as_view(),        name="auth-team"),
]
