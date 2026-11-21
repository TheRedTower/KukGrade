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


VIEW_ONLY_MODELS = [
    ("students", "student"),
    ("students", "retiredwksaid"),
    ("gradings", "gradingsession"),
    ("gradings", "gradingcandidate"),
    ("gradings", "candidateassessment"),
    ("gradings", "candidateassessmentitem"),
    ("gradings", "candidateoutcome"),
    ("gradings", "promotion"),
    ("ranks", "rank"),
    ("syllabus", "syllabusitem"),
    ("syllabus", "syllabusrequirement"),
    ("audit", "auditevent"),
    ("data_imports", "importbatch"),
]


@pytest.mark.parametrize(("app_label", "model_name"), VIEW_ONLY_MODELS)
def test_grading_and_student_data_can_be_looked_at_but_not_changed_in_admin(
    app_label: str,
    model_name: str,
) -> None:
    from django.apps import apps
    from django.contrib import admin
    from django.test import RequestFactory

    model = apps.get_model(app_label, model_name)
    model_admin = admin.site._registry[model]
    request = RequestFactory().get("/")
    request.user = User.objects.create_superuser(
        email=f"view-only-{model_name}@example.com",
        password="Owner-Chosen-Pass-9!",
    )

    assert model_admin.has_view_permission(request) is True
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False
    assert model_admin.get_actions(request) == {}


def test_the_view_only_pages_render(settings: Any) -> None:
    from audit.models import AuditAction
    from audit.recording import record
    from data_imports.testing import legacy_batch
    from gradings.testing import assessment, candidate
    from kukgrade.testing import render_admin_pages

    render_admin_pages(settings)
    built = candidate()
    prepared = assessment(candidate=built)
    batch = legacy_batch()
    event = record(AuditAction.STUDENT_CREATED, built.student, "Student created.")
    client = Client()
    client.force_login(
        User.objects.create_superuser(
            email="view-pages@example.com",
            password="Owner-Chosen-Pass-9!",
        ),
    )
    pages = [
        "/admin/students/student/",
        f"/admin/students/student/{built.student_id}/change/",
        "/admin/gradings/gradingsession/",
        f"/admin/gradings/gradingsession/{built.session_id}/change/",
        "/admin/gradings/gradingcandidate/",
        f"/admin/gradings/gradingcandidate/{built.pk}/change/",
        "/admin/gradings/candidateassessment/",
        f"/admin/gradings/candidateassessment/{prepared.pk}/change/",
        "/admin/gradings/candidateassessmentitem/",
        "/admin/gradings/candidateoutcome/",
        "/admin/gradings/promotion/",
        "/admin/audit/auditevent/",
        f"/admin/audit/auditevent/{event.pk}/change/",
        "/admin/data_imports/importbatch/",
        f"/admin/data_imports/importbatch/{batch.pk}/change/",
    ]

    for page in pages:
        shown = client.get(page, HTTP_HOST="localhost")
        assert shown.status_code == 200, page
        assert "Save" not in shown.content.decode().replace("Save as", ""), page
