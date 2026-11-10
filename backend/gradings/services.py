from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any, cast

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.db.models import (
    Count,
    Exists,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
)
from django.db.models.functions import Coalesce
from django.utils import timezone

from accounts.models import User
from accounts.permissions import (
    DELETE_ANY_SESSION_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
)
from audit.models import AuditAction
from audit.recording import grading_context, record, student_label
from gradings.assessment_services import (
    generate_candidate_assessment,
)
from gradings.locking import (
    STUDENT_GONE_MESSAGE,
    lock_candidate,
    lock_session,
    lock_sessions_of,
    lock_student,
    lock_students,
    require_pinned,
)
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    StagedDecision,
)
from gradings.service_support import each_independently, unique_violation_on
from ranks.models import Rank
from students.models import Student
from syllabus.age import resolve_age_band
from syllabus.models import AgeBand
from syllabus.services import has_recorded_syllabus, rank_has_syllabus

ALREADY_REGISTERED_MESSAGE = "Student is already registered for this session."
# The codes on the two "already registered" refusals - for this session, or
# for another that has not settled - which a cohort builder does not retry.
ALREADY_IN_SESSION = "already_in_session"
REGISTERED_ELSEWHERE = "registered_elsewhere"

NO_NEXT_RANK_MESSAGE = "Student has no next active rank."
COMPLETED_BY_ASSESSMENT_MESSAGE = (
    "A candidate is completed by completing their assessment."
)
WITHDRAWAL_REASON_REQUIRED_MESSAGE = "A reason is required to withdraw a candidate."


class AlreadyRegistered(models.TextChoices):
    """Where a bulk registration row's student is already registered."""

    THIS_SESSION = "THIS_SESSION", "For this session"
    ANOTHER_GRADING = "ANOTHER_GRADING", "For another grading not yet settled"


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
        # An abandoned grading needs somewhere to go. Without this a locked
        # session could only ever be completed, so a candidate who could not
        # finish blocked it permanently.
        GradingSession.Status.CANCELLED,
    },
    GradingSession.Status.COMPLETED: set(),
    GradingSession.Status.CANCELLED: set(),
}


def get_next_active_rank(current_rank: Rank) -> Rank | None:
    return Rank.objects.next_active_after(current_rank.order).first()


def ranks_open_for_grading(age_band: str) -> list[int]:
    """The ranks whose students of `age_band` can be registered for a grading:
    those whose next rank has a syllabus recorded for that band. While the
    charts above Jo Kyo Nim are not in the app, a Jo Kyo Nim student has
    nothing to be graded on."""
    with_syllabus = set(
        Rank.objects.filter(rank_has_syllabus(age_band)).values_list("pk", flat=True),
    )
    return [
        current
        for current, following in Rank.objects.filter(active=True)
        .next_rank_ids()
        .items()
        if following in with_syllabus
    ]


def validate_student_not_deleted(student: Student) -> None:
    if student.deleted_at is not None:
        raise ValidationError(
            {"student": ["This student has been deleted and cannot be registered."]},
        )


def validate_student_can_be_graded(student: Student) -> None:
    validate_student_not_deleted(student)
    if not student.can_be_graded:
        raise ValidationError(
            {
                "student": [
                    "This student has left and cannot be registered for a "
                    "grading. Set their status back to active or inactive first.",
                ],
            },
        )


