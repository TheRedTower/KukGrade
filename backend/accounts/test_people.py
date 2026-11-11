"""People on records read by rank and name, as the rank they held then."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from accounts.people import person_label
from accounts.services import update_platform_user
from audit.models import AuditAction, AuditEvent
from audit.recording import record
from gradings.assessment_services import (
    add_item_comment,
    update_candidate_assessment_item,
)
from gradings.models import CandidateAssessmentItem, GradingSession
from gradings.testing import (
    assessment,
    candidate,
    grading_session,
    rank,
    start_assessment,
)
from kukgrade.testing import results
from ranks.models import Rank

pytestmark = pytest.mark.django_db


def admin_client() -> APIClient:
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(
            email="people-admin@example.com",
            first_name="Pat",
            last_name="Admin",
            role=User.Role.ADMINISTRATOR,
        ),
    )
    return client


def instructor(email: str, code: str = "KSN") -> User:
    return User.objects.create_user(
        email=email,
        first_name="Jane",
        last_name="Smith",
        rank=rank(code),
    )


def test_a_person_reads_rank_first_or_as_the_administrator_account() -> None:
    assert person_label("Jane Smith", "KSN") == "KSN Jane Smith"
    assert person_label("Pat Admin", "administrator") == "Pat Admin (administrator)"
    assert person_label("Jane Smith", "") == "Jane Smith"


def test_an_instructor_holds_a_rank_above_the_syllabus() -> None:
    assert [r.code for r in Rank.objects.staff()] == ["KSN", "PSBN", "SBN", "PKJN"]


def test_an_instructor_account_is_made_with_its_rank() -> None:
    client = admin_client()
    payload = {"email": "new-staff@example.com", "first_name": "New"}

    missing = client.post("/api/users/", payload, format="json")
    below = client.post(
        "/api/users/", {**payload, "rank": rank("JKN").pk}, format="json"
    )
    made = client.post(
        "/api/users/", {**payload, "rank": rank("SBN").pk}, format="json"
    )

    assert missing.status_code == 400
    assert missing.json()["error"]["fields"]["rank"] == [
        "Choose the instructor's rank."
    ]
    assert below.status_code == 400
    assert "rank" in below.json()["error"]["fields"]
    assert made.status_code == 201
    assert made.json()["rank_name"] == "SBN"


def test_an_administrator_account_has_no_rank() -> None:
    client = admin_client()

    refused = client.post(
        "/api/users/",
        {
            "email": "new-admin@example.com",
            "role": User.Role.ADMINISTRATOR,
            "rank": rank("KSN").pk,
        },
        format="json",
    )
    made = client.post(
        "/api/users/",
        {"email": "new-admin@example.com", "role": User.Role.ADMINISTRATOR},
        format="json",
    )
    teacher = instructor("becomes-admin@example.com")
    update_platform_user(teacher, role=User.Role.ADMINISTRATOR)

    assert refused.status_code == 400
    assert refused.json()["error"]["fields"]["rank"] == [
        "An administrator account has no rank."
    ]
    assert made.status_code == 201
    teacher.refresh_from_db()
    assert teacher.rank is None


def test_nobody_sets_their_own_rank() -> None:
    teacher = instructor("own-rank@example.com")
    client = APIClient()
    client.force_authenticate(user=teacher)

    client.patch("/api/auth/me/", {"rank": rank("PKJN").pk}, format="json")

    teacher.refresh_from_db()
    assert teacher.rank == rank("KSN")


def test_a_rank_change_is_audited() -> None:
    client = admin_client()
    teacher = instructor("promoted-staff@example.com")

    response = client.patch(
        f"/api/users/{teacher.pk}/", {"rank": rank("PSBN").pk}, format="json"
    )

    assert response.status_code == 200
    event = AuditEvent.objects.filter(action=AuditAction.USER_UPDATED).latest(
        "occurred_at",
    )
    assert event.metadata["before"]["rank"] == "KSN"
    assert event.metadata["after"]["rank"] == "PSBN"


def test_a_record_keeps_the_rank_its_author_held_then() -> None:
    # "The decision was made as a KSN and it will stay as that rank."
    session = grading_session(status=GradingSession.Status.OPEN)
    built = start_assessment(assessment(candidate=candidate(session=session)))
    item = built.items.first()
    assert item is not None
    teacher = instructor("marks-as-ksn@example.com")
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=teacher,
    )
    add_item_comment(item, "Clean and sharp.", teacher)
    update_platform_user(teacher, rank=rank("PSBN"))
    teacher.refresh_from_db()
    add_item_comment(item, "Still clean.", teacher)
    client = admin_client()

    [served] = [
        row
        for row in results(
            client.get(f"/api/gradings/assessment-items/?assessment={built.pk}"),
        )
        if row["id"] == item.pk
    ]
    events = {
        event["summary"]: event["actor_name"]
        for event in results(client.get("/api/audit-events/"))
    }

    assert served["assessor_name"] == "KSN Jane Smith"
    assert [c["author_name"] for c in served["comments"]] == [
        "KSN Jane Smith",
        "PSBN Jane Smith",
    ]
    assert [c["changed_by_name"] for c in served["changes"]] == ["KSN Jane Smith"]
    assert any(name == "KSN Jane Smith" for name in events.values())
    assert "@" not in str(served)


def test_an_administrators_action_names_that_account() -> None:
    admin = User.objects.create_user(
        email="acting-admin@example.com",
        first_name="Pat",
        last_name="Admin",
        role=User.Role.ADMINISTRATOR,
    )
    record(AuditAction.STUDENT_CREATED, admin, "Something done.", actor=admin)
    client = APIClient()
    client.force_authenticate(user=admin)

    [row] = results(client.get("/api/audit-events/?search=Something"))

    assert row["actor_name"] == "Pat Admin (administrator)"
    assert "actor_email" not in row


def test_the_instructor_ranks_are_served_as_choices() -> None:
    client = APIClient()
    client.force_authenticate(user=instructor("reads-choices@example.com"))

    served = client.get("/api/choices/").json()["staff_ranks"]

    assert [choice["label"] for choice in served] == ["KSN", "PSBN", "SBN", "PKJN"]
    assert served[0]["value"] == rank("KSN").pk
