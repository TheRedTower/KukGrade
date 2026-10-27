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
from audit.recording import record
from gradings.age import resolve_age_band
from gradings.assessment_services import (
    generate_candidate_assessment,
    validate_assessment_deletion_promotion,
)
from gradings.locking import (
    STUDENT_GONE_MESSAGE,
    lock_in_session,
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
    Promotion,
)
from gradings.service_support import each_independently, unique_violation_on
from ranks.models import Rank
from students.models import Student

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


def validate_student_can_be_graded(student: Student) -> None:
    if not student.can_be_graded:
        raise ValidationError(
            {
                "student": [
                    "This student has left and cannot be registered for a "
                    "grading. Set their status back to active or inactive first.",
                ],
            },
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


def validate_locked_session_override_actor(actor: User | None) -> None:
    if (
        actor is None
        or not actor.is_active
        or not actor.has_perm(OVERRIDE_LOCKED_SESSION_PERMISSION)
    ):
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
    locked = lock_session(session.pk)
    before = {field: _audit_value(getattr(locked, field)) for field in changes}
    for field, value in changes.items():
        setattr(locked, field, value)
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
    locked_candidate = lock_in_session(
        GradingCandidate.objects.select_related("session", "student"),
        candidate.pk,
        session_path="session_id",
        name="candidate",
    )

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
    locked_candidate._allow_locked_withdrawal = True
    locked_candidate.save()
    record(
        AuditAction.CANDIDATE_WITHDRAWN,
        locked_candidate,
        (
            f"{locked_candidate.student} withdrawn from a locked session "
            f"({locked_candidate.get_withdrawal_reason_display()})."
        ),
        actor=actor,
        metadata={
            "reason": reason,
            "note": locked_candidate.withdrawal_note,
            "discarded_proposal": discarded_proposal,
        },
    )
    return locked_candidate


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
    """A student has one registration per session, whatever its status.

    The unique constraint holds this too, but its own message ("Grading
    candidate with this Session and Student already exists.") names
    neither the student nor what to do; this gives the one message every
    path - and the cohort builder - recognises.
    """
    if (
        GradingCandidate.objects.filter(
            session_id=candidate.session_id,
            student_id=candidate.student_id,
        )
        .exclude(pk=candidate.pk)
        .exists()
    ):
        raise ValidationError({"student": [ALREADY_REGISTERED_MESSAGE]})


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
                    f"This student is already registered for "
                    f"'{other.session.title}', which has not reached its "
                    f"result yet. A student is registered for one grading at "
                    f"a time; an administrator can correct a registration "
                    f"made in error.",
                ],
            },
        )


def session_deletion_blocker(
    session: GradingSession,
    actor: User | None,
    *,
    has_recorded_work: bool,
) -> dict[str, list[str]] | None:
    """Why this actor cannot delete the session, or None when they can.

    Pure over its arguments so the list can decide for every session from one
    annotated query while the delete itself checks the same rule.
    """
    # An administrator may delete a session in any status, including
    # LOCKED/COMPLETED ones holding finalised outcomes and promotions -
    # delete_grading_session's own cascade (promotion revert, pre-flight
    # validated all-or-nothing) plus the SESSION_DELETED audit event are the
    # trail. Consistent with the single-candidate hard-delete path
    # (delete_candidate_assessment), which already ignores session status
    # entirely. Extends the 2026-09-20 cancelled-with-recorded-work decision
    # to every status, not just CANCELLED.
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
    )
    if blocker is not None:
        raise ValidationError(blocker)