def validate_testing_for_rank(
    student: Student,
    testing_for_rank: Rank,
    grading_date: date,
) -> None:
    next_rank = get_next_active_rank(student.current_rank)
    if next_rank is None:
        raise ValidationError(
            {"testing_for_rank": [NO_NEXT_RANK_MESSAGE]},
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
    age_band = resolve_age_band(student.date_of_birth, grading_date)
    if not has_recorded_syllabus(testing_for_rank, age_band):
        if has_recorded_syllabus(testing_for_rank):
            raise ValidationError(
                {
                    "testing_for_rank": [
                        f"No syllabus is recorded for {testing_for_rank.name} "
                        f"in the {AgeBand(age_band).label} age band yet, so "
                        "this student cannot be graded for it.",
                    ],
                },
            )
        raise ValidationError(
            {
                "testing_for_rank": [
                    f"No syllabus is recorded for {testing_for_rank.name} yet, "
                    "so nobody can be graded for it.",
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
                    f"A {GradingSession.Status(current_status).label.lower()} "
                    f"session cannot become "
                    f"{GradingSession.Status(next_status).label.lower()}.",
                ],
            },
        )
    if session is None:
        return
    if (
        current_status == GradingSession.Status.OPEN
        and next_status == GradingSession.Status.LOCKED
    ):
        # Locking ends grading: every result is recorded first, and the
        # session stays open for corrections until the instructors are done.
        incomplete = (
            session.candidates.exclude(status=GradingCandidate.Status.WITHDRAWN)
            .exclude(assessment__status=CandidateAssessment.Status.COMPLETED)
            .exists()
        )
        if incomplete:
            raise ValidationError(
                {
                    "status": [
                        "Every non-withdrawn candidate's assessment must be "
                        "completed before the session can be locked.",
                    ],
                },
            )
    if (
        current_status == GradingSession.Status.LOCKED
        and next_status == GradingSession.Status.CANCELLED
    ):
        # A final decision is a record of the grading: cancelling would leave
        # a cancelled grading that decided (and promoted) students. A candidate
        # who cannot be decided is withdrawn instead.
        decided = session.candidates.filter(
            outcome__status=CandidateOutcome.Status.FINALISED,
        ).exists()
        if decided:
            raise ValidationError(
                {
                    "status": [
                        "A session with a final decision cannot be cancelled. "
                        "Withdraw the candidates who cannot be decided instead.",
                    ],
                },
            )
    if (
        current_status == GradingSession.Status.LOCKED
        and next_status == GradingSession.Status.COMPLETED
    ):
        missing_finalised_outcome = (
            session.candidates.exclude(status=GradingCandidate.Status.WITHDRAWN)
            .filter(
                Q(assessment__isnull=True)
                | ~Q(assessment__status=CandidateAssessment.Status.COMPLETED)
                | Q(outcome__isnull=True)
                | ~Q(outcome__status=CandidateOutcome.Status.FINALISED),
            )
            .exists()
        )
        if missing_finalised_outcome:
            raise ValidationError(
                {
                    "status": [
                        "Every non-withdrawn candidate must have a completed "
                        "assessment and finalised outcome before the session "
                        "can be completed.",
                    ],
                },
            )


def validate_locked_session_override_actor(actor: User | None) -> None:
    if actor is None or not actor.has_perm(OVERRIDE_LOCKED_SESSION_PERMISSION):
        raise ValidationError(
            {"actor": ["Locked session override authority is required."]}
        )


@transaction.atomic
def transition_grading_session(
    session: GradingSession,
    target_status: str,
    actor: User | None = None,
    reason: str = "",
) -> GradingSession:
    if session.pk is None:
        raise ValidationError(
            {"status": ["Unsaved grading sessions cannot be transitioned."]},
        )
    locked_session = lock_session(session.pk)
    if locked_session.status == target_status:
        return locked_session

    validate_session_transition(
        locked_session.status,
        target_status,
        session=locked_session,
    )

    cancellation_reason = locked_session.cancellation_reason
    abandoning_a_locked_session = (
        locked_session.status == GradingSession.Status.LOCKED
        and target_status == GradingSession.Status.CANCELLED
    )
    if abandoning_a_locked_session:
        # Candidates have already been assessed here, so this needs both
        # authority and a recorded justification.
        validate_locked_session_override_actor(actor)
        cancellation_reason = (reason or "").strip()
        if not cancellation_reason:
            raise ValidationError(
                {
                    "cancellation_reason": [
                        "A reason is required to cancel a locked grading session.",
                    ],
                },
            )

    previous_status = locked_session.status
    if previous_status == GradingSession.Status.LOCKED:
        # Completed or cancelled: what was staged there can no longer be recorded.
        StagedDecision.objects.filter(
            outcome__candidate__session=locked_session,
        ).delete()
    locked_session.status = target_status
    locked_session.cancellation_reason = cancellation_reason
    locked_session.updated_at = timezone.now()
    GradingSession.objects.filter(pk=locked_session.pk).update(
        status=locked_session.status,
        cancellation_reason=locked_session.cancellation_reason,
        updated_at=locked_session.updated_at,
    )
    record(
        AuditAction.SESSION_TRANSITIONED,
        locked_session,
        f"Grading session moved from {previous_status} to {target_status}.",
        actor=actor,
        metadata={
            "before": {"status": previous_status},
            "after": {
                "status": target_status,
                "cancellation_reason": cancellation_reason,
            },
        },
    )
    return locked_session


def _session_started_work(
    session_pk: Any,
) -> QuerySet[GradingCandidate]:
    """Candidates of the session whose assessment has been started."""
    return (
        GradingCandidate.objects.filter(session=session_pk)
        .filter(assessment__isnull=False)
        .exclude(assessment__status=CandidateAssessment.Status.NOT_STARTED)
    )


def _session_final_decisions(
    session_pk: Any,
) -> QuerySet[CandidateOutcome]:
    """The session's recorded final decisions."""
    return CandidateOutcome.objects.filter(
        candidate__session=session_pk,
        status=CandidateOutcome.Status.FINALISED,
    )


def with_session_progress(
    sessions: QuerySet[GradingSession],
) -> QuerySet[GradingSession]:
    """Each session's progress, defined once for every screen.

    Counted in the database, so a cohort larger than a page is counted in
    full. A withdrawn candidate counts in none of the three: they are not
    being assessed. Awaiting a final decision means an assessment is
    complete and its outcome, if any, is not yet finalised.
    """
    active = GradingCandidate.objects.filter(session=OuterRef("pk")).exclude(
        status=GradingCandidate.Status.WITHDRAWN,
    )
    completed = active.filter(
        assessment__status=CandidateAssessment.Status.COMPLETED,
    )

    def count(candidates: QuerySet[GradingCandidate]) -> Coalesce:
        per_session = (
            candidates.order_by()
            .values("session")
            .annotate(total=Count("pk"))
            .values("total")
        )
        return Coalesce(Subquery(per_session), 0)

    return sessions.annotate(
        has_recorded_work=Exists(_session_started_work(OuterRef("pk"))),
        has_final_decisions=Exists(_session_final_decisions(OuterRef("pk"))),
        candidate_count=count(active),
        completed_assessment_count=count(completed),
        awaiting_decision_count=count(
            completed.exclude(outcome__status=CandidateOutcome.Status.FINALISED),
        ),
    )


def _audit_value(value: object) -> object:
    """A field value as JSON audit metadata can hold it."""
    if isinstance(value, models.Model):
        return str(value.pk)
    if isinstance(value, date):
        return value.isoformat()
    return value


NEW_SESSION_STATUS_MESSAGE = "New grading sessions must start in draft status."
STATUS_CHANGE_MESSAGE = (
    "Use transition_grading_session() for grading session status changes."
)


@transaction.atomic
def update_grading_session(
    session: GradingSession,
    *,
    changes: Mapping[str, object],
    target_status: str | None = None,
    reason: str = "",
    actor: User | None = None,
) -> GradingSession:
    """Edit a session's details and, if asked, move its status.

    Only the fields in `changes` are written, onto the locked row. Saving the
    caller's copy whole wrote back its status and cancellation reason too, so
    a transition committed while the edit waited was silently undone.
    The API and Django admin both edit through here - admin's form
    has more editable fields than the API, which is why `changes` is a
    mapping.
    """
    if "status" in changes:
        raise ValidationError({"status": [STATUS_CHANGE_MESSAGE]})
    locked = lock_session(session.pk)
    before = {field: _audit_value(getattr(locked, field)) for field in changes}
    for field, value in changes.items():
        setattr(locked, field, value)
    if "grading_date" in changes:
        # Against the locked row, so a registration made while this waited counts.
        validate_session_grading_date_change(locked)
    if changes:
        # The same normalising clean() that save() runs, so a resent value
        # that only differs by surrounding whitespace counts as unchanged.
        locked.full_clean()
    after = {field: _audit_value(getattr(locked, field)) for field in changes}
    changed = [field for field in changes if before[field] != after[field]]
    # A resent value that matches writes nothing and records nothing.
    if changed:
        locked.save(update_fields=[*changed, "updated_at"])
        record(
            AuditAction.SESSION_UPDATED,
            locked,
            f"Grading session {locked.title} updated.",
            actor=actor,
            metadata={
                "before": {field: before[field] for field in changed},
                "after": {field: after[field] for field in changed},
            },
        )
    if target_status is not None and target_status != locked.status:
        locked = transition_grading_session(
            locked,
            target_status,
            actor=actor,
            reason=reason,
        )
    return locked


def may_override_locked_session(actor: User | None) -> bool:
    try:
        validate_locked_session_override_actor(actor)
    except ValidationError:
        return False
    return True


def candidate_can_be_withdrawn_after_lock(
    candidate: GradingCandidate,
    *,
    may_override: bool,
) -> bool:
    """Whether a viewer who `may_override` a locked session may withdraw this
    candidate now: the rules withdraw_locked_candidate enforces, for the
    roster. The viewer's authority is passed in, so a list asks it once."""
    if not may_override or candidate.session.status != GradingSession.Status.LOCKED:
        return False
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        return False
    outcome = getattr(candidate, "outcome", None)
    return outcome is None or outcome.status != CandidateOutcome.Status.FINALISED


@transaction.atomic
def withdraw_locked_candidate(
    candidate: GradingCandidate,
    reason: str,
    note: str,
    actor: User,
) -> GradingCandidate:
    """Withdraw a graded candidate who cannot receive a decision, after lock.

    Without this the only way to let the session complete would be to
    finalise an outcome nobody actually decided. Their assessment is kept
    exactly as recorded.
    """
    validate_locked_session_override_actor(actor)
    locked_candidate = lock_candidate(candidate.pk)

    if locked_candidate.session.status != GradingSession.Status.LOCKED:
        raise ValidationError(
            {
                "session": [
                    "This is only for locked sessions. While the session is "
                    "draft or open, withdraw the candidate from its roster instead.",
                ],
            },
        )
    if locked_candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError({"candidate": ["Candidate is already withdrawn."]})
    if reason not in GradingCandidate.WithdrawalReason.values:
        raise ValidationError(
            {"withdrawal_reason": ["Choose a reason for the withdrawal."]}
        )

    outcome = getattr(locked_candidate, "outcome", None)
    discarded_proposal: dict[str, object] | None = None
    if outcome is not None:
        if outcome.status == CandidateOutcome.Status.FINALISED:
            raise ValidationError(
                {
                    "candidate": [
                        "A candidate with a finalised outcome cannot be withdrawn.",
                    ],
                },
            )
        # A draft or proposed outcome was never a decision, and leaving one
        # attached to a withdrawn candidate would misrepresent the record -
        # but discarding it silently would erase that someone had proposed
        # PASS or FAIL, so it is captured here before the delete, the same
        # way delete_grading_session captures its cascaded candidates.
        discarded_proposal = {
            "status": outcome.status,
            "proposed_outcome": outcome.proposed_outcome,
            "proposal_notes": outcome.proposal_notes,
            "proposed_by": (
                str(outcome.proposed_by_id) if outcome.proposed_by_id else None
            ),
        }
        outcome.delete()

    locked_candidate.status = GradingCandidate.Status.WITHDRAWN
    locked_candidate.withdrawal_reason = reason
    locked_candidate.withdrawal_note = (note or "").strip()
    locked_candidate.withdrawn_by = actor
    locked_candidate.withdrawn_at = timezone.now()
    locked_candidate.save()
    record(
        AuditAction.CANDIDATE_WITHDRAWN,
        locked_candidate,
        (
            f"{student_label(locked_candidate.student, first=True)} withdrawn "
            "from a locked session "
            f"({locked_candidate.get_withdrawal_reason_display()})."
        ),
        actor=actor,
        metadata={
            "reason": reason,
            "note": locked_candidate.withdrawal_note,
            "discarded_proposal": discarded_proposal,
            **grading_context(locked_candidate),
        },
    )
    return locked_candidate


def validate_session_grading_date_change(session: GradingSession) -> None:
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
    if not session.roster_open:
        raise ValidationError(
            {"session": ["Candidates can only be added to draft or open sessions."]},
        )


def unsettled_registrations() -> QuerySet[GradingCandidate]:
    """Registrations whose grading has not reached its result yet.

    Settled means withdrawn, in a cancelled session, or with a finalised
    outcome that is a Fail or Conditional, or a Pass already promoted. Until
    then the student's next rank is not known, so a second registration
    would test them for a rank they may already hold.
    """
    settled_by_outcome = Q(outcome__status=CandidateOutcome.Status.FINALISED) & (
        ~Q(outcome__final_outcome=CandidateOutcome.Outcome.PASS)
        | Q(promotion__isnull=False)
    )
    return (
        GradingCandidate.objects.exclude(status=GradingCandidate.Status.WITHDRAWN)
        .exclude(session__status=GradingSession.Status.CANCELLED)
        .exclude(settled_by_outcome)
    )


def validate_not_already_in_session(candidate: GradingCandidate) -> None:
    """A student has one registration per session, whatever its status."""
    _validate_not_in_session(
        candidate.session_id,
        candidate.student_id,
        exclude_pk=candidate.pk,
    )


def _validate_not_in_session(
    session_id: int,
    student_id: int,
    *,
    exclude_pk: int,
) -> None:
    """The unique constraint holds this too, but its own message ("Grading
    candidate with this Session and Student already exists.") names
    neither the student nor what to do; this gives the one message every
    path - and the cohort builder - recognises.
    """
    if (
        GradingCandidate.objects.filter(session_id=session_id, student_id=student_id)
        .exclude(pk=exclude_pk)
        .exists()
    ):
        raise _already_registered()


def _already_registered() -> ValidationError:
    return ValidationError(
        {
            "student": [
                ValidationError(ALREADY_REGISTERED_MESSAGE, code=ALREADY_IN_SESSION)
            ]
        },
    )


def validate_no_unsettled_registration(candidate: GradingCandidate) -> None:
    """One grading at a time (owner decision 2026-10-18).

    A student is registered for one grading until it settles. A registration
    made in error is corrected by an administrator, not by registering again.
    """
    other = (
        unsettled_registrations()
        .filter(student_id=candidate.student_id)
        .exclude(pk=candidate.pk)
        .select_related("session")
        .first()
    )
    if other is not None:
        raise ValidationError(
            {
                "student": [
                    ValidationError(
                        f"This student is already registered for "
                        f"'{other.session.title}', which has not reached its "
                        f"result yet. A student is registered for one grading "
                        f"at a time; an administrator can correct a "
                        f"registration made in error.",
                        code=REGISTERED_ELSEWHERE,
                    ),
                ],
            },
        )


def session_deletion_blocker(
    session: GradingSession,
    actor: User | None,
    *,
    has_recorded_work: bool,
    has_final_decisions: bool,
) -> dict[str, list[str]] | None:
    """Why this actor cannot delete the session, or None when they can.

    Pure over its arguments so the list can decide for every session from one
    annotated query while the delete itself checks the same rule.
    """
    # A recorded final decision (and so any promotion built on it) is never
    # erased, by anyone: the record stays reproducible. A finished session is
    # archived instead, which hides it and keeps every row.
    if has_final_decisions:
        return {
            "session": [
                "This session holds final decisions, which are never erased. "
                "Archive it instead.",
            ],
        }
    # Without final decisions an administrator may delete a session in any
    # status; delete_grading_session's audit event is the trail.
    if actor is not None and actor.has_perm(DELETE_ANY_SESSION_PERMISSION):
        return None
    if session.status not in {
        GradingSession.Status.DRAFT,
        GradingSession.Status.CANCELLED,
    }:
        return {"status": ["Only draft or cancelled grading sessions can be deleted."]}
    # A cancelled session can have come from OPEN, so it may hold assessments
    # people actually sat. Deleting it cascades that work away silently, and
    # there is no audit trail to reconstruct it from. Cancel, do not erase -
    # unless an administrator is doing it deliberately (handled above).
    if has_recorded_work:
        return {
            "session": [
                "This session cannot be deleted because assessment work "
                "has already been recorded against it. Cancel it instead.",
            ],
        }
    return None


def validate_session_can_be_deleted(
    session: GradingSession,
    actor: User | None = None,
) -> None:
    blocker = session_deletion_blocker(
        session,
        actor,
        has_recorded_work=_session_started_work(session.pk).exists(),
        has_final_decisions=_session_final_decisions(session.pk).exists(),
    )
    if blocker is not None:
        raise ValidationError(blocker)


def validate_candidate_can_be_changed(candidate: GradingCandidate) -> None:
    if not candidate.session.roster_open:
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
    testing_for_rank_changed: bool = False,
    status: str | None = None,
) -> None:
    assessment = getattr(candidate, "assessment", None)
    if assessment is None:
        if status == GradingCandidate.Status.COMPLETED:
            raise ValidationError(
                {
                    "status": [
                        COMPLETED_BY_ASSESSMENT_MESSAGE,
                    ],
                },
            )
        return

    if session_changed or testing_for_rank_changed:
        raise ValidationError(
            {
                "candidate": [
                    "Session and testing-for rank cannot be changed "
                    "after the assessment form has been prepared.",
                ],
            },
        )
    if status == GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {
                "status": [
                    COMPLETED_BY_ASSESSMENT_MESSAGE,
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
    outcome = getattr(candidate, "outcome", None)
    if outcome is not None and outcome.status == CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"candidate": ["Candidates with finalised outcomes cannot be deleted."]},
        )
    if not candidate.session.roster_open:
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
                    "Candidates with an assessment form can only be deleted "
                    "while the session is draft and the assessment has not "
                    "started.",
                ],
            },
        )


