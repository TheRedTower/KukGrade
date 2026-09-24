from __future__ import annotations

from unittest.mock import patch

import pytest
from django.db import DatabaseError
from rest_framework.test import APIClient


def test_health_check_returns_ok() -> None:
    client = APIClient()

    response = client.get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"service": "kukgrade-backend", "status": "ok"}


@pytest.mark.django_db
def test_readiness_checks_database_for_anonymous_caller() -> None:
    response = APIClient().get("/api/ready/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_database_failure() -> None:
    with patch("health.views.connection.cursor", side_effect=DatabaseError):
        response = APIClient().get("/api/ready/")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
