from __future__ import annotations

from collections.abc import Sequence

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record
from gradings.locking import (
    lock_in_session,
    lock_sessions_of,
    lock_student,
    require_pinned,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.service_support import each_independently, unique_violation_on
from students.models import Student
from syllabus.models import AgeBand
from syllabus.services import (
    EffectiveSyllabusRequirement,
    effective_syllabus_requirements,
)

ASSESSMENT_GENERATION_SESSION_STATUSES = {
    GradingSession.Status.DRAFT,
    GradingSession.Status.OPEN,
}


def validate_assessment_deletion_promotion(
    promotion: Promotion,
    student: Student,
) -> None:
    if promotion.to_rank_id != student.current_rank_id:
        raise ValidationError(
            {
                "promotion": [
                    "This promotion is no longer the student's most recent "
                    "promotion - the student has since been promoted again. "
                    "Delete that later promotion's assessment first.",
                ],
            },
        )


@transaction.atomic
def delete_candidate_assessment(
    assessment: CandidateAssessment,
    actor: User,
) -> None:
    """Hard-delete an assessment, for test-data or bad-grading cleanup only.

    Cascades through the assessment's outcome and promotion, if either
    exists, and reverts the student's rank when a promotion is undone.
    `CandidateOutcome.delete()` refuses a finalised outcome, and `Promotion`
    refuses unconditionally at both the instance *and* queryset level
    (`PromotionQuerySet.delete()`, gradings/models.py) - deliberately, so an
    ordinary caller cannot casually erase a decision. This is the one
    sanctioned bypass of both guards, administrator-gated (see
    accounts.groups._DATA_CLEANUP_PERMISSIONS):

    - `CandidateOutcome.objects.filter(...).delete()` goes through Django's
      default `QuerySet.delete()`, which never calls a model's overridden
      instance `delete()`, so the FINALISED guard is simply never reached.
    - `Promotion` closes exactly that loophole with its own queryset
      override, so the same trick does not work there. Deleting a promotion
      here instead calls `models.QuerySet.delete` directly - the real,
      unbound base implementation - bypassing `PromotionQuerySet.delete()`
      on purpose rather than by omission.
    """
    locked = lock_in_session(
        CandidateAssessment.objects.select_related(
            "candidate__student",
            "candidate__session",
        ),
        assessment.pk,
        session_path="candidate__session_id",
        name="assessment",
    )
    outcome = getattr(locked, "outcome", None)
    promotion = getattr(outcome, "promotion", None) if outcome else None

    reverted_rank: dict[str, str] | None = None
    if promotion is not None:
        # Locked and re-read, not taken from the join above: a promotion from
        # another session can move the student on at any moment, and rolling
        # back to this one's from_rank would then overwrite it (KG-A04).
        student = lock_student(locked.candidate.student_id)
        validate_assessment_deletion_promotion(promotion, student)
        reverted_rank = {"from": promotion.to_rank.code, "to": promotion.from_rank.code}
        Student.objects.filter(pk=student.pk).update(current_rank=promotion.from_rank)
        models.QuerySet.delete(Promotion.objects.filter(pk=promotion.pk))

    if outcome is not None:
        CandidateOutcome.objects.filter(pk=outcome.pk).delete()

    record(
        AuditAction.ASSESSMENT_DELETED,
        locked,
        (
            f"Assessment for {locked.candidate.student} in "
            f"'{locked.candidate.session.title}' deleted while {locked.status}."
        ),
        actor=actor,
        metadata={
            "status": locked.status,
            "had_outcome": outcome is not None,
            "had_promotion": promotion is not None,
            "reverted_student_rank": reverted_rank,
        },
    )
    locked.delete()


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
    effective: EffectiveSyllabusRequirement,
    position: int,
) -> CandidateAssessmentItem:
    requirement = effective.requirement
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
        position=position,
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
    locked_candidate = lock_in_session(
        GradingCandidate.objects.select_related(
            "session", "student", "testing_for_rank"
        ),
        candidate.pk,
        session_path="session_id",
        name="candidate",
    )
    validate_assessment_generation_candidate(locked_candidate)
    if hasattr(locked_candidate, "assessment"):
        raise ValidationError(
            {"candidate": ["Candidate already has an assessment snapshot."]},
        )

    # The cumulative syllabus, exactly as the syllabus screen shows it: every
    # grading assesses everything examinable through the testing rank.
    requirements = effective_syllabus_requirements(
        rank=locked_candidate.testing_for_rank,
        age_band=locked_candidate.age_band,
    )
    if not requirements:
        raise ValidationError(
            {
                "candidate": [
                    f"No syllabus is recorded for "
                    f"{locked_candidate.testing_for_rank.name} "
                    f"({AgeBand(locked_candidate.age_band).label}), so this "
                    "candidate cannot be assessed yet.",
                ],
            },
        )

    try:
        assessment = CandidateAssessment.objects.create(
            candidate=locked_candidate,
            generated_by=generated_by,
        )
        CandidateAssessmentItem.objects.bulk_create(
            [
                _snapshot_item(
                    assessment=assessment,
                    effective=effective,
                    position=position,
                )
                for position, effective in enumerate(requirements, start=1)
            ],
        )
    except IntegrityError as exc:
        # Only a second assessment for this candidate is expected here. A
        # clash inside the item snapshot is a defect in the syllabus data
        # and propagates as one.
        if not unique_violation_on(exc, CandidateAssessment):
            raise
        raise ValidationError(
            {"candidate": ["Candidate already has an assessment snapshot."]},
        ) from exc
    record(
        AuditAction.ASSESSMENT_GENERATED,
        assessment,
        (
            f"Assessment generated for {locked_candidate.student} with "
            f"{len(requirements)} requirements."
        ),
        actor=generated_by,
        metadata={"item_count": len(requirements)},
    )
    return assessment