def validate_candidate_can_be_changed(candidate: GradingCandidate) -> None:
    if candidate._allow_locked_withdrawal:
        return
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
    testing_for_rank_changed: bool = False,
    status: str | None = None,
) -> None:
    if candidate._allow_locked_withdrawal:
        return
    assessment = getattr(candidate, "assessment", None)
    if assessment is None:
        if status == GradingCandidate.Status.COMPLETED:
            raise ValidationError(
                {
                    "status": [
                        "A candidate is completed by completing their assessment.",
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
                    "A candidate is completed by completing their assessment.",
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


def validate_candidate_can_be_deleted(
    candidate: GradingCandidate,
    actor: User | None = None,
) -> None:
    # actor accepted but unused: candidate deletion has no administrator
    # override, unlike validate_session_can_be_deleted. The parameter exists
    # so gradings.admin.StateGatedDeleteMixin can call every
    # deletion_validator with the same (obj, actor=...) signature.
    outcome = getattr(candidate, "outcome", None)
    if outcome is not None and outcome.status == CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"candidate": ["Candidates with finalised outcomes cannot be deleted."]},
        )
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
    validate_testing_for_rank(student, testing_for_rank)
    return GradingCandidate(
        session=session,
        student=student,
        testing_for_rank=testing_for_rank,
        age_band=resolve_age_band(student.date_of_birth, session.grading_date),
        notes=notes,
    )


WITHDRAWAL_REASON_REQUIRED_MESSAGE = "A reason is required to withdraw a candidate."


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

    withdrawing = (
        status == GradingCandidate.Status.WITHDRAWN
        and candidate.status != GradingCandidate.Status.WITHDRAWN
    )
    reinstating = (
        status is not None
        and status != GradingCandidate.Status.WITHDRAWN
        and candidate.status == GradingCandidate.Status.WITHDRAWN
    )
    # Same rule as GradingCandidate.clean(): the rank is checked when it is
    # chosen, so a registration whose student was promoted elsewhere can
    # still be withdrawn.
    if session_changed or rank_changed or reinstating:
        validate_testing_for_rank(candidate.student, new_testing_for_rank)
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
    # Passed through rather than ignored so the model's "new sessions must
    # start in draft" guard still rejects a client that supplies one, instead
    # of silently overriding it.
    session = GradingSession.objects.create(
        title=title,
        grading_date=grading_date,
        location=location,
        notes=notes,
        created_by=created_by,
        **({"status": status} if status is not None else {}),
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
    # An administrator deleting a LOCKED/COMPLETED session may be erasing
    # finalised outcomes and promotions - those refuse ordinary delete(), so
    # they are stripped here first, the same sanctioned bypass
    # delete_candidate_assessment uses (models.QuerySet.delete, the real
    # unbound base implementation). Every candidate's promotion is
    # pre-flight validated with validate_assessment_deletion_promotion
    # *before* anything is mutated, so a promotion a later, different
    # session has already superseded refuses the whole deletion rather than
    # leaving the session half-erased.
    locked = lock_session(session.pk)
    validate_session_can_be_deleted(locked, actor=actor)
    reverted_student_ranks: list[dict[str, object]] = []
    if actor is not None and actor.has_perm(DELETE_ANY_SESSION_PERMISSION):
        promotions = list(
            Promotion.objects.filter(grading_candidate__session=locked)
            .select_related("from_rank", "to_rank")
            .order_by(
                "grading_candidate__student__last_name",
                "grading_candidate__student__first_name",
                "pk",
            ),
        )
        # Checked against each student as they are now, under the student's
        # lock, not as a join read them: a promotion from another session can
        # move a student on at any moment, and rolling back to this one's
        # from_rank would then overwrite it.
        students = lock_students(promotion.student_id for promotion in promotions)
        for promotion in promotions:
            validate_assessment_deletion_promotion(
                promotion,
                students[promotion.student_id],
            )
        for promotion in promotions:
            student = students[promotion.student_id]
            reverted_student_ranks.append(
                {
                    "student_id": student.pk,
                    "student_wksa_id": student.wksa_id,
                    "from": promotion.to_rank.code,
                    "to": promotion.from_rank.code,
                },
            )
            Student.objects.filter(pk=student.pk).update(
                current_rank=promotion.from_rank,
            )
            models.QuerySet.delete(Promotion.objects.filter(pk=promotion.pk))
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
            "reverted_student_ranks": reverted_student_ranks,
        },
    )
    locked.delete(actor=actor)


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
            f"{locked_student} registered for '{locked_session.title}' testing "
            f"for {testing_for_rank.name}."
        ),
        actor=actor,
        metadata={"age_band": candidate.age_band},
    )
    return candidate


ALREADY_REGISTERED_MESSAGE = "Student is already registered for this session."


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
        raise ValidationError({"student": [ALREADY_REGISTERED_MESSAGE]}) from exc


@transaction.atomic
def bulk_register_candidates(
    *,
    session: GradingSession,
    rows: Sequence[Mapping[str, object]],
    actor: User | None = None,
    generate_assessments: bool = False,
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
                    {"testing_for_rank": ["Student has no next active rank."]},
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

    return each_independently(rows, register_row)


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
    locked = lock_in_session(
        GradingCandidate.objects.select_related(
            "session", "student", "testing_for_rank"
        ),
        candidate.pk,
        session_path="session_id",
        name="candidate",
        also_lock=[session.pk] if session is not None else [],
    )
    moving = session is not None and session.pk != locked.session_id
    rechoosing_rank = (
        testing_for_rank is not None
        and testing_for_rank.pk != locked.testing_for_rank_id
    )
    reinstating = (
        status is not None
        and status != GradingCandidate.Status.WITHDRAWN
        and locked.status == GradingCandidate.Status.WITHDRAWN
    )
    if moving or rechoosing_rank or reinstating:
        # Each of these is checked against the student - their current rank,
        # their age on the new grading date, and (reinstating) their
        # registrations in other sessions, which this session's lock does not
        # cover. So the student is locked after the sessions, as registration
        # locks it, and re-read: the copy joined above was read before any
        # student lock and may already be out of date. Relying instead on the
        # key-share lock a write happens to take was how the reinstatement
        # race was first found covered by accident (audit D1, 2026-10-18).
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

    withdrawn = (
        before["status"] != GradingCandidate.Status.WITHDRAWN
        and updated.status == GradingCandidate.Status.WITHDRAWN
    )
    record(
        AuditAction.CANDIDATE_WITHDRAWN if withdrawn else AuditAction.CANDIDATE_UPDATED,
        updated,
        (
            f"{updated.student} withdrawn ({updated.get_withdrawal_reason_display()})."
            if withdrawn
            else f"Candidate record for {updated.student} updated."
        ),
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return updated


@transaction.atomic
def delete_candidate(candidate: GradingCandidate, actor: User | None = None) -> None:
    locked = lock_in_session(
        GradingCandidate.objects.select_related("session", "student"),
        candidate.pk,
        session_path="session_id",
        name="candidate",
    )
    validate_candidate_can_be_deleted(locked)
    record(
        AuditAction.CANDIDATE_DELETED,
        locked,
        f"{locked.student} removed from '{locked.session.title}'.",
        actor=actor,
        metadata={"status": locked.status},
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
