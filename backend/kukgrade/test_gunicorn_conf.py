"""The container's gunicorn settings follow the deployment settings."""

from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from kukgrade import settings


@pytest.fixture(autouse=True)
def _forget_the_loaded_conf() -> Iterator[None]:
    """Each test builds the module afresh, and none leaves it behind."""
    sys.modules.pop("kukgrade.gunicorn_conf", None)
    yield
    sys.modules.pop("kukgrade.gunicorn_conf", None)


def load(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> ModuleType:
    for name, value in overrides.items():
        monkeypatch.setattr(settings, name, value)
    return importlib.import_module("kukgrade.gunicorn_conf")


def test_it_binds_every_interface_on_the_configured_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conf = load(monkeypatch, PORT=6942, SERVES_TLS=False)

    assert conf.bind == "0.0.0.0:6942"
    assert conf.workers == 1
    assert conf.worker_class == "gthread"
    assert not hasattr(conf, "certfile")


def test_it_serves_the_certificate_when_the_app_terminates_tls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "kukgrade.tls.certificate_files",
        lambda: ("/certs/site.crt", "/certs/site.key"),
    )

    conf = load(monkeypatch, SERVES_TLS=True)

    assert (conf.certfile, conf.keyfile) == ("/certs/site.crt", "/certs/site.key")


def test_plain_http_with_no_proxy_is_warned_about_at_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = MagicMock()
    conf = load(monkeypatch, SERVES_TLS=False, PLAIN_HTTP=True)

    conf.on_starting(server)

    assert "not encrypted" in server.log.warning.call_args.args[0]


def test_no_warning_when_plain_http_was_not_chosen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = MagicMock()
    conf = load(monkeypatch, SERVES_TLS=False, PLAIN_HTTP=False)

    conf.on_starting(server)

    server.log.warning.assert_not_called()
