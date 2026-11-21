"""URL configuration for the emergency admin site, and nothing else.

The network app (kukgrade.urls) does not serve the Django admin. An operator
with a shell on the host starts it by hand for the length of a repair, with
kukgrade.settings_admin, reachable only from that host's loopback; see
docs/installation.md.
"""

from __future__ import annotations

from django.contrib import admin
from django.urls import path

urlpatterns = [
    path("admin/", admin.site.urls),
]
