"""URL configuration for the KukGrade backend."""

from __future__ import annotations

from django.contrib import admin
from django.urls import include, path, re_path

from kukgrade.views import about, frontend, site_settings

# Django looks these up by name on the root URLconf.
handler404 = "kukgrade.exceptions.not_found"
handler500 = "kukgrade.exceptions.server_error"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/site/", site_settings, name="site-settings"),
    path("api/about/", about, name="about"),
    path("api/", include("accounts.urls")),
    path("api/", include("health.urls")),
    path("api/", include("ranks.urls")),
    path("api/", include("students.urls")),
    path("api/", include("syllabus.urls")),
    path("api/", include("gradings.urls")),
    path("api/", include("audit.urls")),
    path("api/", include("data_imports.urls")),
    re_path(
        r"^(?!(?:api|admin|static)(?:/|$))(?P<path>.*)$",
        frontend,
        name="frontend",
    ),
]
