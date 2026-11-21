"""The production image serves React routes without swallowing Django URLs."""

from __future__ import annotations

from pathlib import Path

from django.test import Client, override_settings


def test_frontend_root_and_deep_link(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<h1>KukGrade frontend</h1>", encoding="utf-8")

    with override_settings(FRONTEND_DIST=tmp_path):
        client = Client()
        for url in ("/", "/students/42"):
            response = client.get(url)
            assert response.status_code == 200
            assert b"KukGrade frontend" in response.content
            assert "no-store" in response["Cache-Control"]


def test_frontend_does_not_capture_api_or_missing_assets(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("frontend", encoding="utf-8")

    with override_settings(FRONTEND_DIST=tmp_path):
        client = Client()
        assert client.get("/api/unknown/").status_code == 404
        assert client.get("/static/missing.js").status_code == 404
        assert client.get("/assets/missing.js").status_code == 404
        assert client.post("/students/42").status_code == 405


def test_frontend_is_unavailable_without_a_build(tmp_path: Path) -> None:
    with override_settings(FRONTEND_DIST=tmp_path):
        assert Client().get("/").status_code == 404