@transaction.atomic
def bulk_generate_candidate_assessments(
    *,
    candidates: Sequence[GradingCandidate],
    generated_by: User,
) -> tuple[list[CandidateAssessment], dict[str, list[str]]]:
    """Generate an assessment for every candidate, independently of the others.

    One candidate's assessment already existing does not block generation
    for the rest of the batch.
    """
    pinned = lock_sessions_of(
        GradingCandidate,
        [candidate.pk for candidate in candidates],
        "session_id",
    )

    def generate(candidate: GradingCandidate) -> CandidateAssessment:
        require_pinned(candidate.pk, pinned, "candidate")
        return generate_candidate_assessment(candidate, generated_by)

    return each_independently(candidates, generate)


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
    if assessment.candidate.session.status != GradingSession.Status.OPEN:
        raise ValidationError(
            {"session": ["Assessments can only be completed in an open session."]},
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
    actor: User | None = None,
) -> CandidateAssessment:
    locked_assessment = lock_in_session(
        CandidateAssessment.objects.select_related(
            "candidate__session",
            "candidate__student",
        ),
        assessment.pk,
        session_path="candidate__session_id",
        name="assessment",
    )
    if locked_assessment.status == CandidateAssessment.Status.COMPLETED:
        raise ValidationError({"status": ["Completed assessments are immutable."]})

    previous_notes = locked_assessment.notes
    if notes is not None:
        # Stripped as clean() will, so whitespace alone is not a change.
        locked_assessment.notes = notes.strip()
    notes_changed = locked_assessment.notes != previous_notes

    recorded_action: str | None = (
        AuditAction.ASSESSMENT_UPDATED if notes_changed else None
    )
    if status is not None and status != locked_assessment.status:
        if status == CandidateAssessment.Status.IN_PROGRESS:
            recorded_action = AuditAction.ASSESSMENT_STARTED
            validate_assessment_can_start(locked_assessment)
            locked_assessment.status = CandidateAssessment.Status.IN_PROGRESS
            locked_assessment.started_at = timezone.now()
        elif status == CandidateAssessment.Status.COMPLETED:
            recorded_action = AuditAction.ASSESSMENT_COMPLETED
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

    if recorded_action is None:
        # Nothing changed: a resent value writes and records nothing.
        return locked_assessment
    locked_assessment.save()
    if recorded_action == AuditAction.ASSESSMENT_UPDATED:
        summary = f"Assessment notes for {locked_assessment.candidate.student} updated."
    else:
        summary = (
            f"Assessment for {locked_assessment.candidate.student} "
            f"{locked_assessment.get_status_display().lower()}."
        )
    # Like an item's notes, the overall observation is a written judgement:
    # a change keeps both versions, so it cannot be silently rewritten.
    record(
        recorded_action,
        locked_assessment,
        summary,
        actor=actor,
        metadata=(
            {
                "before": {"notes": previous_notes},
                "after": {"notes": locked_assessment.notes},
            }
            if notes_changed
            else {}
        ),
    )
    return locked_assessment


