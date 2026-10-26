"""The image health check uses the configured public host for Django."""

from __future__ import annotations

import http.server
import ssl
import threading
import urllib.error
import urllib.request
from unittest.mock import patch

import pytest

from kukgrade.container_health import _host, _NoRedirects, main


def test_health_check_uses_first_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "kukgrade.container_health.settings.ALLOWED_HOSTS",
        ["www.kukgrade.co.uk", "localhost"],
    )
    monkeypatch.setattr("kukgrade.container_health.settings.SERVES_TLS", False)
    monkeypatch.setattr("kukgrade.container_health.settings.PORT", 6942)

    with patch("kukgrade.container_health.urllib.request.build_opener") as build:
        opener = build.return_value
        opener.open.return_value.__enter__.return_value.status = 200
        main()

    request = opener.open.call_args.args[0]
    assert request.get_header("Host") == "www.kukgrade.co.uk"
    assert request.get_header("X-forwarded-proto") == "https"
    assert opener.open.call_args.kwargs == {"timeout": 3}
    assert build.call_args.args == (_NoRedirects,)
    assert request.full_url == "http://127.0.0.1:6942/api/ready/"


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

    with patch("kukgrade.container_health.urllib.request.build_opener") as build:
        opener = build.return_value
        opener.open.return_value.__enter__.return_value.status = 200
        main()

    request = opener.open.call_args.args[0]
    assert request.full_url == "https://127.0.0.1:7777/api/ready/"
    redirects, https = build.call_args.args
    assert redirects is _NoRedirects
    assert https._context.verify_mode == ssl.CERT_NONE
    assert https._context.check_hostname is False


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
            opener.open(f"http://127.0.0.1:{server.server_port}/api/ready/", timeout=3)
        assert refused.value.code == 301
        assert followed == []
    finally:
        server.shutdown()
