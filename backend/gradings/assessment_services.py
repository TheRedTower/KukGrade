from __future__ import annotations

from collections.abc import Sequence

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.db.models import Max
from django.utils import timezone

from accounts.models import User
from accounts.permissions import FINAL_GRADING_DECISION_PERMISSION
from audit.models import AuditAction
from audit.recording import grading_context, record, student_label
from gradings.locking import (
    lock_assessment,
    lock_candidate,
    lock_item,
    lock_sessions_of,
    require_pinned,
)
from gradings.models import (
    AssessmentItemComment,
    AssessmentItemResultChange,
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
)
from gradings.service_support import each_independently, unique_violation_on
from syllabus.models import AgeBand
from syllabus.services import (
    EffectiveSyllabusRequirement,
    effective_syllabus_requirements,
)

ASSESSMENT_HOLDS_FINAL_DECISION = (
    "This assessment holds a final decision, which is never erased."
)

STUDENT_DELETED_MESSAGE = (
    "This student has been deleted, so their assessment is kept as recorded."
)
ALREADY_HAS_FORM_MESSAGE = "This candidate already has an assessment form."
WITHDRAWN_MESSAGE = "Withdrawn candidates cannot be assessed."
MARK_STARTED_MESSAGE = "Assessment must be started before item results can be changed."
MARK_CLOSED_MESSAGE = "Assessment results can only be entered in an open session."
COMMENT_STARTED_MESSAGE = (
    "Assessment must be started before an item can be commented on."
)
COMMENT_CLOSED_MESSAGE = "Items can only be commented on in an open session."


def holds_final_decision(candidate: GradingCandidate) -> bool:
    """Whether the candidate's final decision is recorded. Read through the
    candidate, which a list already joins (one outcome per candidate, the same
    row as their assessment's)."""
    outcome = getattr(candidate, "outcome", None)
    return outcome is not None and outcome.status == CandidateOutcome.Status.FINALISED


def _status_label(status: str) -> str:
    return str(CandidateAssessment.Status(status).label).lower()


def _result_label(result: str) -> str:
    """A mark as the screens name it ("Met"), for an audit summary."""
    return str(CandidateAssessmentItem.Result(result).label)


@transaction.atomic
def delete_candidate_assessment(
    assessment: CandidateAssessment,
    actor: User,
) -> None:
    """Hard-delete an assessment, for test data or a grading prepared in error.

    A recorded final decision is never erased, by anyone, as for a session
    (`session_deletion_blocker`): an assessment whose outcome is finalised is
    refused, so no promotion is ever undone and no rank rolled back here. A
    proposal is removed with it. A proposal refuses ordinary delete(), so it
    goes through the unbound base QuerySet.delete, the one sanctioned bypass
    (administrator-gated, see accounts.groups._DATA_CLEANUP_PERMISSIONS).
    """
    locked = lock_assessment(assessment.pk)
    outcome = getattr(locked, "outcome", None)
    if holds_final_decision(locked.candidate):
        raise ValidationError({"assessment": [ASSESSMENT_HOLDS_FINAL_DECISION]})
    if outcome is not None:
        models.QuerySet.delete(CandidateOutcome.objects.filter(pk=outcome.pk))

    record(
        AuditAction.ASSESSMENT_DELETED,
        locked,
        (
            f"Assessment for {student_label(locked.candidate.student)} in "
            f"'{locked.candidate.session.title}' deleted while "
            f"{_status_label(locked.status)}."
        ),
        actor=actor,
        metadata={
            "status": locked.status,
            "had_outcome": outcome is not None,
            **grading_context(locked.candidate),
        },
    )
    locked.delete()
    # A candidate is COMPLETED only through its assessment, so without one it
    # is registered again, as it was before the assessment. In a draft or open
    # session a new assessment can then be prepared; once the session is locked
    # one cannot, and the candidate is resolved by an authorised withdrawal.
    GradingCandidate.objects.filter(
        pk=locked.candidate_id,
        status=GradingCandidate.Status.COMPLETED,
    ).update(status=GradingCandidate.Status.REGISTERED, updated_at=timezone.now())


def validate_assessment_generation_candidate(candidate: GradingCandidate) -> None:
    if not candidate.session.roster_open:
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


