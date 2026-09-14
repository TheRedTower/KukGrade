from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from accounts.views import CurrentUserView, LoginView, LogoutView, UserViewSet

router = SimpleRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", CurrentUserView.as_view(), name="auth-me"),
    *router.urls,
]
