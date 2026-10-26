"""The Django admin is not served by the network app: its sign-in page and
pages do not exist there, so the app's own sign-in is the only public one. It
is served only by the emergency URL configuration, from a shell."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from accounts.models import User
from kukgrade.testing import render_admin_pages

pytestmark = pytest.mark.django_db

CLOSED_PATHS = [
    "/admin/",
    "/admin/login/",
    "/admin/accounts/user/",
    "/admin/password_change/",
    "/admin/jsi18n/",
]


@pytest.mark.parametrize("path", CLOSED_PATHS)
def test_the_network_app_has_no_admin_pages(path: str) -> None:
    client = Client()

    response = client.get(path, HTTP_HOST="localhost")

    assert response.status_code == 404
    assert 'type="password"' not in response.content.decode()


def test_the_admin_sign_in_cannot_be_posted_to() -> None:
    User.objects.create_superuser(
        email="closed@example.com", password="Owner-Chosen-Pass-9!"
    )
    client = Client()

    response = client.post(
        "/admin/login/",
        {"username": "closed@example.com", "password": "Owner-Chosen-Pass-9!"},
        HTTP_HOST="localhost",
    )

    assert response.status_code == 404
    assert "_auth_user_id" not in client.session


def test_the_emergency_admin_still_serves_the_admin(settings: Any) -> None:
    render_admin_pages(settings)
    client = Client()

    shown = client.get("/admin/login/", HTTP_HOST="localhost")

    assert shown.status_code == 200
    assert 'type="password"' in shown.content.decode()


def test_the_emergency_settings_serve_only_the_admin_on_loopback() -> None:
    from kukgrade import settings_admin

    assert settings_admin.ROOT_URLCONF == "kukgrade.urls_admin"
    assert settings_admin.ALLOWED_HOSTS == ["127.0.0.1", "localhost"]
    assert settings_admin.SECURE_SSL_REDIRECT is False