def candidate_can_be_deleted(candidate: GradingCandidate) -> bool:
    try:
        validate_candidate_can_be_deleted(candidate)
    except ValidationError:
        return False
    return True


def candidate_can_change_session(candidate: GradingCandidate) -> bool:
    try:
        validate_candidate_can_be_changed(candidate)
        validate_candidate_assessment_changes(candidate, session_changed=True)
    except ValidationError:
        return False
    return True


def build_candidate(
    *,
    session: GradingSession,
    student: Student,
    testing_for_rank: Rank,
    notes: str = "",
) -> GradingCandidate:
    validate_session_accepts_candidates(session)
    validate_student_can_be_graded(student)
    validate_testing_for_rank(student, testing_for_rank, session.grading_date)
    built = GradingCandidate(
        session=session,
        student=student,
        testing_for_rank=testing_for_rank,
        age_band=resolve_age_band(student.date_of_birth, session.grading_date),
        notes=notes,
    )
    validate_not_already_in_session(built)
    validate_no_unsettled_registration(built)
    return built


def _withdrawal_change(current: str, requested: str | None) -> tuple[bool, bool]:
    """Whether moving a candidate from `current` to `requested` status
    withdraws them, and whether it reinstates them."""
    withdrawn = GradingCandidate.Status.WITHDRAWN
    withdrawing = requested == withdrawn and current != withdrawn
    reinstating = (
        requested is not None and requested != withdrawn and current == withdrawn
    )
    return withdrawing, reinstating


