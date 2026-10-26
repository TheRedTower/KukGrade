from __future__ import annotations

from unittest.mock import patch

import pytest
from django.db import DatabaseError
from rest_framework.test import APIClient

from health.views import database_reachable


def test_health_check_returns_ok() -> None:
    client = APIClient()

    response = client.get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"service": "kukgrade-backend", "status": "ok"}


def test_there_is_no_public_readiness_endpoint() -> None:
    # Whether the database is up is not for the public; the container's own
    # health check asks the database directly (kukgrade.container_health).
    response = APIClient().get("/api/ready/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_the_database_answers() -> None:
    assert database_reachable() is True


def test_a_database_failure_is_reported_not_raised() -> None:
    with patch("health.views.connection.cursor", side_effect=DatabaseError):
        assert database_reachable() is False
