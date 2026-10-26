"""Settings for the emergency admin site (kukgrade.urls_admin).

Used only by an operator with a shell on the host, who starts it by hand in a
throwaway container published to the host's loopback, or with runserver on the
host's loopback for a source install (docs/deployment.md, "The Django admin
site"). It serves the Django admin and nothing of the app, accepts only the
loopback host names, and carries no HTTPS settings because it is meant to be
used from the host only. The network app does not use this module.
"""

from __future__ import annotations

from kukgrade.settings import *  # noqa: F403
from kukgrade.settings import STORAGES

ROOT_URLCONF = "kukgrade.urls_admin"
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:9001", "http://localhost:9001"]

SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# The admin's own static files are not in the collected, public set (the
# image leaves them out), so they are served from the installed apps by
# runserver --insecure rather than from a manifest.
STORAGES = {
    **STORAGES,
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}
