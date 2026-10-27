"""Shared fixture builders for the audit tests."""

from __future__ import annotations

from datetime import date

from accounts.models import User
from gradings.assessment_services import (
    generate_candidate_assessment,
    update_candidate_assessment,
    update_candidate_assessment_item,
)
from gradings.models import (
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import create_candidate_outcome
from gradings.services import (
    create_grading_session,
    register_candidate,
    transition_grading_session,
)
from ranks.models import Rank
from students.models import Student


def locked_completed_candidate_with_outcome() -> tuple[CandidateOutcome, User, User]:
    creator = User.objects.create_user(email="audit-creator@example.com")
    first = User.objects.create_user(email="audit-first@example.com")
    second = User.objects.create_user(email="audit-second@example.com")

    session = create_grading_session(
        title="Audit grading",
        grading_date=date(2027, 9, 1),
        location="",
        notes="",
        created_by=creator,
    )
    student = Student.objects.create(
        wksa_id="123-4-901",
        first_name="Audit",
        last_name="Student",
        date_of_birth=date(2010, 1, 1),
        current_rank=Rank.objects.get(code="WHITE"),
    )
    candidate = register_candidate(
        session=session,
        student=student,
        testing_for_rank=Rank.objects.get(code="YELLOW_STRIPE"),
        actor=creator,
    )
    assessment = generate_candidate_assessment(candidate, creator)
    transition_grading_session(session, GradingSession.Status.OPEN, actor=creator)
    update_candidate_assessment(
        assessment,
        status="IN_PROGRESS",
        actor=creator,
    )
    for item in assessment.items.filter(required=True):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=first,
        )
    update_candidate_assessment(assessment, status="COMPLETED", actor=creator)
    session.refresh_from_db()
    transition_grading_session(session, GradingSession.Status.LOCKED, actor=creator)
    candidate.refresh_from_db()
    outcome = create_candidate_outcome(candidate, creator)
    return outcome, first, second


def draft_session_with_candidates() -> tuple[GradingSession, list[GradingCandidate]]:
    creator = User.objects.create_user(email="audit-creator@example.com")
    session = create_grading_session(
        title="Cascade grading",
        grading_date=date(2027, 12, 1),
        location="",
        notes="",
        created_by=creator,
    )
    candidates = []
    for index in range(2):
        student = Student.objects.create(
            wksa_id=f"123-4-91{index}",
            first_name="Cascade",
            last_name=f"Student{index}",
            date_of_birth=date(2010, 1, 1),
            current_rank=Rank.objects.get(code="WHITE"),
        )
        candidates.append(
            register_candidate(
                session=session,
                student=student,
                testing_for_rank=Rank.objects.get(code="YELLOW_STRIPE"),
                actor=creator,
            ),
        )
    return session, candidates