def update_candidate(
    candidate: GradingCandidate,
    *,
    session: GradingSession | None = None,
    testing_for_rank: Rank | None = None,
    status: str | None = None,
    notes: str | None = None,
    withdrawal_reason: str | None = None,
    withdrawal_note: str | None = None,
    actor: User | None = None,
) -> GradingCandidate:
    new_session = session or candidate.session
    new_testing_for_rank = testing_for_rank or candidate.testing_for_rank
    session_changed = session is not None and session.pk != candidate.session_id
    rank_changed = (
        testing_for_rank is not None
        and testing_for_rank.pk != candidate.testing_for_rank_id
    )

    validate_candidate_can_be_changed(candidate)
    validate_candidate_assessment_changes(
        candidate,
        session_changed=session_changed,
        testing_for_rank_changed=rank_changed,
        status=status,
    )
    if session_changed:
        validate_session_accepts_candidates(new_session)
        _validate_not_in_session(
            new_session.pk,
            candidate.student_id,
            exclude_pk=candidate.pk,
        )

    withdrawing, reinstating = _withdrawal_change(candidate.status, status)
    if session_changed or rank_changed or reinstating:
        # Checked on the locked student (apply_candidate_update): a deleted
        # student's kept registration never becomes active again.
        validate_student_not_deleted(candidate.student)
    if reinstating:
        validate_no_unsettled_registration(candidate)
    # The rank is checked when it is chosen, so a registration whose student
    # was promoted elsewhere can still be withdrawn.
    if session_changed or rank_changed or reinstating:
        validate_testing_for_rank(
            candidate.student,
            new_testing_for_rank,
            new_session.grading_date,
        )
    if withdrawing:
        if withdrawal_reason not in GradingCandidate.WithdrawalReason.values:
            raise ValidationError(
                {"withdrawal_reason": [WITHDRAWAL_REASON_REQUIRED_MESSAGE]},
            )
        if actor is None:
            raise ValidationError(
                {"candidate": ["A withdrawal must be attributed to whoever made it."]},
            )
        candidate.withdrawal_reason = withdrawal_reason
        candidate.withdrawal_note = (withdrawal_note or "").strip()
        candidate.withdrawn_by = actor
        candidate.withdrawn_at = timezone.now()
    elif reinstating:
        candidate.withdrawal_reason = ""
        candidate.withdrawal_note = ""
        candidate.withdrawn_by = None
        candidate.withdrawn_at = None

    candidate.session = new_session
    candidate.testing_for_rank = new_testing_for_rank
    if status is not None:
        candidate.status = status
    if notes is not None:
        candidate.notes = notes
    if session_changed:
        candidate.age_band = resolve_age_band(
            candidate.student.date_of_birth,
            new_session.grading_date,
        )
    return candidate


