"""How the container serves the app: `gunicorn -c python:kukgrade.gunicorn_conf`.

One threaded worker is intentional (docs/installation.md). The
port, and whether the app serves HTTPS itself, come from the settings, so the
image, the health check and the docs share one answer.
"""

from __future__ import annotations

from typing import Any

from kukgrade import settings

bind = f"0.0.0.0:{settings.PORT}"
workers = 1
worker_class = "gthread"
# The demo has many visitors at once, each request short; a thread waiting on
# the database costs little, and the database's 100 connections are ample.
threads = 16 if settings.DEMO_MODE else 4
# A writable place even when the root filesystem is read-only (compose.external-db.yml).
worker_tmp_dir = "/tmp"
control_socket_disable = True
# Only Django decides which proxies to trust (DJANGO_NUM_PROXIES); gunicorn
# must not act on forwarded headers of its own, even from a loopback proxy.
forwarded_allow_ips = ""
timeout = 30
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
access_log_format = "%(h)s %(m)s %(U)s %(s)s %(D)s"

if settings.SERVES_TLS:
    from kukgrade.tls import certificate_files

    certfile, keyfile = certificate_files()


def on_starting(server: Any) -> None:
    if settings.PLAIN_HTTP:
        server.log.warning(
            "Serving plain HTTP with no proxy in front (KUKGRADE_TRANSPORT=http): "
            "passwords and sessions are not encrypted. Only use this on a "
            "network you trust.",
        )
