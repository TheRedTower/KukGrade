"""Helpers the demo's tests share."""

from __future__ import annotations

from rest_framework.test import APIClient

from demo.personas import DEMO_PASSWORD
from demo.reset import club_models
from gradings.models import GradingSession


def club_tables() -> list[str]:
    """The tables a demo reset empties."""
    return [model._meta.db_table for model in club_models()]


def session_named(title: str) -> GradingSession:
    return GradingSession.objects.get(title=title)


def sign_in(email: str) -> APIClient:
    client = APIClient()
    token = client.get("/api/auth/me/").cookies["csrftoken"].value
    response = client.post(
        "/api/auth/login/",
        {"email": email, "password": DEMO_PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200, response.content
    return client


# Building