@transaction.atomic
def create_grading_session(
    *,
    title: str,
    grading_date: date,
    location: str,
    notes: str,
    created_by: User,
    status: str | None = None,
) -> GradingSession:
    # A client that supplies a status is refused, not silently overridden.
    if status is not None and status != GradingSession.Status.DRAFT:
        raise ValidationError(
            {"status": [NEW_SESSION_STATUS_MESSAGE]},
        )
    session = GradingSession.objects.create(
        title=title,
        grading_date=grading_date,
        location=location,
        notes=notes,
        created_by=created_by,
    )
    record(
        AuditAction.SESSION_CREATED,
        session,
        f"Grading session '{session.title}' created for {session.grading_date}.",
        actor=created_by,
    )
    return session


@transaction.atomic
def delete_grading_session(session: GradingSession, actor: User | None = None) -> None:
    # A session holding a final decision is refused by
    # validate_session_can_be_deleted, so there is no promotion to roll back
    # here. What remains is at most a proposal, which refuses ordinary
    # delete(), so it is stripped first, the sanctioned bypass
    # delete_candidate_assessment uses (the unbound base QuerySet.delete).
    locked = lock_session(session.pk)
    validate_session_can_be_deleted(locked, actor=actor)
    models.QuerySet.delete(
        CandidateOutcome.objects.filter(candidate__session=locked),
    )

    # Recorded before the row goes, so the event still carries its identity.
    #
    # Deleting a session cascades its candidates away. Recording only the
    # session would leave those disappearances invisible, so the cascade is
    # captured here rather than emitting one event per candidate, which on a
    # twenty-candidate session would bury the deletion that caused it.
    cascaded = list(
        locked.candidates.values_list("id", "student__wksa_id"),
    )
    record(
        AuditAction.SESSION_DELETED,
        locked,
        (
            f"Grading session '{locked.title}' deleted while {locked.status}"
            + (
                f", removing {len(cascaded)} registered candidate(s)."
                if cascaded
                else "."
            )
        ),
        actor=actor,
        metadata={
            "status": locked.status,
            "title": locked.title,
            "cascaded_candidates": [
                {"id": candidate_id, "student_wksa_id": wksa_id}
                for candidate_id, wksa_id in cascaded
            ],
        },
    )
    locked.delete(actor=actor)


