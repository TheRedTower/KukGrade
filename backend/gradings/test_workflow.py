"""The whole grading workflow driven over HTTP."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from accounts.testing import grant_permission
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingSession,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def test_end_to_end_http_grading_workflow_uses_only_response_data() -> None:
    """One grading, start to finish, entirely over HTTP.

    Every identifier a later step needs is taken from an earlier response,
    never from the ORM objects backing it - that contract is what a real
    frontend depends on, and nothing else in the suite exercises the full
    sequence in order. Two personas, exactly as the workflow requires: an
    instructor for everything up to propose, a Master for finalise and
    promote.
    """
    password = "StrongPass123!"
    instructor_user = User.objects.create_user(
        email="e2e-instructor@example.com",
        password=password,
        role=User.Role.INSTRUCTOR,
    )
    master_user = User.objects.create_user(
        email="e2e-master@example.com",
        password=password,
        role=User.Role.INSTRUCTOR,
    )
    grant_permission(master_user, FINAL_GRADING_DECISION_PERMISSION)
    grant_permission(master_user, PROMOTE_STUDENT_PERMISSION)

    instructor = APIClient()
    login_response = instructor.post(
        "/api/auth/login/",
        {"email": instructor_user.email, "password": password},
        format="json",
    )
    assert login_response.status_code == 200
    assert login_response.json()["email"] == instructor_user.email

    ranks_by_code = {row["code"]: row for row in results(instructor.get("/api/ranks/"))}
    white_rank_id = ranks_by_code["WHITE"]["id"]
    next_rank_id = ranks_by_code["YELLOW_STRIPE"]["id"]

    student_response = instructor.post(
        "/api/students/",
        {
            "wksa_id": "123-4-500",
            "first_name": "Riley",
            "last_name": "Endo",
            "date_of_birth": "2015-04-01",
            "current_rank": white_rank_id,
        },
        format="json",
    )
    assert student_response.status_code == 201
    student_id = student_response.json()["id"]

    session_response = instructor.post(
        "/api/gradings/sessions/",
        {
            "title": "End-to-end HTTP Grading",
            "grading_date": "2027-06-01",
            "location": "Riverside Dojang",
        },
        format="json",
    )
    assert session_response.status_code == 201
    session_body = session_response.json()
    session_id = session_body["id"]
    assert session_body["status"] == GradingSession.Status.DRAFT

    candidate_response = instructor.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session_id,
            "candidates": [{"student": student_id, "testing_for_rank": next_rank_id}],
        },
        format="json",
    )
    assert candidate_response.status_code == 200
    candidate_body = candidate_response.json()["created"][0]["candidate"]
    candidate_id = candidate_body["id"]
    assert candidate_body["age_band_display"]

    open_response = instructor.patch(
        f"/api/gradings/sessions/{session_id}/",
        {"status": GradingSession.Status.OPEN},
        format="json",
    )
    assert open_response.status_code == 200
    assert open_response.json()["status"] == GradingSession.Status.OPEN

    generate_response = instructor.post(
        f"/api/gradings/candidates/{candidate_id}/generate-assessment/",
    )
    assert generate_response.status_code == 201
    assessment_body = generate_response.json()
    assessment_id = assessment_body["id"]
    assert assessment_body["status"] == CandidateAssessment.Status.NOT_STARTED
    assert CandidateAssessmentItem.objects.filter(
        assessment_id=assessment_id,
        required=True,
    ).exists()

    start_response = instructor.patch(
        f"/api/gradings/assessments/{assessment_id}/",
        {"status": CandidateAssessment.Status.IN_PROGRESS},
        format="json",
    )
    assert start_response.status_code == 200
    assert start_response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS

    required_items = results(
        instructor.get(
            f"/api/gradings/assessment-items/?assessment={assessment_id}",
        ),
    )
    required_items = [item for item in required_items if item["required"]]
    assert required_items

    for item in required_items:
        item_response = instructor.patch(
            f"/api/gradings/assessment-items/{item['id']}/",
            {
                "result": CandidateAssessmentItem.Result.MET,
                "assessor_notes": "Clean technique, recorded end to end.",
            },
            format="json",
        )
        assert item_response.status_code == 200
        item_body = item_response.json()
        assert item_body["result"] == CandidateAssessmentItem.Result.MET
        assert item_body["assessor_email"] == instructor_user.email

    # Every assessment is completed while the session is open; locking then
    # ends grading and opens the decision stage.
    complete_response = instructor.patch(
        f"/api/gradings/assessments/{assessment_id}/",
        {"status": CandidateAssessment.Status.COMPLETED},
        format="json",
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == CandidateAssessment.Status.COMPLETED

    lock_response = instructor.patch(
        f"/api/gradings/sessions/{session_id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )
    assert lock_response.status_code == 200
    assert lock_response.json()["status"] == GradingSession.Status.LOCKED

    outcome_response = instructor.post(
        f"/api/gradings/candidates/{candidate_id}/create-outcome/",
    )
    assert outcome_response.status_code == 201
    outcome_body = outcome_response.json()
    outcome_id = outcome_body["id"]
    assert outcome_body["status"] == CandidateOutcome.Status.DRAFT

    propose_response = instructor.patch(
        f"/api/gradings/outcomes/{outcome_id}/propose/",
        {
            "proposed_outcome": CandidateOutcome.Outcome.PASS,
            "proposal_notes": "Recommended for promotion.",
        },
        format="json",
    )
    assert propose_response.status_code == 200
    propose_body = propose_response.json()
    assert propose_body["status"] == CandidateOutcome.Status.PROPOSED
    assert propose_body["proposed_outcome"] == CandidateOutcome.Outcome.PASS

    master_client = APIClient()
    master_login = master_client.post(
        "/api/auth/login/",
        {"email": master_user.email, "password": password},
        format="json",
    )
    assert master_login.status_code == 200

    finalise_response = master_client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {
            "final_outcome": CandidateOutcome.Outcome.PASS,
            "decision_notes": "Confirmed end to end.",
        },
        format="json",
    )
    assert finalise_response.status_code == 200
    finalise_body = finalise_response.json()
    assert finalise_body["status"] == CandidateOutcome.Status.FINALISED
    assert finalise_body["final_outcome"] == CandidateOutcome.Outcome.PASS

    promote_response = master_client.post(
        f"/api/gradings/outcomes/{outcome_id}/promote/",
        {"notes": "Promoted end to end."},
        format="json",
    )
    assert promote_response.status_code == 201
    promote_body = promote_response.json()
    assert promote_body["grading_candidate"] == candidate_id
    assert promote_body["to_rank_name"] == "Yellow Stripe"

    rank_history_response = master_client.get(
        f"/api/students/{student_id}/rank-history/",
    )
    assert rank_history_response.status_code == 200
    rank_history_body = rank_history_response.json()
    assert [promotion["id"] for promotion in rank_history_body["promotions"]] == [
        promote_body["id"]
    ]
