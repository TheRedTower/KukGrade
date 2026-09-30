"""Shared builders for the grading tests."""

from __future__ import annotations

import itertools
from datetime import date
from typing import Any, cast

from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.http import HttpRequest
from django.test import RequestFactory
from django.utils import timezone
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
    GradingCandidate,
    GradingSession,
)
from gradings.services import (
    apply_candidate_update,
    build_candidate,
    create_candidate_outcome,
    finalise_candidate_outcome,
    generate_candidate_assessment,
    propose_candidate_outcome,
    transition_grading_session,
    update_candidate_assessment,
)
from ranks.models import Rank
from students.models import Student


def user(email: str = "grading-user@example.com", **overrides: Any) -> User:
    return User.objects.create_user(email=email, **overrides)


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


_creator_counter = itertools.count()


def grading_session(**overrides: object) -> GradingSession:
    status = cast(str, overrides.pop("status", GradingSession.Status.DRAFT))
    data: dict[str, object] = {
        "title": "March 2027 Colchester Grading",
        "grading_date": date(2027, 3, 20),
    }
    if "created_by" not in overrides:
        data["created_by"] = user(f"creator-{next(_creator_counter)}@example.com")
    data.update(overrides)
    session = GradingSession.objects.create(**data)
    if status != GradingSession.Status.DRAFT:
        GradingSession.objects.filter(pk=session.pk).update(status=status)
        session.refresh_from_db()
    return session


def student(**overrides: object) -> Student:
    data: dict[str, object] = {
        "wksa_id": f"WKSA{Student.objects.count() + 1:04d}",
        "first_name": "Alex",
        "last_name": "Kim",
        "date_of_birth": date(2017, 3, 20),
        "current_rank": rank("WHITE"),
    }
    data.update(overrides)
    return Student.objects.create(**data)


def candidate(**overrides: object) -> GradingCandidate:
    session = overrides.pop("session", grading_session())
    candidate_student = overrides.pop("student", student())
    testing_for_rank = overrides.pop("testing_for_rank", rank("YELLOW_STRIPE"))
    status = overrides.pop("status", GradingCandidate.Status.REGISTERED)
    built = build_candidate(
        session=cast(GradingSession, session),
        student=cast(Student, candidate_student),
        testing_for_rank=cast(Rank, testing_for_rank),
        notes=cast(str, overrides.pop("notes", "")),
    )
    for key, value in overrides.items():
        setattr(built, key, value)
    built.save()
    if status == GradingCandidate.Status.WITHDRAWN:
        built = apply_candidate_update(
            built,
            status=GradingCandidate.Status.WITHDRAWN,
            withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
            actor=user(f"withdrawer-{built.pk}@example.com"),
        )
    return built


def assessment(**overrides: object) -> CandidateAssessment:
    built_candidate = cast(GradingCandidate, overrides.pop("candidate", candidate()))
    generated_by = cast(
        User,
        overrides.pop(
            "generated_by",
            user(
                f"generator-{User.objects.count()}-"
                f"{CandidateAssessment.objects.count()}@example.com"
            ),
        ),
    )
    return generate_candidate_assessment(built_candidate, generated_by)


def start_assessment(assessment: CandidateAssessment) -> CandidateAssessment:
    return update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )


def complete_assessment(
    assessment: CandidateAssessment,
    assessor: User | None = None,
) -> CandidateAssessment:
    assessment.refresh_from_db()
    if assessment.status == CandidateAssessment.Status.NOT_STARTED:
        assessment = start_assessment(assessment)
    assessment.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=assessor or user(f"bulk-assessor-{assessment.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    return update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.COMPLETED,
    )


def master(email: str = "master@example.com") -> User:
    finaliser = user(email)
    grant_permission(finaliser, FINAL_GRADING_DECISION_PERMISSION)
    return finaliser


def promoter(email: str = "promoter@example.com") -> User:
    promotion_user = user(email)
    grant_permission(promotion_user, PROMOTE_STUDENT_PERMISSION)
    return promotion_user


def finalised_outcome(
    built: GradingCandidate,
    *,
    proposed: str = CandidateOutcome.Outcome.PASS,
    final: str = CandidateOutcome.Outcome.PASS,
    conditional_requirements: str = "",
) -> CandidateOutcome:
    suffix = f"{built.pk}-{CandidateOutcome.objects.count()}"
    outcome = create_candidate_outcome(built, user(f"outcome-{suffix}@example.com"))
    proposed_outcome = propose_candidate_outcome(
        outcome,
        proposed,
        "Ready for final decision.",
        user(f"proposer-{suffix}@example.com"),
    )
    return finalise_candidate_outcome(
        proposed_outcome,
        final,
        "Final decision recorded.",
        conditional_requirements,
        master(f"master-{suffix}@example.com"),
    )


def auth_client(email: str = "grading-api@example.com") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user(email))
    return client


def admin_request(email: str = "grading-admin@example.com") -> HttpRequest:
    request = RequestFactory().post("/admin/gradings/gradingsession/")
    request.user = user(email)
    return cast(HttpRequest, request)


def locked_completed_candidate() -> tuple[GradingCandidate, CandidateAssessment]:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    built.refresh_from_db()
    generated.refresh_from_db()
    return built, generated


def override_master(email: str) -> User:
    actor = user(email)
    actor.user_permissions.add(
        Permission.objects.get(
            codename="can_override_locked_session",
            content_type=ContentType.objects.get_for_model(GradingSession),
        ),
    )
    return User.objects.get(pk=actor.pk)


def locked_session_with_undecided_candidate() -> tuple[
    GradingSession, GradingCandidate
]:
    # Graded but with no decision yet - the only state a candidate can be in
    # once a session locks, since locking requires every assessment complete.
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    session.refresh_from_db()
    built.refresh_from_db()
    return session, built
