"""Who a request is from behind Cloudflare and Traefik, and how long a
session lasts without activity."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import User


def test_two_trusted_proxies_resolve_the_visitor_behind_cloudflare_and_traefik(
    settings: Any,
) -> None:
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 2}
    # Cloudflare sets the visitor's address; Traefik appends Cloudflare's.
    request = Request(
        APIRequestFactory().get(
            "/",
            HTTP_X_FORWARDED_FOR="203.0.113.7, 198.51.100.1",
            REMOTE_ADDR="172.18.0.2",
        ),
    )

    assert ScopedRateThrottle().get_ident(request) == "203.0.113.7"


@pytest.mark.django_db
def test_a_session_lasts_two_hours_from_the_last_request() -> None:
    client = Client()
    client.force_login(User.objects.create_user(email="idle@example.com"))

    first = client.get("/api/auth/me/")
    second = client.get("/api/auth/me/")

    # Every request re-issues the cookie with a fresh two hours.
    assert first.cookies["sessionid"]["max-age"] == 2 * 60 * 60
    assert second.cookies["sessionid"]["max-age"] == 2 * 60 * 60