def validate_session_can_be_archived(
    session: GradingSession,
    actor: User | None,
) -> None:
    """Only an administrator puts a finished session away, once."""
    if actor is None or not actor.has_perm(DELETE_ANY_SESSION_PERMISSION):
        raise ValidationError(
            {"session": ["Only an administrator can archive a grading session."]},
        )
    if session.status not in {
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    }:
        raise ValidationError(
            {
                "status": [
                    "Only a completed or cancelled grading session can be archived."
                ]
            },
        )
    if session.archived_at is not None:
        raise ValidationError({"session": ["This session is already archived."]})


def session_can_be_archived(session: GradingSession, actor: User | None) -> bool:
    try:
        validate_session_can_be_archived(session, actor)
    except ValidationError:
        return False
    return True


def session_can_be_restored(session: GradingSession, actor: User | None) -> bool:
    return (
        session.archived_at is not None
        and actor is not None
        and actor.has_perm(DELETE_ANY_SESSION_PERMISSION)
    )


@transaction.atomic
def archive_grading_session(session: GradingSession, actor: User) -> GradingSession:
    """Hide a finished session from the lists. Nothing is erased."""
    locked = lock_session(session.pk)
    validate_session_can_be_archived(locked, actor)
    locked.archived_at = timezone.now()
    GradingSession.objects.filter(pk=locked.pk).update(archived_at=locked.archived_at)
    record(
        AuditAction.SESSION_ARCHIVED,
        locked,
        f"Grading session '{locked.title}' archived.",
        actor=actor,
        metadata={"status": locked.status},
    )
    return locked


