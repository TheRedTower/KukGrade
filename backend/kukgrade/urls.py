"""URL configuration for the KukGrade backend."""

from __future__ import annotations

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("health.urls")),
    path("api/", include("ranks.urls")),
]
