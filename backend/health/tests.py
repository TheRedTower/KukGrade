from __future__ import annotations

from rest_framework.test import APIClient


def test_health_check_returns_ok() -> None:
    client = APIClient()

    response = client.get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"service": "kukgrade-backend", "status": "ok"}