@transaction.atomic
def restore_grading_session(session: GradingSession, actor: User) -> GradingSession:
    """Bring an archived session back into the lists."""
    locked = lock_session(session.pk)
    if not session_can_be_restored(locked, actor):
        raise ValidationError(
            {
                "session": [
                    "Only an administrator can restore an archived grading session."
                    if locked.archived_at is not None
                    else "This session is not archived.",
                ],
            },
        )
    locked.archived_at = None
    GradingSession.objects.filter(pk=locked.pk).update(archived_at=None)
    record(
        AuditAction.SESSION_RESTORED,
        locked,
        f"Grading session '{locked.title}' restored from the archive.",
        actor=actor,
        metadata={"status": locked.status},
    )
    return locked


@transaction.atomic
def register_candidate(
    *,
    session: GradingSession,
    student: Student,
    testing_for_rank: Rank,
    notes: str = "",
    actor: User | None = None,
) -> GradingCandidate:
    # The student is locked and re-read, not taken as passed: eligibility,
    # the next rank and the from_rank snapshot are all decided on it, and the
    # caller's copy was loaded before this transaction began.
    locked_session = lock_session(session.pk)
    locked_student = lock_student(student.pk)
    candidate = build_candidate(
        session=locked_session,
        student=locked_student,
        testing_for_rank=testing_for_rank,
        notes=notes,
    )
    _save_candidate(candidate)
    record(
        AuditAction.CANDIDATE_REGISTERED,
        candidate,
        (
            f"{student_label(locked_student, first=True)} registered for "
            f"'{locked_session.title}' testing "
            f"for {testing_for_rank.name}."
        ),
        actor=actor,
        metadata={"age_band": candidate.age_band, **grading_context(candidate)},
    )
    return candidate


def _save_candidate(candidate: GradingCandidate) -> None:
    """Save, turning the one expected constraint race into a domain error.

    The session lock already stops two registrations of one student racing,
    and full_clean() refuses a duplicate it can see; this is the backstop if
    either is ever bypassed.
    """
    try:
        candidate.save()
    except IntegrityError as exc:
        if not unique_violation_on(exc, GradingCandidate):
            raise
        raise _already_registered() from exc


@transaction.atomic
def bulk_register_candidates(
    *,
    session: GradingSession,
    rows: Sequence[Mapping[str, object]],
    actor: User | None = None,
    generate_assessments: bool = False,
    codes: dict[str, set[str]] | None = None,
) -> tuple[
    list[tuple[GradingCandidate, CandidateAssessment | None]], dict[str, list[str]]
]:
    """Register every row against `session`, independently of the others.

    The only registration path in the API. Each row registers on its own, so
    a batch of ten students does not fail all ten because one of them was
    already registered.

    A row's `testing_for_rank` is optional: when omitted it resolves to that
    student's own next active rank, so a mixed-belt group (some blue belts,
    a couple of white belts, one brown stripe) can be registered in one
    batch without picking a rank for the whole request - there is no rank
    that would even apply to all of them.

    When `generate_assessments` is set, each registered candidate's
    assessment is generated in the same savepoint, so a row that registers
    but fails to generate does not leave a candidate with no assessment
    behind.

    Returns a (candidate, assessment) pair per created row - assessment is
    `None` unless `generate_assessments` was set - and a map of row index to
    error messages for the rows that failed.

    The session and every student are locked before the first row, so no
    row's savepoint takes a lock of its own that a failure would release.
    """
    locked_session = lock_session(session.pk)
    students = lock_students(cast(Student, row["student"]).pk for row in rows)

    def register_row(
        row: Mapping[str, object],
    ) -> tuple[GradingCandidate, CandidateAssessment | None]:
        row_student = students.get(cast(Student, row["student"]).pk)
        if row_student is None:
            raise ValidationError({"student": [STUDENT_GONE_MESSAGE]})
        testing_for_rank = cast(Rank | None, row.get("testing_for_rank"))
        if testing_for_rank is None:
            testing_for_rank = get_next_active_rank(row_student.current_rank)
            if testing_for_rank is None:
                raise ValidationError(
                    {"testing_for_rank": [NO_NEXT_RANK_MESSAGE]},
                )
        registered = register_candidate(
            session=locked_session,
            student=row_student,
            testing_for_rank=testing_for_rank,
            actor=actor,
        )
        if not generate_assessments:
            return registered, None
        if actor is None:
            raise ValidationError(
                {"actor": ["An actor is required to generate assessments."]},
            )
        return registered, generate_candidate_assessment(registered, actor)

    return each_independently(rows, register_row, codes)


