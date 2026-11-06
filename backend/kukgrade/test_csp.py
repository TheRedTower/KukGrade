"""The Content-Security-Policy header: what it allows, when it is sent, and that the
one inline script in the built page is allowed by its hash and nothing else is."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import pytest
from django.http import HttpResponseBase
from django.test import Client, override_settings

from kukgrade.csp import HEADER, REPORT_ONLY_HEADER, inline_script_sources, policy

THEME_SCRIPT = (
    "(function(){document.documentElement.setAttribute('data-theme','dark')})();"
)
PAGE = (
    "<!doctype html><html><head><script>"
    + THEME_SCRIPT
    + '</script></head><body><div id="root"></div>'
    '<script type="module" src="/assets/index.js"></script></body></html>'
)


def hash_of(script: str) -> str:
    digest = hashlib.sha256(script.encode("utf-8")).digest()
    return f"'sha256-{base64.b64encode(digest).decode('ascii')}'"


def get_page(
    tmp_path: Path,
    html: str = PAGE,
    path: str = "/",
    **settings: str,
) -> HttpResponseBase:
    (tmp_path / "index.html").write_text(html, encoding="utf-8")
    with override_settings(FRONTEND_DIST=tmp_path, **settings):
        return Client().get(path)


def test_a_page_carries_the_policy_with_the_hash_of_its_inline_script(
    tmp_path: Path,
) -> None:
    response = get_page(tmp_path)

    header = response[HEADER]
    assert f"script-src 'self' {hash_of(THEME_SCRIPT)}" in header.split("; ")
    assert REPORT_ONLY_HEADER not in response


def test_the_policy_allows_nothing_it_does_not_need() -> None:
    directives = policy(("'sha256-abc='",)).split("; ")

    assert "default-src 'self'" in directives
    assert "object-src 'none'" in directives
    assert "base-uri 'self'" in directives
    assert "form-action 'self'" in directives
    assert "frame-ancestors 'none'" in directives
    assert "connect-src 'self'" in directives
    assert "style-src 'self'" in directives
    assert "unsafe" not in policy().lower()
    assert "*" not in policy()
    assert "http:" not in policy() and "https:" not in policy()


def test_a_script_loaded_from_a_file_needs_no_hash_and_gets_none() -> None:
    html = (
        '<script type="module" src="/assets/index.js"></script>'
        '<script src="/x.js">  </script>'
    )

    assert inline_script_sources(html) == ()


def test_every_inline_script_is_hashed_and_an_empty_one_is_not() -> None:
    first, second = "var a = 1;", "var b = 2;"
    html = (
        f"<script>{first}</script>"
        f"<script type='text/javascript'>{second}</script>"
        "<script> </script>"
    )

    assert inline_script_sources(html) == (hash_of(first), hash_of(second))


def test_a_changed_inline_script_is_allowed_without_touching_the_policy(
    tmp_path: Path,
) -> None:
    changed = PAGE.replace("'dark'", "'light'")

    response = get_page(tmp_path, changed)

    assert hash_of(THEME_SCRIPT) not in response[HEADER]
    assert hash_of(THEME_SCRIPT.replace("'dark'", "'light'")) in response[HEADER]


def test_an_api_answer_is_not_a_page_and_carries_no_policy() -> None:
    response = Client().get("/api/site/")

    assert response.status_code == 200
    assert HEADER not in response
    assert REPORT_ONLY_HEADER not in response


def test_report_only_mode_reports_and_does_not_enforce(tmp_path: Path) -> None:
    response = get_page(tmp_path, CSP_MODE="report-only")

    assert REPORT_ONLY_HEADER in response
    assert HEADER not in response
    assert hash_of(THEME_SCRIPT) in response[REPORT_ONLY_HEADER]


def test_off_sends_no_policy_at_all(tmp_path: Path) -> None:
    response = get_page(tmp_path, CSP_MODE="off")

    assert HEADER not in response
    assert REPORT_ONLY_HEADER not in response


def test_a_missing_build_still_answers_without_failing(tmp_path: Path) -> None:
    with override_settings(FRONTEND_DIST=tmp_path):
        response = Client().get("/")

    assert response.status_code == 404


@pytest.mark.parametrize("path", ["/", "/students/42", "/gradings/7/decisions"])
def test_every_route_of_the_app_is_covered(tmp_path: Path, path: str) -> None:
    response = get_page(tmp_path, path=path)

    assert response.status_code == 200
    assert "script-src 'self'" in response[HEADER]


def test_the_existing_frame_protection_is_still_sent(tmp_path: Path) -> None:
    response = get_page(tmp_path)

    assert response["X-Frame-Options"] == "DENY"
