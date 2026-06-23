from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db.models import QuerySet

from gradings.models import GradingCandidate, GradingSession
from ranks.models import Rank
from students.models import Student
from syllabus.models import AgeBand, SyllabusRequirement

ALLOWED_SESSION_TRANSITIONS: dict[str, set[str]] = {
    GradingSession.Status.DRAFT: {
        GradingSession.Status.OPEN,
        GradingSession.Status.CANCELLED,
    },
    GradingSession.Status.OPEN: {
        GradingSession.Status.LOCKED,
        GradingSession.Status.CANCELLED,
    },
    # Reopening a locked session is allowed as a narrow administrative correction
    # before assessment records exist; completed and cancelled sessions stay terminal.
    GradingSession.Status.LOCKED: {
        GradingSession.Status.COMPLETED,
        GradingSession.Status.OPEN,
    },
    GradingSession.Status.COMPLETED: set(),
    GradingSession.Status.CANCELLED: set(),
}


def calculate_age_on(date_of_birth: date, on_date: date) -> int:
    age = on_date.year - date_of_birth.year
    try:
        birthday_this_year = date(on_date.year, date_of_birth.month, date_of_birth.day)
    except ValueError:
        birthday_this_year = date(on_date.year, 3, 1)
    if on_date < birthday_this_year:
        age -= 1
    return age


def resolve_age_band(date_of_birth: date | None, grading_date: date) -> str:
    if date_of_birth is None:
        raise ValidationError({"student": ["Student date of birth is required."]})
    age = calculate_age_on(date_of_birth, grading_date)
    if age <= 8:
        return AgeBand.AGE_8_AND_UNDER
    if age <= 12:
        return AgeBand.AGE_9_TO_12
    if age <= 17:
        return AgeBand.AGE_13_TO_17
    return AgeBand.AGE_18_AND_OVER


def get_next_active_rank(current_rank: Rank) -> Rank | None:
    return (
        Rank.objects.filter(active=True, order__gt=current_rank.order)
        .order_by("order")
        .first()
    )


def validate_testing_for_rank(student: Student, testing_for_rank: Rank) -> None:
    next_rank = get_next_active_rank(student.current_rank)
    if next_rank is None:
        raise ValidationError(
            {"testing_for_rank": ["Student has no next active rank."]},
        )
    if testing_for_rank != next_rank:
        raise ValidationError(
            {
                "testing_for_rank": [
                    "Testing-for rank must be the next active rank after "
                    "the student's current rank.",
                ],
            },
        )


def validate_session_transition(current_status: str, next_status: str) -> None:
    if current_status == next_status:
        return
    allowed = ALLOWED_SESSION_TRANSITIONS.get(current_status, set())
    if next_status not in allowed:
        raise ValidationError(
            {
                "status": [
                    f"Cannot transition grading session from "
                    f"{current_status} to {next_status}.",
                ],
            },
        )


def validate_session_grading_date_change(session: GradingSession) -> None:
    if session._state.adding:
        return
    previous_grading_date = (
        GradingSession.objects.filter(pk=session.pk)
        .values_list("grading_date", flat=True)
        .first()
    )
    if previous_grading_date != session.grading_date and session.candidates.exists():
        raise ValidationError(
            {
                "grading_date": [
                    "Grading date cannot be changed after candidates are registered.",
                ],
            },
        )


def validate_session_accepts_candidates(session: GradingSession) -> None:
    if session.status in {
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    }:
        raise ValidationError(
            {"session": ["Candidates can only be added to draft or open sessions."]},
        )


def validate_session_can_be_deleted(session: GradingSession) -> None:
    if session.status not in {
        GradingSession.Status.DRAFT,
        GradingSession.Status.CANCELLED,
    }:
        raise ValidationError(
            {"status": ["Only draft or cancelled grading sessions can be deleted."]},
        )


def validate_candidate_can_be_changed(candidate: GradingCandidate) -> None:
    if candidate.session.status not in {
        GradingSession.Status.DRAFT,
        GradingSession.Status.OPEN,
    }:
        raise ValidationError(
            {
                "session": [
                    "Candidates can only be changed while the session is "
                    "draft or open.",
                ],
            },
        )


def validate_candidate_can_be_deleted(candidate: GradingCandidate) -> None:
    if candidate.session.status not in {
        GradingSession.Status.DRAFT,
        GradingSession.Status.OPEN,
    }:
        raise ValidationError(
            {
                "session": [
                    "Candidates can only be deleted while the session is "
                    "draft or open.",
                ],
            },
        )


def build_candidate(
    *,
    session: GradingSession,
    student: Student,
    testing_for_rank: Rank,
    status: str = GradingCandidate.Status.REGISTERED,
    notes: str = "",
) -> GradingCandidate:
    validate_session_accepts_candidates(session)
    validate_testing_for_rank(student, testing_for_rank)
    return GradingCandidate(
        session=session,
        student=student,
        testing_for_rank=testing_for_rank,
        age_band=resolve_age_band(student.date_of_birth, session.grading_date),
        status=status,
        notes=notes,
    )


def update_candidate(
    candidate: GradingCandidate,
    *,
    session: GradingSession | None = None,
    student: Student | None = None,
    testing_for_rank: Rank | None = None,
    status: str | None = None,
    notes: str | None = None,
) -> GradingCandidate:
    new_session = session or candidate.session
    new_student = student or candidate.student
    new_testing_for_rank = testing_for_rank or candidate.testing_for_rank

    validate_candidate_can_be_changed(candidate)
    if session is not None:
        validate_session_accepts_candidates(new_session)
    validate_testing_for_rank(new_student, new_testing_for_rank)

    candidate.session = new_session
    candidate.student = new_student
    candidate.testing_for_rank = new_testing_for_rank
    if status is not None:
        candidate.status = status
    if notes is not None:
        candidate.notes = notes
    if session is not None or student is not None:
        candidate.age_band = resolve_age_band(
            new_student.date_of_birth,
            new_session.grading_date,
        )
    return candidate


def applicable_syllabus_requirements(
    candidate: GradingCandidate,
) -> QuerySet[SyllabusRequirement]:
    return (
        SyllabusRequirement.objects.filter(
            rank=candidate.testing_for_rank,
            age_band=candidate.age_band,
            active=True,
            item__active=True,
        )
        .select_related("rank", "item")
        .order_by("sequence", "item__name", "item__code")
    )