def _candidate_snapshot(candidate: GradingCandidate) -> dict[str, object]:
    return {
        "session": candidate.session_id,
        "student": candidate.student_id,
        "testing_for_rank": candidate.testing_for_rank_id,
        "status": candidate.status,
        "notes": candidate.notes,
        "withdrawal_reason": candidate.withdrawal_reason,
        "withdrawal_note": candidate.withdrawal_note,
    }


@transaction.atomic
def apply_candidate_update(
    candidate: GradingCandidate,
    *,
    session: GradingSession | None = None,
    testing_for_rank: Rank | None = None,
    status: str | None = None,
    notes: str | None = None,
    withdrawal_reason: str | None = None,
    withdrawal_note: str | None = None,
    actor: User | None = None,
) -> GradingCandidate:
    # Only `candidate`'s id is used. The API loaded it before this
    # transaction began, and Django admin has already written its form onto
    # it, so saving it as received wrote back whatever another edit changed
    # in the meantime. The requested changes go onto the locked row,
    # and a move locks the destination session in the same ascending pass.
    locked = lock_candidate(
        candidate.pk,
        also_lock=[session.pk] if session is not None else [],
    )
    moving = session is not None and session.pk != locked.session_id
    rechoosing_rank = (
        testing_for_rank is not None
        and testing_for_rank.pk != locked.testing_for_rank_id
    )
    _, reinstating = _withdrawal_change(locked.status, status)
    if moving or rechoosing_rank or reinstating:
        # Each of these is checked against the student - their current rank,
        # their age on the new grading date, and (reinstating) their
        # registrations in other sessions, which this session's lock does not
        # cover. So the student is locked after the sessions, as registration
        # locks it, and re-read: the copy joined above was read before any
        # student lock and may already be out of date. Relying instead on the
        # key-share lock a write happens to take was how the reinstatement
        # race was first found covered by accident.
        locked.student = lock_student(locked.student_id)
    before = _candidate_snapshot(locked)
    updated = update_candidate(
        locked,
        session=lock_session(session.pk) if session is not None else None,
        testing_for_rank=testing_for_rank,
        status=status,
        notes=notes,
        withdrawal_reason=withdrawal_reason,
        withdrawal_note=withdrawal_note,
        actor=actor,
    )
    # The same normalising clean() that save() runs, so a resent value that
    # only differs by surrounding whitespace still counts as unchanged.
    updated.full_clean()
    after = _candidate_snapshot(updated)
    if before == after:
        # A no-op PATCH (resending the same values) writes nothing at all -
        # no row update and no audit event.
        return updated
    _save_candidate(updated)

    withdrawn, _ = _withdrawal_change(str(before["status"]), updated.status)
    record(
        AuditAction.CANDIDATE_WITHDRAWN if withdrawn else AuditAction.CANDIDATE_UPDATED,
        updated,
        (
            f"{student_label(updated.student, first=True)} withdrawn "
            f"({updated.get_withdrawal_reason_display()})."
            if withdrawn
            else f"Candidate record for {student_label(updated.student)} updated."
        ),
        actor=actor,
        metadata={
            "before": before,
            "after": after,
            **grading_context(updated),
        },
    )
    return updated


@transaction.atomic
def delete_candidate(candidate: GradingCandidate, actor: User | None = None) -> None:
    locked = lock_candidate(candidate.pk)
    validate_candidate_can_be_deleted(locked)
    record(
        AuditAction.CANDIDATE_DELETED,
        locked,
        f"{student_label(locked.student, first=True)} removed from "
        f"'{locked.session.title}'.",
        actor=actor,
        metadata={"status": locked.status, **grading_context(locked)},
    )
    locked.delete()


@transaction.atomic
def bulk_update_candidate_status(
    *,
    candidates: Sequence[GradingCandidate],
    new_status: str,
    withdrawal_reason: str | None = None,
    withdrawal_note: str | None = None,
    actor: User | None = None,
) -> tuple[list[GradingCandidate], dict[str, list[str]]]:
    """Set `new_status` on every candidate, independently of the others.

    Built for confirming attendance in bulk: tick the candidates who did not
    show up, set WITHDRAWN, and confirm - the rest are left untouched. One
    candidate's session already being locked does not block the others.
    """
    pinned = lock_sessions_of(
        GradingCandidate,
        [candidate.pk for candidate in candidates],
        "session_id",
    )
    if new_status != GradingCandidate.Status.WITHDRAWN:
        # A reinstatement locks its student (see apply_candidate_update); a
        # bulk operation takes those locks before the first row's savepoint.
        lock_students(
            GradingCandidate.objects.filter(pk__in=pinned).values_list(
                "student_id", flat=True
            ),
        )

    def update_status(candidate: GradingCandidate) -> GradingCandidate:
        require_pinned(candidate.pk, pinned, "candidate")
        return apply_candidate_update(
            candidate,
            status=new_status,
            withdrawal_reason=withdrawal_reason,
            withdrawal_note=withdrawal_note,
            actor=actor,
        )

    return each_independently(candidates, update_status)
