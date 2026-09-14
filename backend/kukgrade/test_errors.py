"""Every API error uses one envelope.

    {"error": {"code": "...", "message": "...", "fields": {...}}}

`fields` appears only on validation errors. These tests pin the contract the
frontend parses, so a regression here is caught server-side rather than as a
blank error message in the browser.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from accounts.models import User
from gradings.models import CandidateOutcome

pytestmark = pytest.mark.django_db


def auth_client(email: str = "errors@example.com") -> APIClient:
    api = APIClient()
    api.force_authenticate(user=User.objects.create_user(email=email))
    return api


def envelope(response: Any) -> dict[str, Any]:
    payload = response.json()
    assert set(payload) == {"error"}, payload
    error = payload["error"]
    assert set(error) <= {"code", "message", "fields"}
    assert {"code", "message"} <= set(error)
    assert isinstance(error["code"], str) and error["code"]
    assert isinstance(error["message"], str) and error["message"]
    typed: dict[str, Any] = error
    return typed


def test_unauthenticated_request_uses_the_envelope() -> None:
    error = envelope(APIClient().get("/api/gradings/sessions/"))

    assert error["code"] == "authentication_required"
    assert "fields" not in error


def test_permission_denied_uses_the_envelope() -> None:
    # Finalising requires gradings.can_make_final_grading_decision.
    response = auth_client("no-authority@example.com").patch(
        "/api/gradings/outcomes/1/finalise/",
        {"final_outcome": CandidateOutcome.Outcome.PASS},
        format="json",
    )

    error = envelope(response)
    assert response.status_code == 403
    assert error["code"] == "permission_denied"


def test_not_found_uses_the_envelope() -> None:
    response = auth_client("missing@example.com").get(
        "/api/gradings/sessions/99999999/",
    )

    error = envelope(response)
    assert response.status_code == 404
    assert error["code"] == "not_found"


def test_method_not_allowed_uses_the_envelope() -> None:
    response = auth_client("bad-method@example.com").delete("/api/ranks/1/")

    error = envelope(response)
    assert response.status_code == 405
    assert error["code"] == "method_not_allowed"


def test_single_validation_message_is_surfaced_as_the_message() -> None:
    # A lone message is nearly always a domain rule rather than a form error,
    # so it must be readable without digging into `fields`.
    response = auth_client("single-error@example.com").post(
        "/api/gradings/sessions/",
        {"title": "   ", "grading_date": "2027-05-01"},
        format="json",
    )

    error = envelope(response)
    assert response.status_code == 400
    assert error["code"] == "validation_error"
    assert error["fields"] == {"title": ["This field may not be blank."]}
    assert error["message"] == "This field may not be blank."


def test_multiple_validation_messages_keep_a_generic_summary() -> None:
    response = auth_client("multi-error@example.com").post(
        "/api/gradings/sessions/",
        {},
        format="json",
    )

    error = envelope(response)
    assert response.status_code == 400
    assert set(error["fields"]) == {"title", "grading_date"}
    assert error["message"] == "The request contained invalid data."


def test_serializer_level_errors_are_keyed_under_non_field_errors() -> None:
    response = APIClient().post(
        "/api/auth/login/",
        {"email": "nobody@example.com", "password": "wrong-password"},
        format="json",
    )

    error = envelope(response)
    assert response.status_code == 400
    assert error["code"] == "validation_error"
    assert list(error["fields"]) == ["non_field_errors"]
    # Still generic: the message must not reveal whether the account exists.
    assert "Unable to log in" in error["fields"]["non_field_errors"][0]


def test_field_error_values_are_plain_strings_not_error_detail_objects() -> None:
    response = auth_client("plain-strings@example.com").post(
        "/api/gradings/sessions/",
        {"grading_date": "not-a-date"},
        format="json",
    )

    error = envelope(response)
    for messages in error["fields"].values():
        assert isinstance(messages, list)
        assert all(type(message) is str for message in messages)


def test_domain_rule_violation_reaches_the_client_with_its_field() -> None:
    master = User.objects.create_user(email="master-errors@example.com")
    master.user_permissions.add(
        Permission.objects.get(
            codename="can_make_final_grading_decision",
            content_type=ContentType.objects.get_for_model(CandidateOutcome),
        ),
    )
    api = APIClient()
    api.force_authenticate(user=master)

    created = api.post(
        "/api/gradings/sessions/",
        {"title": "Domain rule session", "grading_date": str(date(2027, 6, 1))},
        format="json",
    )
    session_id = created.json()["id"]

    # LOCKED is not reachable from DRAFT.
    response = api.patch(
        f"/api/gradings/sessions/{session_id}/",
        {"status": "LOCKED"},
        format="json",
    )

    error = envelope(response)
    assert response.status_code == 400
    assert "status" in error["fields"]
    assert "Cannot transition" in error["fields"]["status"][0]


def test_unhandled_server_errors_are_enveloped_too() -> None:
    # A 500 never reaches DRF's exception handler, so without handler500 the
    # API answers with Django's HTML page and a browser client shows a blank
    # screen rather than a message.
    from django.test import Client

    from kukgrade.exceptions import server_error

    response = server_error(Client().request(PATH_INFO="/boom").wsgi_request)

    assert response.status_code == 500
    payload = json.loads(response.content)
    assert payload["error"]["code"] == "server_error"
    assert "try again" in payload["error"]["message"]
    # The cause belongs in the logs, not the response.
    assert "Traceback" not in response.content.decode()