def assessment_can_be_prepared(candidate: GradingCandidate) -> bool:
    """Whether this candidate's assessment form can be prepared now: they
    have none yet, and the generation's own rule allows it."""
    if getattr(candidate, "assessment", None) is not None:
        return False
    try:
        validate_assessment_generation_candidate(candidate)
    except ValidationError:
        return False
    return True


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
        notation=effective.notation,
    )


@transaction.atomic
def generate_candidate_assessment(
    candidate: GradingCandidate,
    generated_by: User,
) -> CandidateAssessment:
    locked_candidate = lock_candidate(candidate.pk)
    validate_assessment_generation_candidate(locked_candidate)
    if hasattr(locked_candidate, "assessment"):
        raise ValidationError(
            {"candidate": [ALREADY_HAS_FORM_MESSAGE]},
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
            {"candidate": [ALREADY_HAS_FORM_MESSAGE]},
        ) from exc
    record(
        AuditAction.ASSESSMENT_GENERATED,
        assessment,
        (
            f"Assessment generated for {student_label(locked_candidate.student)} with "
            f"{len(requirements)} requirements."
        ),
        actor=generated_by,
        metadata={
            "item_count": len(requirements),
            **grading_context(locked_candidate),
        },
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

    return each_independently(candidates, generate, key=lambda candidate: candidate.pk)


def validate_assessment_can_start(assessment: CandidateAssessment) -> None:
    if assessment.status != CandidateAssessment.Status.NOT_STARTED:
        raise ValidationError(
            {"status": ["Only not-started assessments can be started."]},
        )
    if not assessment.candidate.session.marking_open:
        raise ValidationError(
            {"session": ["Assessments can only be started in open sessions."]},
        )
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": [WITHDRAWN_MESSAGE]},
        )


def assessment_can_start(assessment: CandidateAssessment) -> bool:
    try:
        validate_assessment_can_start(assessment)
    except ValidationError:
        return False
    return True


def validate_assessment_can_complete(
    assessment: CandidateAssessment,
    *,
    required_not_assessed: int | None = None,
) -> None:
    """Whether the assessment may be completed now. `required_not_assessed`
    is the count when the caller already holds it (the served summary)."""
    if assessment.status != CandidateAssessment.Status.IN_PROGRESS:
        raise ValidationError(
            {"status": ["Only in-progress assessments can be completed."]},
        )
    if not assessment.candidate.session.marking_open:
        raise ValidationError(
            {"session": ["Assessments can only be completed in an open session."]},
        )
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot be completed."]},
        )
    missing_required_result = (
        assessment.items.filter(
            required=True,
            result=CandidateAssessmentItem.Result.NOT_ASSESSED,
        ).exists()
        if required_not_assessed is None
        else required_not_assessed > 0
    )
    if missing_required_result:
        raise ValidationError(
            {
                "items": [
                    "Every required assessment item must be assessed before "
                    "completion.",
                ],
            },
        )


def assessment_can_complete(
    assessment: CandidateAssessment,
    *,
    required_not_assessed: int,
) -> bool:
    try:
        validate_assessment_can_complete(
            assessment,
            required_not_assessed=required_not_assessed,
        )
    except ValidationError:
        return False
    return True


