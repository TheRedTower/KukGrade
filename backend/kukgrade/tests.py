"""Tests for the settings module's production and development branches.

The suite itself runs under `kukgrade.settings_test`, which forces development
values. These tests load `kukgrade/settings.py` in isolation under a chosen
environment so that the production branch is exercised directly.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import timedelta
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
        "DJANGO_NUM_PROXIES",
        "DJANGO_BEHIND_TLS_PROXY",
        "KUKGRADE_TRANSPORT",
        "KUKGRADE_TLS_CERT",
        "KUKGRADE_TLS_KEY",
        "KUKGRADE_TLS_DIR",
        "KUKGRADE_CLUB_NAME",
        "TZ",
        "KUKGRADE_TEMPORARY_PASSWORD_HOURS",
        "KUKGRADE_SCHOOL_PREFIX",
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
    # Preload is a deliberate opt-in: it is close to permanent for the domain.
    assert settings.SECURE_HSTS_PRELOAD is False
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
    # rate - is caught here rather than only by a scoped view becoming
    # silently unthrottled. accounts/tests.py proves throttling engages;
    # this proves the configured numbers it uses.
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] == [
        "rest_framework.throttling.ScopedRateThrottle",
    ]
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] == {
        "login": "10/min",
        "password_change": "10/min",
        "setup": "10/min",
    }


def test_login_view_opts_into_the_scoped_throttle() -> None:
    # The setting above only throttles a view that names this scope. Without
    # this, removing any view's scope would leave it unthrottled while every
    # assertion about the *rate* kept passing.
    from accounts.views import ChangePasswordView, LoginView, SetupView

    assert LoginView.throttle_scope == "login"
    assert ChangePasswordView.throttle_scope == "password_change"
    assert SetupView.throttle_scope == "setup"


def test_proxy_ssl_header_is_trusted_only_once_a_proxy_is_declared(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    declared = load_settings(monkeypatch, **PRODUCTION_ENV, DJANGO_NUM_PROXIES="1")
    direct = load_settings(monkeypatch, **PRODUCTION_ENV)

    assert declared.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
    assert not hasattr(direct, "SECURE_PROXY_SSL_HEADER")


def test_a_direct_production_app_listens_on_6942_and_serves_https_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV)

    assert settings.PORT == 6942
    assert settings.PROXY_HOPS == 0
    assert settings.TRANSPORT == "https"
    assert settings.SERVES_TLS is True
    assert settings.PLAIN_HTTP is False
    assert settings.SECURE_SSL_REDIRECT is True
    assert settings.SESSION_COOKIE_SECURE is True
    assert settings.SECURE_HSTS_SECONDS == 31536000


def test_plain_http_is_an_explicit_choice_for_a_direct_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV, KUKGRADE_TRANSPORT="http")

    assert settings.SERVES_TLS is False
    assert settings.PLAIN_HTTP is True
    assert settings.SECURE_SSL_REDIRECT is False
    assert settings.SECURE_HSTS_SECONDS == 0
    assert settings.SECURE_HSTS_INCLUDE_SUBDOMAINS is False
    assert settings.SESSION_COOKIE_SECURE is False
    assert settings.CSRF_COOKIE_SECURE is False


def test_the_transport_choice_means_nothing_behind_a_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        DJANGO_NUM_PROXIES="2",
        KUKGRADE_TRANSPORT="http",
    )

    # TLS ends at the proxies; the app speaks HTTP and trusts what they say.
    assert settings.SERVES_TLS is False
    assert settings.SECURE_SSL_REDIRECT is True
    assert settings.SESSION_COOKIE_SECURE is True
    assert settings.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")


def test_the_development_server_never_serves_tls_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, DJANGO_DEBUG="true")

    assert settings.SERVES_TLS is False


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("DJANGO_NUM_PROXIES", "-1", "0 or more"),
        ("KUKGRADE_TRANSPORT", "ftp", "must be one of https, http"),
        ("KUKGRADE_TLS_CERT", "/certs/site.crt", "must be set together"),
        ("KUKGRADE_TLS_KEY", "/certs/site.key", "must be set together"),
        ("DJANGO_BEHIND_TLS_PROXY", "true", "no longer exists"),
    ],
)
def test_a_mistaken_deployment_setting_is_refused_at_start(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
    message: str,
) -> None:
    with pytest.raises(ImproperlyConfigured) as exc_info:
        load_settings(monkeypatch, **PRODUCTION_ENV, **{name: value})

    assert message in str(exc_info.value)


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


def test_time_zone_defaults_to_london(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV)

    assert settings.TIME_ZONE == "Europe/London"
    assert settings.USE_TZ is True


def test_time_zone_is_declared_in_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV, TZ="America/New_York")

    assert settings.TIME_ZONE == "America/New_York"


def test_a_blank_time_zone_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = load_settings(monkeypatch, **PRODUCTION_ENV, TZ="  ")

    assert settings.TIME_ZONE == "Europe/London"


@pytest.mark.parametrize("bad", ["Mars/Olympus", "London", "../etc/passwd"])
def test_an_unknown_time_zone_stops_startup(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    with pytest.raises(ImproperlyConfigured, match="TZ must be an IANA"):
        load_settings(monkeypatch, **PRODUCTION_ENV, TZ=bad)


def test_temporary_passwords_last_a_day_unless_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    default = load_settings(monkeypatch, **PRODUCTION_ENV)
    configured = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        KUKGRADE_TEMPORARY_PASSWORD_HOURS="6",
    )

    assert default.TEMPORARY_PASSWORD_LIFETIME == timedelta(hours=24)
    assert configured.TEMPORARY_PASSWORD_LIFETIME == timedelta(hours=6)


def test_a_temporary_password_lifetime_under_an_hour_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ImproperlyConfigured):
        load_settings(
            monkeypatch,
            **PRODUCTION_ENV,
            KUKGRADE_TEMPORARY_PASSWORD_HOURS="0",
        )


def test_the_school_prefix_defaults_to_colchester_unless_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    default = load_settings(monkeypatch, **PRODUCTION_ENV)
    configured = load_settings(
        monkeypatch,
        **PRODUCTION_ENV,
        KUKGRADE_SCHOOL_PREFIX=" 301-4 ",
    )

    assert default.SCHOOL_ID_PREFIX == "206-2"
    assert configured.SCHOOL_ID_PREFIX == "301-4"


@pytest.mark.parametrize("prefix", ["206", "206-22", "2062", "A-2"])
def test_a_school_prefix_in_the_wrong_form_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch,
    prefix: str,
) -> None:
    with pytest.raises(ImproperlyConfigured):
        load_settings(monkeypatch, **PRODUCTION_ENV, KUKGRADE_SCHOOL_PREFIX=prefix)
