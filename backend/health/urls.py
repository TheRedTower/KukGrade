from __future__ import annotations

from django.urls import path

from health.views import health_check, readiness_check

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("ready/", readiness_check, name="readiness-check"),
]
