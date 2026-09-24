"""The image health check uses the configured public host for Django."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from kukgrade.container_health import main


def test_health_check_uses_first_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "www.kukgrade.co.uk,localhost")

    with patch("kukgrade.container_health.urllib.request.urlopen") as urlopen:
        urlopen.return_value.__enter__.return_value.status = 200
        main()

    request = urlopen.call_args.args[0]
    assert request.get_header("Host") == "www.kukgrade.co.uk"
    assert request.get_header("X-forwarded-proto") == "https"
    assert urlopen.call_args.kwargs == {"timeout": 3}