@transaction.atomic
def reopen_candidate_assessment(
    assessment: CandidateAssessment,
    actor: User,
) -> CandidateAssessment:
    """Return a completed assessment to in-progress for correction.

    Only while the session is still open: locking is the point after which
    the record is final. The candidate goes back to registered until the
    assessment is completed again. Item results and their attribution are
    kept exactly as recorded.
    """
    locked_assessment = lock_in_session(
        CandidateAssessment.objects.select_related(
            "candidate__session",
            "candidate__student",
        ),
        assessment.pk,
        session_path="candidate__session_id",
        name="assessment",
    )
    if locked_assessment.status != CandidateAssessment.Status.COMPLETED:
        raise ValidationError(
            {"status": ["Only a completed assessment can be reopened."]},
        )
    if locked_assessment.candidate.session.status != GradingSession.Status.OPEN:
        raise ValidationError(
            {
                "session": [
                    "An assessment can only be reopened while its session is open.",
                ],
            },
        )

    completed_at = locked_assessment.completed_at
    locked_assessment.status = CandidateAssessment.Status.IN_PROGRESS
    locked_assessment.completed_at = None
    locked_assessment.save()
    GradingCandidate.objects.filter(pk=locked_assessment.candidate_id).update(
        status=GradingCandidate.Status.REGISTERED,
        updated_at=timezone.now(),
    )
    record(
        AuditAction.ASSESSMENT_REOPENED,
        locked_assessment,
        (
            f"Assessment for {locked_assessment.candidate.student} "
            "reopened for correction."
        ),
        actor=actor,
        metadata={"completed_at": completed_at.isoformat() if completed_at else None},
    )
    return locked_assessment


@transaction.atomic
def bulk_start_candidate_assessments(
    *,
    assessments: Sequence[CandidateAssessment],
    actor: User | None = None,
) -> tuple[list[CandidateAssessment], dict[str, list[str]]]:
    """Start every assessment, independently of the others.

    A separate, optional action - not bundled into registration or
    generation, so starting assessments in bulk is always a deliberate
    choice rather than a side effect of adding candidates or generating
    their snapshots. One assessment already started, or its session having
    since locked, does not block the rest.
    """
    pinned = lock_sessions_of(
        CandidateAssessment,
        [assessment.pk for assessment in assessments],
        "candidate__session_id",
    )

    def start(assessment: CandidateAssessment) -> CandidateAssessment:
        require_pinned(assessment.pk, pinned, "assessment")
        return update_candidate_assessment(
            assessment,
            status=CandidateAssessment.Status.IN_PROGRESS,
            actor=actor,
        )

    return each_independently(assessments, start)


def validate_assessment_item_can_be_changed(item: CandidateAssessmentItem) -> None:
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
    if assessment.candidate.session.status != GradingSession.Status.OPEN:
        raise ValidationError(
            {"session": ["Assessment results can only be entered in an open session."]},
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
    locked_item = lock_in_session(
        CandidateAssessmentItem.objects.select_related(
            "assessment__candidate__session",
        ),
        item.pk,
        session_path="assessment__candidate__session_id",
        name="item",
    )
    validate_assessment_item_can_be_changed(locked_item)
    previous_result = locked_item.result
    previous_notes = locked_item.assessor_notes

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

    result_changed = result is not None and result != previous_result
    notes_changed = assessor_notes is not None and assessor_notes != previous_notes
    # One event per call covering whatever changed, not one per field - a
    # notes-only edit used to record nothing at all, which meant the
    # written judgement about a candidate could be silently rewritten.
    if result_changed or notes_changed:
        record(
            AuditAction.ITEM_RESULT_RECORDED,
            locked_item,
            (
                f"{locked_item.item_name} recorded as {result}."
                if result_changed
                else f"{locked_item.item_name} assessor notes updated."
            ),
            actor=assessor,
            metadata={
                "before": {"result": previous_result, "assessor_notes": previous_notes},
                "after": {
                    "result": locked_item.result,
                    "assessor_notes": locked_item.assessor_notes,
                },
                "assessment": str(locked_item.assessment_id),
            },
        )
    return locked_item
