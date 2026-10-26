"""The image health check uses the configured public host for Django."""

from __future__ import annotations

import http.server
import threading
import urllib.error
import urllib.request
from unittest.mock import patch

import pytest

from kukgrade.container_health import _NoRedirects, main


def test_health_check_uses_first_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "www.kukgrade.co.uk,localhost")

    with (
        patch("kukgrade.container_health.urllib.request.build_opener") as build,
        patch("kukgrade.container_health._database_reachable", return_value=True),
    ):
        opener = build.return_value
        opener.open.return_value.__enter__.return_value.status = 200
        main()

    request = opener.open.call_args.args[0]
    assert request.full_url == "http://127.0.0.1:8000/api/health/"
    assert request.get_header("Host") == "www.kukgrade.co.uk"
    assert request.get_header("X-forwarded-proto") == "https"
    assert opener.open.call_args.kwargs == {"timeout": 3}
    assert build.call_args.args == (_NoRedirects,)


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
