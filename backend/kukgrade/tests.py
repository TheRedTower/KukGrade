"""Tests for the settings module's production and development branches.

The suite itself runs under `kukgrade.settings_test`, which forces development
values. These tests load `kukgrade/settings.py` in isolation under a chosen
environment so that the production branch is exercised directly.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest
from django.core.exceptions import ImproperlyConfigured

SETTINGS_PATH = Path(__file__).resolve().parent / "settings.py"

PRODUCTION_ENV = {
    "DJANGO_DEBUG": "false",
    "DJANGO_SECRET_KEY": "a" * 60,
    "DJANGO_ALLOWED_HOSTS": "kukgrade.example.com",
}


def load_settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> ModuleType:
    """Import settings.py fresh under an exact environment."""
    for name in list(sys.modules):
        if name.startswith("_isolated_settings"):
            del sys.modules[name]
    for key in [k for k in dict(**env)] + [
        "DJANGO_DEBUG",
        "DJANGO_SECRET_KEY",
        "DJANGO_ALLOWED_HOSTS",
        "DJANGO_SECURE_SSL_REDIRECT",
        "DJANGO_SECURE_HSTS_SECONDS",
        "DJANGO_BEHIND_TLS_PROXY",
        "DJANGO_NUM_PROXIES",
        "KUKGRADE_CLUB_NAME",
    ]:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    spec = importlib.util.spec_from_file_location(
        "_isolated_settings",
        SETTINGS_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["_isolated_settings"] = module
    spec.loader.exec_module(module)
    return module


def test_missing_secret_key_refuses_to_start_when_debug_is_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ImproperlyConfigured) as exc_info:
        load_settings(monkeypatch, DJANGO_DEBUG="false")

    assert "DJANGO_SECRET_KEY must be set" in str(exc_info.value)


def test_blank_secret_key_is_treated_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ImproperlyConfigured):
        load_settings(monkeypatch, DJANGO_DEBUG="false", DJANGO_SECRET_KEY="   ")


def test_debug_defaults_to_false_so_an_empty_environment_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No DJANGO_DEBUG at all: the deployment must not quietly enable debug.
    with pytest.raises(ImproperlyConfigured):
        load_settings(monkeypatch)


def test_production_settings_are_hardened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV)

    assert settings.DEBUG is False
    assert settings.SECRET_KEY == "a" * 60
    assert settings.SECURE_SSL_REDIRECT is True
    assert settings.SECURE_HSTS_SECONDS == 31536000
    assert settings.SECURE_HSTS_INCLUDE_SUBDOMAINS is True
    assert settings.SECURE_HSTS_PRELOAD is True
    # Unlike every other transport setting above, this one is not implied by
    # DEBUG=false: trusting a proxy header is only safe when the deployment
    # guarantees the proxy strips it, which is not something this code can
    # know on its own - it has to be opted into explicitly (see below).
    assert not hasattr(settings, "SECURE_PROXY_SSL_HEADER")
    assert settings.SESSION_COOKIE_SECURE is True
    assert settings.CSRF_COOKIE_SECURE is True
    assert settings.STATIC_URL == "/static/"
    assert settings.STORAGES["staticfiles"]["BACKEND"] == (
        "whitenoise.storage.CompressedManifestStaticFilesStorage"
    )
    assert settings.MIDDLEWARE[1] == "whitenoise.middleware.WhiteNoiseMiddleware"
    assert settings.REST_FRAMEWORK["NUM_PROXIES"] == 0
    # Pinned so that deleting either half of the throttle - the class or the
    # rate - is caught here rather than only by the fact that login becomes
    # silently unthrottled. accounts/tests.py proves the throttle actually
    # engages; this proves the number it engages at.
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] == [
        "rest_framework.throttling.ScopedRateThrottle",
    ]
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] == {
        "login": "10/min",
        "password_change": "10/min",
    }


def test_login_view_opts_into_the_scoped_throttle() -> None:
    # The setting above only throttles a view that names this scope. Without
    # this, renaming or removing LoginView.throttle_scope would leave login
    # unthrottled while every assertion about the *rate* kept passing.
    from accounts.views import ChangePasswordView, LoginView

    assert LoginView.throttle_scope == "login"
    assert ChangePasswordView.throttle_scope == "password_change"


def test_proxy_ssl_header_requires_explicit_opt_in_even_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        DJANGO_BEHIND_TLS_PROXY="true",
    )

    assert settings.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")


def test_the_trusted_proxy_count_is_configurable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV, DJANGO_NUM_PROXIES="2")

    assert settings.REST_FRAMEWORK["NUM_PROXIES"] == 2


def test_browsable_api_is_not_exposed_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV)
    renderers = settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"]

    assert renderers == ["rest_framework.renderers.JSONRenderer"]
    assert not any("Browsable" in renderer for renderer in renderers)


def test_development_keeps_the_browsable_api_and_relaxed_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, DJANGO_DEBUG="true")

    assert settings.DEBUG is True
    assert settings.SECRET_KEY  # falls back so local development just works
    assert settings.SECURE_SSL_REDIRECT is False
    assert settings.SECURE_HSTS_SECONDS == 0
    assert settings.SESSION_COOKIE_SECURE is False
    assert "whitenoise.middleware.WhiteNoiseMiddleware" not in settings.MIDDLEWARE
    assert any(
        "Browsable" in renderer
        for renderer in settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"]
    )


def test_transport_security_can_be_overridden_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        DJANGO_SECURE_SSL_REDIRECT="false",
        DJANGO_SECURE_HSTS_SECONDS="600",
        DJANGO_BEHIND_TLS_PROXY="false",
    )

    assert settings.SECURE_SSL_REDIRECT is False
    assert settings.SECURE_HSTS_SECONDS == 600
    assert not hasattr(settings, "SECURE_PROXY_SSL_HEADER")


def test_non_integer_environment_value_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ImproperlyConfigured) as exc_info:
        load_settings(
            monkeypatch,
            **PRODUCTION_ENV,
            DJANGO_SECURE_HSTS_SECONDS="not-a-number",
        )

    assert "must be an integer" in str(exc_info.value)


def test_test_settings_module_forces_development_values() -> None:
    from django.conf import settings as active

    # Django forces DEBUG False during tests, so assert on a derived value
    # that was computed at import time instead.
    assert active.SESSION_COOKIE_SECURE is False
    assert active.SECURE_SSL_REDIRECT is False


def test_club_name_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    configured = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        KUKGRADE_CLUB_NAME="  Kuk Sool Won Colchester ",
    )
    unset = load_settings(monkeypatch, **PRODUCTION_ENV)

    assert configured.CLUB_NAME == "Kuk Sool Won Colchester"
    assert unset.CLUB_NAME == "Kuk Sool Won"
