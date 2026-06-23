from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from accounts.models import User
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
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
    GradingSession.Status.LOCKED: {
        GradingSession.Status.COMPLETED,
    },
    GradingSession.Status.COMPLETED: set(),
    GradingSession.Status.CANCELLED: set(),
}

ASSESSMENT_GENERATION_SESSION_STATUSES = {
    GradingSession.Status.DRAFT,
    GradingSession.Status.OPEN,
}

ASSESSMENT_RESULT_ENTRY_SESSION_STATUSES = {
    GradingSession.Status.OPEN,
    GradingSession.Status.LOCKED,
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


def validate_session_transition(
    current_status: str,
    next_status: str,
    *,
    session: GradingSession | None = None,
) -> None:
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
    if session is None:
        return
    if (
        current_status == GradingSession.Status.OPEN
        and next_status == GradingSession.Status.LOCKED
    ):
        active_candidates = session.candidates.exclude(
            status=GradingCandidate.Status.WITHDRAWN,
        )
        missing_assessment = active_candidates.filter(assessment__isnull=True).exists()
        if missing_assessment:
            raise ValidationError(
                {
                    "status": [
                        "Every non-withdrawn candidate must have an assessment "
                        "before the session can be locked.",
                    ],
                },
            )
        not_started_assessment = active_candidates.filter(
            assessment__status=CandidateAssessment.Status.NOT_STARTED,
        ).exists()
        if not_started_assessment:
            raise ValidationError(
                {
                    "status": [
                        "Every non-withdrawn candidate assessment must be "
                        "in progress or completed before the session can be "
                        "locked.",
                    ],
                },
            )
    if (
        current_status == GradingSession.Status.LOCKED
        and next_status == GradingSession.Status.COMPLETED
    ):
        incomplete_assessment = (
            session.candidates.exclude(status=GradingCandidate.Status.WITHDRAWN)
            .filter(
                Q(assessment__isnull=True)
                | ~Q(assessment__status=CandidateAssessment.Status.COMPLETED),
            )
            .exists()
        )
        if incomplete_assessment:
            raise ValidationError(
                {
                    "status": [
                        "Every non-withdrawn candidate must have a completed "
                        "assessment before the session can be completed.",
                    ],
                },
            )


def validate_grading_session_transition(
    session: GradingSession,
    target_status: str,
) -> None:
    if session.pk is None:
        raise ValidationError(
            {"status": ["Unsaved grading sessions cannot be transitioned."]},
        )
    persisted = (
        GradingSession.objects.filter(pk=session.pk)
        .only("id", "status", "grading_date")
        .first()
    )
    if persisted is None:
        raise ValidationError(
            {"status": ["Grading session no longer exists."]},
        )
    validate_session_transition(persisted.status, target_status, session=persisted)


@transaction.atomic
def transition_grading_session(
    session: GradingSession,
    target_status: str,
    actor: User | None = None,
) -> GradingSession:
    if session.pk is None:
        raise ValidationError(
            {"status": ["Unsaved grading sessions cannot be transitioned."]},
        )
    locked_session = GradingSession.objects.select_for_update().get(pk=session.pk)
    if locked_session.status == target_status:
        return locked_session

    validate_session_transition(
        locked_session.status,
        target_status,
        session=locked_session,
    )

    locked_session.status = target_status
    locked_session.updated_at = timezone.now()
    GradingSession.objects.filter(pk=locked_session.pk).update(
        status=locked_session.status,
        updated_at=locked_session.updated_at,
    )
    return locked_session


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


def validate_candidate_assessment_changes(
    candidate: GradingCandidate,
    *,
    session_changed: bool = False,
    student_changed: bool = False,
    testing_for_rank_changed: bool = False,
    status: str | None = None,
) -> None:
    assessment = getattr(candidate, "assessment", None)
    if assessment is None:
        if status == GradingCandidate.Status.COMPLETED:
            raise ValidationError(
                {
                    "status": [
                        "Candidate completion is controlled by assessment completion.",
                    ],
                },
            )
        return

    if session_changed or student_changed or testing_for_rank_changed:
        raise ValidationError(
            {
                "candidate": [
                    "Session, student, and testing-for rank cannot be changed "
                    "after an assessment snapshot has been generated.",
                ],
            },
        )
    if status == GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {
                "status": [
                    "Candidate completion is controlled by assessment completion.",
                ],
            },
        )
    if (
        status == GradingCandidate.Status.WITHDRAWN
        and assessment.status != CandidateAssessment.Status.NOT_STARTED
    ):
        raise ValidationError(
            {
                "status": [
                    "A candidate cannot be withdrawn after assessment work has "
                    "started.",
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
    assessment = getattr(candidate, "assessment", None)
    if assessment is None:
        return
    if (
        candidate.session.status != GradingSession.Status.DRAFT
        or assessment.status != CandidateAssessment.Status.NOT_STARTED
    ):
        raise ValidationError(
            {
                "candidate": [
                    "Candidates with assessment snapshots can only be deleted "
                    "while the session is draft and the assessment has not "
                    "started.",
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
    validate_candidate_assessment_changes(
        candidate,
        session_changed=session is not None,
        student_changed=student is not None,
        testing_for_rank_changed=testing_for_rank is not None,
        status=status,
    )
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


def validate_assessment_generation_candidate(candidate: GradingCandidate) -> None:
    if candidate.session.status not in ASSESSMENT_GENERATION_SESSION_STATUSES:
        raise ValidationError(
            {
                "session": [
                    "Assessments can only be generated while the session is "
                    "draft or open.",
                ],
            },
        )
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Cannot generate an assessment for a withdrawn candidate."]},
        )


def _snapshot_item(
    *,
    assessment: CandidateAssessment,
    requirement: SyllabusRequirement,
) -> CandidateAssessmentItem:
    return CandidateAssessmentItem(
        assessment=assessment,
        source_requirement=requirement,
        source_item=requirement.item,
        source_rank=requirement.rank,
        source_age_band=requirement.age_band,
        item_code=requirement.item.code,
        item_name=requirement.item.name,
        korean_name=requirement.item.korean_name,
        category=requirement.item.category,
        requirement_sequence=requirement.sequence,
        required=requirement.required,
        start_number=requirement.start_number,
        end_number=requirement.end_number,
        requirement_notes=requirement.notes,
    )


@transaction.atomic
def generate_candidate_assessment(
    candidate: GradingCandidate,
    generated_by: User,
) -> CandidateAssessment:
    locked_candidate = (
        GradingCandidate.objects.select_for_update()
        .select_related("session", "student", "testing_for_rank")
        .get(pk=candidate.pk)
    )
    validate_assessment_generation_candidate(locked_candidate)
    if hasattr(locked_candidate, "assessment"):
        raise ValidationError(
            {"candidate": ["Candidate already has an assessment snapshot."]},
        )

    requirements = list(applicable_syllabus_requirements(locked_candidate))
    if not requirements:
        raise ValidationError(
            {"candidate": ["No applicable syllabus requirements exist."]},
        )

    try:
        assessment = CandidateAssessment.objects.create(
            candidate=locked_candidate,
            generated_by=generated_by,
        )
        CandidateAssessmentItem.objects.bulk_create(
            [
                _snapshot_item(assessment=assessment, requirement=requirement)
                for requirement in requirements
            ],
        )
    except IntegrityError as exc:
        raise ValidationError(
            {"candidate": ["Candidate already has an assessment snapshot."]},
        ) from exc
    return assessment


def validate_assessment_can_start(assessment: CandidateAssessment) -> None:
    if assessment.status != CandidateAssessment.Status.NOT_STARTED:
        raise ValidationError(
            {"status": ["Only not-started assessments can be started."]},
        )
    if assessment.candidate.session.status != GradingSession.Status.OPEN:
        raise ValidationError(
            {"session": ["Assessments can only be started in open sessions."]},
        )
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot be assessed."]},
        )


def validate_assessment_can_complete(assessment: CandidateAssessment) -> None:
    if assessment.status != CandidateAssessment.Status.IN_PROGRESS:
        raise ValidationError(
            {"status": ["Only in-progress assessments can be completed."]},
        )
    if assessment.candidate.session.status not in {
        GradingSession.Status.OPEN,
        GradingSession.Status.LOCKED,
    }:
        raise ValidationError(
            {
                "session": [
                    "Assessments can only be completed in open or locked sessions.",
                ],
            },
        )
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot be completed."]},
        )
    missing_required_result = assessment.items.filter(
        required=True,
        result=CandidateAssessmentItem.Result.NOT_ASSESSED,
    ).exists()
    if missing_required_result:
        raise ValidationError(
            {
                "items": [
                    "Every required assessment item must be assessed before "
                    "completion.",
                ],
            },
        )


@transaction.atomic
def update_candidate_assessment(
    assessment: CandidateAssessment,
    *,
    status: str | None = None,
    notes: str | None = None,
) -> CandidateAssessment:
    locked_assessment = (
        CandidateAssessment.objects.select_for_update()
        .select_related("candidate__session")
        .get(pk=assessment.pk)
    )
    if locked_assessment.status == CandidateAssessment.Status.COMPLETED:
        raise ValidationError({"status": ["Completed assessments are immutable."]})

    if notes is not None:
        locked_assessment.notes = notes

    if status is not None and status != locked_assessment.status:
        if status == CandidateAssessment.Status.IN_PROGRESS:
            validate_assessment_can_start(locked_assessment)
            locked_assessment.status = CandidateAssessment.Status.IN_PROGRESS
            locked_assessment.started_at = timezone.now()
        elif status == CandidateAssessment.Status.COMPLETED:
            validate_assessment_can_complete(locked_assessment)
            locked_assessment.status = CandidateAssessment.Status.COMPLETED
            locked_assessment.completed_at = timezone.now()
            GradingCandidate.objects.filter(pk=locked_assessment.candidate_id).update(
                status=GradingCandidate.Status.COMPLETED,
                updated_at=timezone.now(),
            )
        else:
            raise ValidationError(
                {
                    "status": [
                        f"Cannot transition assessment from "
                        f"{locked_assessment.status} to {status}.",
                    ],
                },
            )

    locked_assessment.save()
    return locked_assessment


def validate_assessment_item_can_be_changed(
    item: CandidateAssessmentItem,
    *,
    result: str | None,
) -> None:
    assessment = item.assessment
    if assessment.status == CandidateAssessment.Status.COMPLETED:
        raise ValidationError({"assessment": ["Completed assessments are immutable."]})
    if assessment.status == CandidateAssessment.Status.NOT_STARTED:
        raise ValidationError(
            {
                "assessment": [
                    "Assessment must be started before item results can be changed.",
                ],
            },
        )
    if assessment.status not in {
        CandidateAssessment.Status.IN_PROGRESS,
    }:
        raise ValidationError(
            {"assessment": ["Assessment items cannot be changed in this state."]},
        )
    if (
        assessment.candidate.session.status
        not in ASSESSMENT_RESULT_ENTRY_SESSION_STATUSES
    ):
        raise ValidationError(
            {
                "session": [
                    "Assessment results can only be entered in open or locked "
                    "sessions.",
                ],
            },
        )
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot be assessed."]},
        )


@transaction.atomic
def update_candidate_assessment_item(
    item: CandidateAssessmentItem,
    *,
    result: str | None = None,
    assessor_notes: str | None = None,
    assessor: User,
) -> CandidateAssessmentItem:
    locked_item = (
        CandidateAssessmentItem.objects.select_for_update()
        .select_related("assessment__candidate__session", "assessment__candidate")
        .get(pk=item.pk)
    )
    validate_assessment_item_can_be_changed(locked_item, result=result)

    if assessor_notes is not None:
        locked_item.assessor_notes = assessor_notes

    if result is not None and result != locked_item.result:
        if result not in CandidateAssessmentItem.Result.values:
            raise ValidationError({"result": ["Invalid assessment item result."]})
        locked_item.result = result
        if result == CandidateAssessmentItem.Result.NOT_ASSESSED:
            locked_item.assessor = None
            locked_item.assessed_at = None
        else:
            locked_item.assessor = assessor
            locked_item.assessed_at = timezone.now()

    locked_item.save()
    return locked_item