@transaction.atomic
def update_candidate_assessment(
    assessment: CandidateAssessment,
    *,
    status: str | None = None,
    notes: str | None = None,
    actor: User | None = None,
) -> CandidateAssessment:
    locked_assessment = lock_assessment(assessment.pk)
    if locked_assessment.status == CandidateAssessment.Status.COMPLETED:
        raise ValidationError({"status": ["A completed assessment cannot be changed."]})
    if locked_assessment.candidate.student.deleted_at is not None:
        raise ValidationError({"student": [STUDENT_DELETED_MESSAGE]})

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
                        f"An assessment that is "
                        f"{_status_label(locked_assessment.status)} cannot become "
                        f"{_status_label(status)}.",
                    ],
                },
            )

    if recorded_action is None:
        # Nothing changed: a resent value writes and records nothing.
        return locked_assessment
    locked_assessment.save()
    if recorded_action == AuditAction.ASSESSMENT_UPDATED:
        summary = (
            "Assessment notes for "
            f"{student_label(locked_assessment.candidate.student)} updated."
        )
    else:
        summary = (
            f"Assessment for {student_label(locked_assessment.candidate.student)} "
            f"{locked_assessment.get_status_display().lower()}."
        )
    # Like an item's notes, the overall observation is a written judgement:
    # a change keeps both versions, so it cannot be silently rewritten.
    record(
        recorded_action,
        locked_assessment,
        summary,
        actor=actor,
        metadata={
            **grading_context(locked_assessment.candidate),
            **(
                {
                    "before": {"notes": previous_notes},
                    "after": {"notes": locked_assessment.notes},
                }
                if notes_changed
                else {}
            ),
        },
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

    return each_independently(assessments, start, key=lambda assessment: assessment.pk)


def _validate_assessment_open_for_item_work(
    assessment: CandidateAssessment,
    actor: User,
    *,
    started_message: str,
    closed_message: str,
) -> None:
    """Whether `actor` may change a mark or comment on this assessment's items.

    While the session is open, anyone who marks may, whether or not the
    assessment has been completed (a completed one is corrected with a reason,
    not reopened). Once it is locked, only the authorised Master may, and only
    until that candidate's final decision is recorded: after that the record
    is fixed. The session lock is held by every caller, so the outcome read
    here cannot change under it.
    """
    if assessment.status == CandidateAssessment.Status.NOT_STARTED:
        raise ValidationError({"assessment": [started_message]})
    if assessment.candidate.student.deleted_at is not None:
        # A deleted student's assessment is kept as recorded, never changed.
        raise ValidationError({"student": [STUDENT_DELETED_MESSAGE]})
    session = assessment.candidate.session
    if session.is_locked:
        if not actor.has_perm(FINAL_GRADING_DECISION_PERMISSION):
            raise ValidationError(
                {
                    "session": [
                        "Once a session is locked, only the authorised Master "
                        "can correct a result or comment on one.",
                    ],
                },
            )
        if holds_final_decision(assessment.candidate):
            raise ValidationError(
                {
                    "candidate": [
                        "This candidate's final decision has been recorded, "
                        "so their record is fixed.",
                    ],
                },
            )
    elif not session.marking_open:
        raise ValidationError({"session": [closed_message]})
    if assessment.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": [WITHDRAWN_MESSAGE]},
        )


def validate_assessment_item_can_be_changed(
    item: CandidateAssessmentItem,
    actor: User,
) -> None:
    _validate_assessment_open_for_item_work(
        item.assessment,
        actor,
        started_message=MARK_STARTED_MESSAGE,
        closed_message=MARK_CLOSED_MESSAGE,
    )


def assessment_marks_open(assessment: CandidateAssessment, actor: User) -> bool:
    """Whether `actor` may change marks, or comment, on this assessment now.

    The screens ask this rather than working it out, so the rule lives only
    here. It is the same check the writes make.
    """
    try:
        _validate_assessment_open_for_item_work(
            assessment,
            actor,
            started_message=MARK_STARTED_MESSAGE,
            closed_message=MARK_CLOSED_MESSAGE,
        )
    except ValidationError:
        return False
    return True


def _is_later_change(
    item: CandidateAssessmentItem,
    *,
    has_changes: bool | None,
) -> bool:
    """Not the item's first change: it is marked, or has been and was cleared.
    `has_changes` is given when the caller already holds the item's log."""
    if item.result != CandidateAssessmentItem.Result.NOT_ASSESSED:
        return True
    return item.changes.exists() if has_changes is None else has_changes


def item_change_needs_reason(
    item: CandidateAssessmentItem,
    *,
    has_changes: bool | None = None,
) -> bool:
    """Whether the next change to this item's mark must say why: every change
    after the first does, and after the lock every one does, the first mark
    included."""
    return (
        _is_later_change(item, has_changes=has_changes)
        or item.assessment.candidate.session.is_locked
    )


def item_mark_can_be_cleared(item: CandidateAssessmentItem) -> bool:
    """Whether the item's mark may be taken away: it has one, and a completed
    assessment keeps every required item marked - changed, not emptied."""
    return item.result != CandidateAssessmentItem.Result.NOT_ASSESSED and not (
        item.required and item.assessment.status == CandidateAssessment.Status.COMPLETED
    )


