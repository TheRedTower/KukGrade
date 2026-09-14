"""URL configuration for the KukGrade backend."""

from __future__ import annotations

from django.contrib import admin
from django.urls import include, path

# Django looks this up by name on the root URLconf.
handler500 = "kukgrade.exceptions.server_error"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("health.urls")),
    path("api/", include("ranks.urls")),
    path("api/", include("students.urls")),
    path("api/", include("syllabus.urls")),
    path("api/", include("gradings.urls")),
    path("api/", include("audit.urls")),
]
