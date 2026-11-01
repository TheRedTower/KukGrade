"""The image health check uses the configured public host for Django."""

from __future__ import annotations

import http.server
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import pytest

from kukgrade import container_health
from kukgrade import settings as app_settings
from kukgrade.container_health import _database_reachable, _host, _NoRedirects, main


def test_health_check_uses_first_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "kukgrade.container_health.settings.ALLOWED_HOSTS",
        ["www.kukgrade.co.uk", "localhost"],
    )
    monkeypatch.setattr("kukgrade.container_health.settings.SERVES_TLS", False)
    monkeypatch.setattr("kukgrade.container_health.settings.PORT", 6942)

    with (
        patch("kukgrade.container_health.urllib.request.build_opener") as build,
        patch("kukgrade.container_health._database_reachable", return_value=True),
    ):
        opener = build.return_value
        opener.open.return_value.__enter__.return_value.status = 200
        main()

    request = opener.open.call_args.args[0]
    assert request.full_url == "http://127.0.0.1:6942/api/health/"
    assert request.get_header("Host") == "www.kukgrade.co.uk"
    assert request.get_header("X-forwarded-proto") == "https"
    assert opener.open.call_args.kwargs == {"timeout": 3}
    assert build.call_args.args == (_NoRedirects,)


@pytest.mark.parametrize(
    ("allowed", "host"),
    [
        (["localhost", "127.0.0.1"], "localhost"),
        ([".kukgrade.co.uk"], "kukgrade.co.uk"),
        (["*"], "localhost"),
        ([], "localhost"),
    ],
)
def test_the_host_header_is_always_one_the_app_accepts(
    monkeypatch: pytest.MonkeyPatch,
    allowed: list[str],
    host: str,
) -> None:
    monkeypatch.setattr("kukgrade.container_health.settings.ALLOWED_HOSTS", allowed)

    assert _host() == host


def test_a_direct_https_app_is_checked_over_https_without_verifying_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("kukgrade.container_health.settings.SERVES_TLS", True)
    monkeypatch.setattr("kukgrade.container_health.settings.PORT", 7777)

    with (
        patch("kukgrade.container_health.urllib.request.build_opener") as build,
        patch("kukgrade.container_health._database_reachable", return_value=True),
    ):
        opener = build.return_value
        opener.open.return_value.__enter__.return_value.status = 200
        main()

    request = opener.open.call_args.args[0]
    assert request.full_url == "https://127.0.0.1:7777/api/health/"
    redirects, https = build.call_args.args
    assert redirects is _NoRedirects
    assert https._context.verify_mode == ssl.CERT_NONE
    assert https._context.check_hostname is False


def test_the_database_check_runs_on_its_own_with_nothing_but_the_environment() -> None:
    """As the image runs it: a fresh process, no settings module chosen."""
    env = {
        key: value
        for key, value in os.environ.items()
        if key != "DJANGO_SETTINGS_MODULE"
    }
    env.setdefault("DJANGO_DEBUG", "true")

    ran = subprocess.run(
        [
            sys.executable,
            "-c",
            "from kukgrade.container_health import _database_reachable;"
            "print(_database_reachable())",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert ran.stdout.strip() == "True", ran.stderr


def test_the_database_check_does_not_start_django() -> None:
    """Loading every app is what made the probe slow on a busy host."""
    ran = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys;"
            "from kukgrade.container_health import _database_reachable;"
            "_database_reachable();"
            "print('django.apps' in sys.modules)",
        ],
        capture_output=True,
        text=True,
        check=False,
        env={k: v for k, v in os.environ.items() if k != "DJANGO_SETTINGS_MODULE"},
    )

    assert ran.stdout.strip() == "False", ran.stderr


def test_the_database_check_uses_the_settings_connection_and_a_short_deadline() -> None:
    with patch("kukgrade.container_health.psycopg.connect") as connect:
        assert _database_reachable() is True

    database = app_settings.DATABASES["default"]
    assert connect.call_args.kwargs == {
        "dbname": database["NAME"],
        "user": database["USER"],
        "password": database["PASSWORD"],
        "host": database["HOST"],
        "port": database["PORT"],
        "connect_timeout": container_health.DATABASE_TIMEOUT_SECONDS,
    }
    connection = connect.return_value.__enter__.return_value
    connection.execute.assert_called_once_with("SELECT 1")


def test_a_refused_connection_is_an_unreachable_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with socket.socket() as closed:
        closed.bind(("127.0.0.1", 0))
        port = closed.getsockname()[1]
    monkeypatch.setitem(app_settings.DATABASES["default"], "HOST", "127.0.0.1")
    monkeypatch.setitem(app_settings.DATABASES["default"], "PORT", str(port))

    assert _database_reachable() is False


def test_a_database_that_accepts_but_never_answers_fails_within_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    held: list[socket.socket] = []
    with socket.socket() as silent:
        silent.bind(("127.0.0.1", 0))
        silent.listen()
        monkeypatch.setitem(app_settings.DATABASES["default"], "HOST", "127.0.0.1")
        monkeypatch.setitem(
            app_settings.DATABASES["default"],
            "PORT",
            str(silent.getsockname()[1]),
        )
        monkeypatch.setattr(container_health, "DATABASE_TIMEOUT_SECONDS", 1)
        started = time.monotonic()
        try:
            reachable = _database_reachable()
        finally:
            for client in held:
                client.close()
        took = time.monotonic() - started

    assert reachable is False
    assert took < 4


def test_a_probe_that_is_stuck_stops_itself_with_a_failure() -> None:
    started = time.monotonic()
    ran = subprocess.run(
        [
            sys.executable,
            "-c",
            "import time;"
            "from kukgrade import container_health;"
            "container_health._arm_deadline(1);"
            "time.sleep(30)",
        ],
        capture_output=True,
        check=False,
        timeout=20,
    )

    assert ran.returncode == 1
    assert time.monotonic() - started < 10


def test_the_probe_stops_itself_before_docker_would() -> None:
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text()
    docker_timeout = int(re.search(r"--timeout=(\d+)s", dockerfile).group(1))  # type: ignore[union-attr]

    assert container_health.PROBE_DEADLINE_SECONDS < docker_timeout


def test_a_database_that_does_not_answer_fails_the_check() -> None:
    with (
        patch("kukgrade.container_health.urllib.request.build_opener") as build,
        patch("kukgrade.container_health._database_reachable", return_value=False),
    ):
        build.return_value.open.return_value.__enter__.return_value.status = 200
        with pytest.raises(SystemExit) as failed:
            main()

    assert failed.value.code == 1


def test_a_redirect_fails_the_check_instead_of_being_followed() -> None:
    followed: list[str] = []

    class Redirecting(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path == "/elsewhere":
                followed.append(self.path)
                self.send_response(200)
            else:
                self.send_response(301)
                self.send_header("Location", "/elsewhere")
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Redirecting)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        opener = urllib.request.build_opener(_NoRedirects)
        with pytest.raises(urllib.error.HTTPError) as refused:
            opener.open(f"http://127.0.0.1:{server.server_port}/api/health/", timeout=3)
        assert refused.value.code == 301
        assert followed == []
    finally:
        server.shutdown()