@transaction.atomic
def update_candidate_assessment_item(
    item: CandidateAssessmentItem,
    *,
    result: str | None = None,
    reason: str = "",
    assessor: User,
) -> CandidateAssessmentItem:
    """Mark an item, or change or clear its mark, and keep how it changed.

    The first mark needs no reason. Every later change does: switching it,
    clearing it, marking it again after it was cleared, and including a person
    changing their own mark. It is judged against the item as it stands now,
    so a screen that still shows an item as unmarked cannot quietly overwrite
    what someone else has marked since.
    """
    locked_item = lock_item(item.pk)
    validate_assessment_item_can_be_changed(locked_item, assessor)
    previous_result = locked_item.result
    # A call that changes nothing writes and records nothing.
    if result is None or result == previous_result:
        return locked_item
    if result not in CandidateAssessmentItem.Result.values:
        raise ValidationError({"result": ["That is not a valid result."]})
    reason = (reason or "").strip()
    is_later_change = _is_later_change(locked_item, has_changes=None)
    after_lock = locked_item.assessment.candidate.session.is_locked
    if item_change_needs_reason(locked_item) and not reason:
        raise ValidationError({"reason": ["Say why the mark is changing."]})
    if (
        result == CandidateAssessmentItem.Result.NOT_ASSESSED
        and not item_mark_can_be_cleared(locked_item)
    ):
        raise ValidationError(
            {
                "result": [
                    "A completed assessment must keep every required item marked.",
                ],
            },
        )

    locked_item.result = result
    if result == CandidateAssessmentItem.Result.NOT_ASSESSED:
        locked_item.assessor = None
        locked_item.assessed_at = None
    else:
        locked_item.assessor = assessor
        locked_item.assessed_at = timezone.now()
    locked_item.save()
    last = AssessmentItemResultChange.objects.filter(item=locked_item).aggregate(
        last=Max("sequence"),
    )["last"]
    change = AssessmentItemResultChange.objects.create(
        item=locked_item,
        sequence=(last or 0) + 1,
        from_result=previous_result,
        to_result=result,
        changed_by=assessor,
        reason=reason,
        after_lock=after_lock,
    )
    # The reason stays in the change log, not the audit trail, which records
    # that the mark changed, by whom and from what to what.
    record(
        AuditAction.ITEM_RESULT_RECORDED,
        locked_item,
        (
            f"{locked_item.item_name} changed from {_result_label(previous_result)} "
            f"to {_result_label(result)} "
            f"for {student_label(locked_item.assessment.candidate.student)}."
            if is_later_change
            else f"{locked_item.item_name} recorded as {_result_label(result)} "
            f"for {student_label(locked_item.assessment.candidate.student)}."
        ),
        actor=assessor,
        metadata={
            "before": {"result": previous_result},
            "after": {"result": locked_item.result},
            "change": str(change.pk),
            "after_lock": after_lock,
            "assessment": str(locked_item.assessment_id),
            **grading_context(locked_item.assessment.candidate),
        },
    )
    return locked_item


def validate_item_can_be_commented(item: CandidateAssessmentItem, author: User) -> None:
    """Comments are for deliberating, so they stay open after the assessment is
    completed, for as long as marks can change: the same rule."""
    _validate_assessment_open_for_item_work(
        item.assessment,
        author,
        started_message=COMMENT_STARTED_MESSAGE,
        closed_message=COMMENT_CLOSED_MESSAGE,
    )


@transaction.atomic
def add_item_comment(
    item: CandidateAssessmentItem,
    body: str,
    author: User,
) -> AssessmentItemComment:
    locked_item = lock_item(item.pk)
    validate_item_can_be_commented(locked_item, author)
    after_lock = locked_item.assessment.candidate.session.is_locked
    comment = AssessmentItemComment.objects.create(
        item=locked_item,
        author=author,
        body=body,
        after_lock=after_lock,
    )
    # The words stay in the comment, not the audit trail, which records that
    # one was written, by whom and where.
    record(
        AuditAction.ITEM_COMMENT_ADDED,
        locked_item,
        f"Comment added on {locked_item.item_name} "
        f"for {student_label(locked_item.assessment.candidate.student)}.",
        actor=author,
        metadata={
            "comment": str(comment.pk),
            "after_lock": after_lock,
            "assessment": str(locked_item.assessment_id),
            **grading_context(locked_item.assessment.candidate),
        },
    )
    return comment
