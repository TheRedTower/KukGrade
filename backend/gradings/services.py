from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from typing import TypedDict, cast

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from audit.models import AuditAction
from audit.recording import record
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    Promotion,
)
from ranks.models import Rank
from students.models import Student
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement

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

ASSESSMENT_GENERATION_SESSION_STATUSES = {
    GradingSession.Status.DRAFT,
    GradingSession.Status.OPEN,
}

ASSESSMENT_RESULT_ENTRY_SESSION_STATUSES = {
    GradingSession.Status.OPEN,
    GradingSession.Status.LOCKED,
}

OUTCOME_CREATION_SESSION_STATUSES = {
    GradingSession.Status.LOCKED,
}

PROMOTION_SESSION_STATUSES = {
    GradingSession.Status.LOCKED,
    GradingSession.Status.COMPLETED,
}


class OverallAssessmentSummary(TypedDict):
    total: int
    required: int
    met: int
    not_met: int
    not_assessed: int
    required_met: int
    required_not_met: int
    required_not_assessed: int
    all_required_assessed: bool
    all_required_met: bool


class CategoryAssessmentSummary(TypedDict):
    category: str
    total: int
    required: int
    met: int
    not_met: int
    not_assessed: int
    required_met: int
    required_not_met: int
    required_not_assessed: int
    all_required_assessed: bool
    all_required_met: bool


class CandidateAssessmentSummary(TypedDict):
    overall: OverallAssessmentSummary
    categories: list[CategoryAssessmentSummary]


class StudentRankTimeline(TypedDict):
    student: Student
    current_rank: Rank
    promotions: list[Promotion]


class GradingHistoryItem(TypedDict):
    source: str  # "KUKGRADE" | "LEGACY"
    record_id: int
    date: date | None
    cycle_year: int | None
    cycle_month: int | None
    date_precision: str  # "DAY" | "MONTH"
    testing_for_rank_code: str | None
    testing_for_rank_name: str | None
    source_testing_for_rank_text: str
    outcome: str | None
    attendance_status: str
    comments: str
    promotion_id: int | None


class StudentGradingHistory(TypedDict):
    student: Student
    items: list[GradingHistoryItem]


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
    if actor is None or not actor.is_active:
        raise ValidationError(
            {"actor": ["Locked session override authority is required."]}
        )
    if not actor.has_perm(OVERRIDE_LOCKED_SESSION_PERMISSION):
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
    locked_session = GradingSession.objects.select_for_update(of=("self",)).get(
        pk=session.pk
    )
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


@transaction.atomic
def withdraw_locked_candidate(
    candidate: GradingCandidate,
    reason: str,
    note: str,
    actor: User,
) -> GradingCandidate:
    """Withdraw a candidate who cannot finish, from a locked session.

    Without this the only way out was to mark their unassessed required items
    NOT_MET and finalise a FAIL, which writes fabricated results into a record
    the system then correctly refuses to change. Their partial assessment is
    kept exactly as recorded.
    """
    validate_locked_session_override_actor(actor)
    locked_candidate = (
        GradingCandidate.objects.select_for_update(of=("self",))
        .select_related("session", "student")
        .get(pk=candidate.pk)
    )

    if locked_candidate.session.status != GradingSession.Status.LOCKED:
        raise ValidationError(
            {
                "session": [
                    "This withdrawal path is only for locked sessions. Use an "
                    "ordinary candidate update while the session is draft or open.",
                ],
            },
        )
    if locked_candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError({"candidate": ["Candidate is already withdrawn."]})
    if reason not in GradingCandidate.WithdrawalReason.values:
        raise ValidationError({"withdrawal_reason": ["Invalid withdrawal reason."]})

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


def validate_session_can_be_deleted(
    session: GradingSession,
    actor: User | None = None,
) -> None:
    # An administrator may delete a session in any status, including
    # LOCKED/COMPLETED ones holding finalised outcomes and promotions -
    # delete_grading_session's own cascade (promotion revert, pre-flight
    # validated all-or-nothing) plus the SESSION_DELETED audit event are the
    # trail. Consistent with the single-candidate hard-delete path
    # (delete_candidate_assessment), which already ignores session status
    # entirely. Extends the 2026-09-20 cancelled-with-recorded-work decision
    # to every status, not just CANCELLED.
    if actor is not None and actor.role == User.Role.ADMINISTRATOR:
        return
    if session.status not in {
        GradingSession.Status.DRAFT,
        GradingSession.Status.CANCELLED,
    }:
        raise ValidationError(
            {"status": ["Only draft or cancelled grading sessions can be deleted."]},
        )
    # A cancelled session can have come from OPEN, so it may hold assessments
    # people actually sat. Deleting it cascades that work away silently, and
    # there is no audit trail to reconstruct it from. Cancel, do not erase -
    # unless an administrator is doing it deliberately (handled above).
    if (
        session.candidates.exclude(
            assessment__status=CandidateAssessment.Status.NOT_STARTED,
        )
        .filter(assessment__isnull=False)
        .exists()
    ):
        raise ValidationError(
            {
                "session": [
                    "This session cannot be deleted because assessment work "
                    "has already been recorded against it. Cancel it instead.",
                ],
            },
        )


def validate_candidate_can_be_changed(candidate: GradingCandidate) -> None:
    if getattr(candidate, "_allow_locked_withdrawal", False):
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
    student_changed: bool = False,
    testing_for_rank_changed: bool = False,
    status: str | None = None,
) -> None:
    if getattr(candidate, "_allow_locked_withdrawal", False):
        return
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
                    "Candidates with assessment snapshots can only be deleted "
                    "while the session is draft and the assessment has not "
                    "started.",
                ],
            },
        )


def validate_outcome_assessment_state(outcome: CandidateOutcome) -> None:
    if outcome.assessment.status != CandidateAssessment.Status.COMPLETED:
        raise ValidationError(
            {"assessment": ["Candidate assessment must remain completed."]},
        )
    if outcome.candidate.status != GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {"candidate": ["Grading candidate must remain completed."]},
        )
    if outcome.candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot have outcome decisions."]},
        )


def validate_candidate_outcome_creation(candidate: GradingCandidate) -> None:
    if candidate.session.status not in OUTCOME_CREATION_SESSION_STATUSES:
        raise ValidationError(
            {"session": ["Candidate outcomes can only be created in locked sessions."]},
        )
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Cannot create an outcome for a withdrawn candidate."]},
        )
    if candidate.status != GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {"candidate": ["Candidate must be completed before outcome creation."]},
        )
    assessment = getattr(candidate, "assessment", None)
    if assessment is None:
        raise ValidationError(
            {
                "assessment": [
                    "Candidate must have an assessment before outcome creation.",
                ],
            },
        )
    if assessment.status != CandidateAssessment.Status.COMPLETED:
        raise ValidationError(
            {"assessment": ["Assessment must be completed before outcome creation."]},
        )


@transaction.atomic
def create_candidate_outcome(
    candidate: GradingCandidate,
    actor: User | None = None,
) -> CandidateOutcome:
    locked_candidate = (
        GradingCandidate.objects.select_for_update(of=("self",))
        .select_related("session", "student", "testing_for_rank")
        .get(pk=candidate.pk)
    )
    validate_candidate_outcome_creation(locked_candidate)
    assessment = locked_candidate.assessment
    try:
        outcome = CandidateOutcome.objects.create(
            candidate=locked_candidate,
            assessment=assessment,
        )
        record(
            AuditAction.OUTCOME_CREATED,
            outcome,
            f"Outcome record opened for {locked_candidate.student}.",
            actor=actor,
        )
        return outcome
    except IntegrityError as exc:
        raise ValidationError(
            {"candidate": ["Candidate already has an outcome."]},
        ) from exc


def _validate_outcome_choice(value: str, field_name: str) -> None:
    if value not in CandidateOutcome.Outcome.values:
        raise ValidationError({field_name: ["Invalid candidate outcome."]})


@transaction.atomic
def propose_candidate_outcome(
    outcome: CandidateOutcome,
    proposed_outcome: str,
    proposal_notes: str,
    actor: User,
) -> CandidateOutcome:
    locked_outcome = (
        CandidateOutcome.objects.select_for_update(of=("self",))
        .select_related("candidate__session", "assessment", "proposed_by", "decided_by")
        .get(pk=outcome.pk)
    )
    validate_outcome_assessment_state(locked_outcome)
    if locked_outcome.status == CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"status": ["Finalised candidate outcomes cannot be reproposed."]},
        )
    if locked_outcome.status not in {
        CandidateOutcome.Status.DRAFT,
        CandidateOutcome.Status.PROPOSED,
    }:
        raise ValidationError({"status": ["Outcome cannot be proposed."]})
    _validate_outcome_choice(proposed_outcome, "proposed_outcome")

    previous_proposal = {
        "proposed_outcome": locked_outcome.proposed_outcome,
        "proposal_notes": locked_outcome.proposal_notes,
        "proposed_by": (
            str(locked_outcome.proposed_by_id)
            if locked_outcome.proposed_by_id
            else None
        ),
    }

    locked_outcome.proposed_outcome = proposed_outcome
    locked_outcome.proposal_notes = proposal_notes
    locked_outcome.proposed_by = actor
    locked_outcome.proposed_at = timezone.now()
    locked_outcome.final_outcome = None
    locked_outcome.decided_by = None
    locked_outcome.decided_at = None
    locked_outcome.decision_notes = ""
    locked_outcome.conditional_requirements = ""
    locked_outcome.status = CandidateOutcome.Status.PROPOSED
    locked_outcome._allow_status_transition = True
    locked_outcome.save()
    # `before` is what makes a disagreement visible: without it the Master
    # sees only the latest proposal and no sign it ever said anything else.
    record(
        AuditAction.OUTCOME_PROPOSED,
        locked_outcome,
        (
            f"Outcome proposed as {proposed_outcome}"
            + (
                f", revising an earlier {previous_proposal['proposed_outcome']}."
                if previous_proposal["proposed_outcome"]
                else "."
            )
        ),
        actor=actor,
        metadata={
            "before": previous_proposal,
            "after": {
                "proposed_outcome": proposed_outcome,
                "proposal_notes": proposal_notes,
                "proposed_by": str(actor.pk),
            },
        },
    )
    return locked_outcome


def validate_final_decision_actor(actor: User) -> None:
    if not actor.is_active or not actor.has_perm(FINAL_GRADING_DECISION_PERMISSION):
        raise ValidationError(
            {"actor": ["Final grading decision authority is required."]},
        )


def validate_promotion_actor(actor: User) -> None:
    if not actor.is_active or not actor.has_perm(PROMOTE_STUDENT_PERMISSION):
        raise ValidationError(
            {"actor": ["Student promotion authority is required."]},
        )


@transaction.atomic
def finalise_candidate_outcome(
    outcome: CandidateOutcome,
    final_outcome: str,
    decision_notes: str,
    conditional_requirements: str,
    actor: User,
) -> CandidateOutcome:
    validate_final_decision_actor(actor)
    locked_outcome = (
        CandidateOutcome.objects.select_for_update(of=("self",))
        .select_related("candidate__session", "assessment", "proposed_by", "decided_by")
        .get(pk=outcome.pk)
    )
    validate_outcome_assessment_state(locked_outcome)
    if locked_outcome.status != CandidateOutcome.Status.PROPOSED:
        raise ValidationError(
            {"status": ["Only proposed candidate outcomes can be finalised."]},
        )
    if locked_outcome.candidate.session.status != GradingSession.Status.LOCKED:
        raise ValidationError(
            {"session": ["Final decisions can only be made in locked sessions."]},
        )
    if locked_outcome.proposed_outcome is None:
        raise ValidationError(
            {"proposed_outcome": ["Proposed outcome is required before finalisation."]},
        )
    _validate_outcome_choice(final_outcome, "final_outcome")

    cleaned_conditions = (conditional_requirements or "").strip()
    if final_outcome == CandidateOutcome.Outcome.CONDITIONAL:
        if not cleaned_conditions:
            raise ValidationError(
                {
                    "conditional_requirements": [
                        "Conditional requirements are required for "
                        "conditional outcomes.",
                    ],
                },
            )
    elif cleaned_conditions:
        raise ValidationError(
            {
                "conditional_requirements": [
                    "Conditional requirements must be blank for pass or fail outcomes.",
                ],
            },
        )

    locked_outcome.final_outcome = final_outcome
    locked_outcome.decision_notes = decision_notes
    locked_outcome.conditional_requirements = cleaned_conditions
    locked_outcome.decided_by = actor
    locked_outcome.decided_at = timezone.now()
    locked_outcome.status = CandidateOutcome.Status.FINALISED
    locked_outcome._allow_status_transition = True
    locked_outcome.save()
    record(
        AuditAction.OUTCOME_FINALISED,
        locked_outcome,
        (
            f"Final decision {final_outcome} recorded for "
            f"{locked_outcome.candidate.student}"
            + (
                f", overriding a proposed {locked_outcome.proposed_outcome}."
                if locked_outcome.proposed_outcome != final_outcome
                else "."
            )
        ),
        actor=actor,
        metadata={
            "proposed_outcome": locked_outcome.proposed_outcome,
            "final_outcome": final_outcome,
            "overrode_proposal": locked_outcome.proposed_outcome != final_outcome,
            "conditional_requirements": cleaned_conditions,
        },
    )
    return locked_outcome


def validate_candidate_outcome_can_be_deleted(outcome: CandidateOutcome) -> None:
    if outcome.status == CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"status": ["Finalised candidate outcomes cannot be deleted."]},
        )


def validate_promotion_eligibility(
    *,
    outcome: CandidateOutcome,
    candidate: GradingCandidate,
    assessment: CandidateAssessment,
    student: Student,
    effective_date: date,
) -> tuple[Rank, Rank]:
    if Promotion.objects.filter(outcome=outcome).exists():
        raise ValidationError({"outcome": ["Outcome already has a promotion."]})
    if Promotion.objects.filter(grading_candidate=candidate).exists():
        raise ValidationError(
            {"grading_candidate": ["Grading candidate already has a promotion."]},
        )
    if outcome.candidate_id != candidate.pk:
        raise ValidationError(
            {"outcome": ["Outcome must belong to the grading candidate."]},
        )
    if outcome.assessment_id != assessment.pk:
        raise ValidationError(
            {"assessment": ["Outcome assessment must match the locked assessment."]},
        )
    if assessment.candidate_id != candidate.pk:
        raise ValidationError(
            {"assessment": ["Outcome assessment must belong to the candidate."]},
        )
    if candidate.student_id != student.pk:
        raise ValidationError(
            {"student": ["Candidate student must match the promoted student."]},
        )
    if outcome.status != CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"status": ["Only finalised candidate outcomes can be promoted."]},
        )
    if outcome.final_outcome != CandidateOutcome.Outcome.PASS:
        raise ValidationError({"final_outcome": ["Only PASS outcomes are promotable."]})
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        raise ValidationError(
            {"candidate": ["Withdrawn candidates cannot be promoted."]},
        )
    if candidate.status != GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {"candidate": ["Candidate must be completed before promotion."]},
        )
    if assessment.status != CandidateAssessment.Status.COMPLETED:
        raise ValidationError(
            {"assessment": ["Assessment must be completed before promotion."]},
        )
    if candidate.session.status not in PROMOTION_SESSION_STATUSES:
        raise ValidationError(
            {"session": ["Promotions require a locked or completed grading session."]},
        )
    if effective_date != candidate.session.grading_date:
        raise ValidationError(
            {
                "effective_date": [
                    "Promotion effective date must equal the grading session date.",
                ],
            },
        )

    from_rank = student.current_rank
    to_rank = candidate.testing_for_rank
    if from_rank == to_rank:
        raise ValidationError(
            {"to_rank": ["Promotion target rank must differ from source rank."]},
        )
    next_rank = get_next_active_rank(from_rank)
    if next_rank is None:
        raise ValidationError({"to_rank": ["Student has no next active rank."]})
    if to_rank != next_rank:
        raise ValidationError(
            {
                "to_rank": [
                    "Candidate testing-for rank is no longer the next active "
                    "rank after the student's current rank.",
                ],
            },
        )
    return from_rank, to_rank


@transaction.atomic
def promote_candidate(
    outcome: CandidateOutcome,
    actor: User,
    notes: str = "",
) -> Promotion:
    """Promote a candidate whose outcome was a finalised PASS.

    The promotion is always dated the grading it came from, so there is no
    effective_date parameter: validation required any value passed to equal
    the session date, which made the argument redundant when correct and
    rejected when not.
    """
    validate_promotion_actor(actor)
    locked_outcome = (
        CandidateOutcome.objects.select_for_update(of=("self",))
        .select_related("candidate", "assessment")
        .get(pk=outcome.pk)
    )
    locked_candidate = (
        GradingCandidate.objects.select_for_update(of=("self",))
        .select_related("session", "student", "testing_for_rank")
        .get(pk=locked_outcome.candidate_id)
    )
    locked_assessment = CandidateAssessment.objects.select_for_update(of=("self",)).get(
        pk=locked_outcome.assessment_id,
    )
    locked_student = (
        Student.objects.select_for_update(of=("self",))
        .select_related("current_rank")
        .get(pk=locked_candidate.student_id)
    )
    candidate_effective_date = locked_candidate.session.grading_date
    from_rank, to_rank = validate_promotion_eligibility(
        outcome=locked_outcome,
        candidate=locked_candidate,
        assessment=locked_assessment,
        student=locked_student,
        effective_date=candidate_effective_date,
    )

    try:
        promotion = Promotion.objects.create(
            student=locked_student,
            outcome=locked_outcome,
            grading_candidate=locked_candidate,
            from_rank=from_rank,
            to_rank=to_rank,
            promoted_by=actor,
            effective_date=candidate_effective_date,
            notes=notes,
        )
    except IntegrityError as exc:
        raise ValidationError(
            {"promotion": ["Outcome or grading candidate already has a promotion."]},
        ) from exc

    updated = Student.objects.filter(pk=locked_student.pk).update(current_rank=to_rank)
    if updated != 1:
        raise ValidationError(
            {"student": ["Student current rank could not be updated."]},
        )
    locked_student.current_rank = to_rank
    record(
        AuditAction.PROMOTION_RECORDED,
        promotion,
        (f"{locked_student} promoted from {from_rank.name} to {to_rank.name}."),
        actor=actor,
        metadata={
            "from_rank": from_rank.code,
            "to_rank": to_rank.code,
            "effective_date": str(candidate_effective_date),
            "outcome": str(locked_outcome.pk),
        },
    )
    return Promotion.objects.select_related(
        "student__current_rank",
        "outcome",
        "grading_candidate__session",
        "from_rank",
        "to_rank",
        "promoted_by",
    ).get(pk=promotion.pk)


@transaction.atomic
def bulk_promote_candidates(
    *,
    outcomes: Sequence[CandidateOutcome],
    actor: User,
) -> tuple[list[Promotion], dict[str, list[str]]]:
    """Promote every outcome, independently of the others.

    Built for a Master clearing a whole cohort at once: any number of
    finalised PASS outcomes, from one to an entire session, promoted in a
    single request. Same independent-rows, savepoint-per-row shape as the
    other bulk endpoints - one outcome that is not eligible (not finalised,
    not a PASS, already promoted) does not block the rest. Returns the
    promotions that were created and a map of row index to error messages
    for the rest.
    """
    promoted: list[Promotion] = []
    errors: dict[str, list[str]] = {}
    for index, outcome in enumerate(outcomes):
        try:
            with transaction.atomic():
                promoted.append(promote_candidate(outcome, actor=actor))
        except ValidationError as exc:
            errors[str(index)] = exc.messages
    return promoted, errors


def student_rank_timeline(student: Student) -> StudentRankTimeline:
    timeline_student = Student.objects.select_related("current_rank").get(pk=student.pk)
    promotions = list(
        Promotion.objects.filter(student=timeline_student)
        .select_related(
            "student__current_rank",
            "outcome",
            "grading_candidate__session",
            "from_rank",
            "to_rank",
            "promoted_by",
        )
        .order_by("-effective_date", "-promoted_at", "-pk"),
    )
    return {
        "student": timeline_student,
        "current_rank": timeline_student.current_rank,
        "promotions": promotions,
    }


def unified_student_grading_history(student: Student) -> StudentGradingHistory:
    """Native finalised outcomes + linked, non-voided legacy records,
    source-labelled and date-precision-explicit (spec section 25).

    Deliberately separate from student_rank_timeline / `/rank-history/`,
    which stays Promotion-only (spec section 26) - this is a read model for
    display, not a second claim about rank history. A native item's
    "current rank at the time" is not tracked as its own field anywhere in
    the native workflow (only testing_for_rank is), so it is left out here
    rather than guessed from promotion history.
    """
    dated_items: list[tuple[date, GradingHistoryItem]] = []

    finalised_outcomes = CandidateOutcome.objects.filter(
        candidate__student=student,
        status=CandidateOutcome.Status.FINALISED,
    ).select_related("candidate__session", "candidate__testing_for_rank")
    for outcome in finalised_outcomes:
        session = outcome.candidate.session
        promotion = getattr(outcome, "promotion", None)
        testing_for_rank = outcome.candidate.testing_for_rank
        native_item: GradingHistoryItem = {
            "source": "KUKGRADE",
            "record_id": outcome.pk,
            "date": session.grading_date,
            "cycle_year": session.grading_date.year,
            "cycle_month": session.grading_date.month,
            "date_precision": "DAY",
            "testing_for_rank_code": testing_for_rank.code,
            "testing_for_rank_name": testing_for_rank.name,
            "source_testing_for_rank_text": "",
            "outcome": outcome.final_outcome,
            "attendance_status": "ATTENDED",
            "comments": outcome.decision_notes,
            "promotion_id": promotion.pk if promotion else None,
        }
        dated_items.append((session.grading_date, native_item))

    legacy_records = LegacyGradingRecord.objects.filter(
        student=student,
        is_void=False,
    ).select_related("testing_for_rank")
    for legacy in legacy_records:
        sort_date = legacy.grading_date or date(
            legacy.cycle_year,
            legacy.cycle_month,
            1,
        )
        legacy_item: GradingHistoryItem = {
            "source": "LEGACY",
            "record_id": legacy.pk,
            "date": legacy.grading_date,
            "cycle_year": legacy.cycle_year,
            "cycle_month": legacy.cycle_month,
            "date_precision": legacy.date_precision,
            "testing_for_rank_code": (
                legacy.testing_for_rank.code if legacy.testing_for_rank else None
            ),
            "testing_for_rank_name": (
                legacy.testing_for_rank.name if legacy.testing_for_rank else None
            ),
            "source_testing_for_rank_text": legacy.source_testing_for_rank_text,
            "outcome": legacy.outcome,
            "attendance_status": legacy.attendance_status,
            "comments": legacy.comments,
            "promotion_id": None,
        }
        dated_items.append((sort_date, legacy_item))

    dated_items.sort(key=lambda pair: pair[0], reverse=True)
    return {
        "student": student,
        "items": [item for _sort_date, item in dated_items],
    }


def candidate_assessment_summary(
    assessment: CandidateAssessment,
) -> CandidateAssessmentSummary:
    items = list(
        assessment.items.all().order_by("category", "requirement_sequence", "pk"),
    )
    category_order = dict(
        (category, index)
        for index, (category, _label) in enumerate(SyllabusItem.Category.choices)
    )
    category_summaries: dict[str, CategoryAssessmentSummary] = {}
    overall: OverallAssessmentSummary = {
        "total": 0,
        "required": 0,
        "met": 0,
        "not_met": 0,
        "not_assessed": 0,
        "required_met": 0,
        "required_not_met": 0,
        "required_not_assessed": 0,
        "all_required_assessed": True,
        "all_required_met": True,
    }

    for item in items:
        summary = category_summaries.setdefault(
            item.category,
            {
                "category": item.category,
                "total": 0,
                "required": 0,
                "met": 0,
                "not_met": 0,
                "not_assessed": 0,
                "required_met": 0,
                "required_not_met": 0,
                "required_not_assessed": 0,
                "all_required_assessed": True,
                "all_required_met": True,
            },
        )
        summary["total"] += 1
        overall["total"] += 1
        if item.required:
            summary["required"] += 1
            overall["required"] += 1

        if item.result == CandidateAssessmentItem.Result.MET:
            summary["met"] += 1
            overall["met"] += 1
            if item.required:
                summary["required_met"] += 1
                overall["required_met"] += 1
        elif item.result == CandidateAssessmentItem.Result.NOT_MET:
            summary["not_met"] += 1
            overall["not_met"] += 1
            if item.required:
                summary["required_not_met"] += 1
                summary["all_required_met"] = False
                overall["required_not_met"] += 1
        else:
            summary["not_assessed"] += 1
            overall["not_assessed"] += 1
            if item.required:
                summary["required_not_assessed"] += 1
                summary["all_required_assessed"] = False
                summary["all_required_met"] = False
                overall["required_not_assessed"] += 1

    overall["all_required_assessed"] = overall["required_not_assessed"] == 0
    overall["all_required_met"] = (
        overall["required_not_assessed"] == 0 and overall["required_not_met"] == 0
    )

    return {
        "overall": overall,
        "categories": sorted(
            category_summaries.values(),
            key=lambda summary: (
                category_order.get(str(summary["category"]), len(category_order)),
                str(summary["category"]),
            ),
        ),
    }


def build_candidate(
    *,
    session: GradingSession,
    student: Student,
    testing_for_rank: Rank,
    status: str = GradingCandidate.Status.REGISTERED,
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
    if student is not None:
        validate_student_can_be_graded(new_student)
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
    reverted_student_ranks: list[dict[str, object]] = []
    if actor is not None and actor.role == User.Role.ADMINISTRATOR:
        candidates = list(
            session.candidates.select_related(
                "student",
                "outcome__promotion__from_rank",
                "outcome__promotion__to_rank",
            ),
        )
        promotions_to_delete = []
        for candidate in candidates:
            outcome = getattr(candidate, "outcome", None)
            promotion = getattr(outcome, "promotion", None) if outcome else None
            if promotion is not None:
                validate_assessment_deletion_promotion(promotion, candidate.student)
                promotions_to_delete.append((candidate.student, promotion))
        for student, promotion in promotions_to_delete:
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
        CandidateOutcome.objects.filter(candidate__session=session).delete()

    # Recorded before the row goes, so the event still carries its identity.
    #
    # Deleting a session cascades its candidates away. Recording only the
    # session would leave those disappearances invisible, so the cascade is
    # captured here rather than emitting one event per candidate, which on a
    # twenty-candidate session would bury the deletion that caused it.
    cascaded = list(
        session.candidates.values_list("id", "student__wksa_id"),
    )
    record(
        AuditAction.SESSION_DELETED,
        session,
        (
            f"Grading session '{session.title}' deleted while {session.status}"
            + (
                f", removing {len(cascaded)} registered candidate(s)."
                if cascaded
                else "."
            )
        ),
        actor=actor,
        metadata={
            "status": session.status,
            "title": session.title,
            "cascaded_candidates": [
                {"id": candidate_id, "student_wksa_id": wksa_id}
                for candidate_id, wksa_id in cascaded
            ],
            "reverted_student_ranks": reverted_student_ranks,
        },
    )
    session.delete(actor=actor)


@transaction.atomic
def register_candidate(
    *,
    session: GradingSession,
    student: Student,
    testing_for_rank: Rank,
    status: str = GradingCandidate.Status.REGISTERED,
    notes: str = "",
    actor: User | None = None,
) -> GradingCandidate:
    candidate = build_candidate(
        session=session,
        student=student,
        testing_for_rank=testing_for_rank,
        status=status,
        notes=notes,
    )
    candidate.save()
    record(
        AuditAction.CANDIDATE_REGISTERED,
        candidate,
        (
            f"{student} registered for '{session.title}' testing for "
            f"{testing_for_rank.name}."
        ),
        actor=actor,
        metadata={"age_band": candidate.age_band},
    )
    return candidate


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

    This is adding candidates one at a time through the single-item endpoint,
    just in one request: a batch of ten students does not fail all ten
    because one of them was already registered. Each row runs in its own
    savepoint so one row's IntegrityError cannot poison the rows after it.

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
    """
    created: list[tuple[GradingCandidate, CandidateAssessment | None]] = []
    errors: dict[str, list[str]] = {}
    for index, row in enumerate(rows):
        try:
            with transaction.atomic():
                row_student = cast(Student, row["student"])
                testing_for_rank = cast(Rank | None, row.get("testing_for_rank"))
                if testing_for_rank is None:
                    testing_for_rank = get_next_active_rank(row_student.current_rank)
                    if testing_for_rank is None:
                        raise ValidationError(
                            {"testing_for_rank": ["Student has no next active rank."]},
                        )
                registered = register_candidate(
                    session=session,
                    student=row_student,
                    testing_for_rank=testing_for_rank,
                    notes=cast(str, row.get("notes", "")),
                    actor=actor,
                )
                generated_assessment = None
                if generate_assessments:
                    if actor is None:
                        raise ValidationError(
                            {
                                "actor": [
                                    "An actor is required to generate assessments."
                                ]
                            },
                        )
                    generated_assessment = generate_candidate_assessment(
                        registered,
                        actor,
                    )
                created.append((registered, generated_assessment))
        except ValidationError as exc:
            # `.messages` always flattens to a list of strings regardless of
            # whether the underlying error is dict- or list-shaped.
            errors[str(index)] = exc.messages
    return created, errors


def _candidate_snapshot(candidate: GradingCandidate) -> dict[str, object]:
    return {
        "session": candidate.session_id,
        "student": candidate.student_id,
        "testing_for_rank": candidate.testing_for_rank_id,
        "status": candidate.status,
        "notes": candidate.notes,
    }


@transaction.atomic
def apply_candidate_update(
    candidate: GradingCandidate,
    *,
    session: GradingSession | None = None,
    student: Student | None = None,
    testing_for_rank: Rank | None = None,
    status: str | None = None,
    notes: str | None = None,
    actor: User | None = None,
) -> GradingCandidate:
    # Read fresh from the database rather than snapshotting the `candidate`
    # argument as received: Django admin's own save flow constructs the new
    # field values onto this exact instance before save_model() ever runs,
    # so by the time this function saw it here it could already carry the
    # new values - which would make every real admin edit look like a no-op
    # and go unrecorded. The API path is unaffected either way, since DRF
    # passes the unmodified instance.
    before = _candidate_snapshot(GradingCandidate.objects.get(pk=candidate.pk))
    updated = update_candidate(
        candidate,
        session=session,
        student=student,
        testing_for_rank=testing_for_rank,
        status=status,
        notes=notes,
    )
    updated.save()

    after = _candidate_snapshot(updated)
    if before == after:
        # A no-op PATCH (resending the same values) writes nothing: an audit
        # trail exists to show what changed, and nothing did.
        return updated

    record(
        AuditAction.CANDIDATE_UPDATED,
        updated,
        f"Candidate record for {updated.student} updated.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return updated


@transaction.atomic
def delete_candidate(candidate: GradingCandidate, actor: User | None = None) -> None:
    record(
        AuditAction.CANDIDATE_DELETED,
        candidate,
        f"{candidate.student} removed from '{candidate.session.title}'.",
        actor=actor,
        metadata={"status": candidate.status},
    )
    candidate.delete()


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
    locked = (
        CandidateAssessment.objects.select_for_update(of=("self",))
        .select_related("candidate__student", "candidate__session")
        .get(pk=assessment.pk)
    )
    outcome = getattr(locked, "outcome", None)
    promotion = getattr(outcome, "promotion", None) if outcome else None

    reverted_rank: dict[str, str] | None = None
    if promotion is not None:
        student = locked.candidate.student
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
        GradingCandidate.objects.select_for_update(of=("self",))
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

    Same independent-rows shape as `bulk_register_candidates`: one
    candidate's assessment already existing does not block generation for
    the rest of the batch. Returns the assessments that were created and a
    map of row index to error messages for the rest.
    """
    created: list[CandidateAssessment] = []
    errors: dict[str, list[str]] = {}
    for index, candidate in enumerate(candidates):
        try:
            with transaction.atomic():
                created.append(
                    generate_candidate_assessment(candidate, generated_by),
                )
        except ValidationError as exc:
            errors[str(index)] = exc.messages
    return created, errors


@transaction.atomic
def bulk_update_candidate_status(
    *,
    candidates: Sequence[GradingCandidate],
    new_status: str,
    actor: User | None = None,
) -> tuple[list[GradingCandidate], dict[str, list[str]]]:
    """Set `new_status` on every candidate, independently of the others.

    Built for confirming attendance in bulk: tick the candidates who did not
    show up, set WITHDRAWN, and confirm - the rest are left untouched. One
    candidate's session already being locked does not block the others.
    Returns the candidates that were updated and a map of row index to error
    messages for the rest.
    """
    updated: list[GradingCandidate] = []
    errors: dict[str, list[str]] = {}
    for index, candidate in enumerate(candidates):
        try:
            with transaction.atomic():
                updated.append(
                    apply_candidate_update(
                        candidate,
                        status=new_status,
                        actor=actor,
                    ),
                )
        except ValidationError as exc:
            errors[str(index)] = exc.messages
    return updated, errors


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
    actor: User | None = None,
) -> CandidateAssessment:
    locked_assessment = (
        CandidateAssessment.objects.select_for_update(of=("self",))
        .select_related("candidate__session")
        .get(pk=assessment.pk)
    )
    if locked_assessment.status == CandidateAssessment.Status.COMPLETED:
        raise ValidationError({"status": ["Completed assessments are immutable."]})

    if notes is not None:
        locked_assessment.notes = notes

    recorded_action: str | None = None
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

    locked_assessment.save()
    if recorded_action is not None:
        record(
            recorded_action,
            locked_assessment,
            (
                f"Assessment for {locked_assessment.candidate.student} "
                f"{locked_assessment.get_status_display().lower()}."
            ),
            actor=actor,
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
    since locked, does not block the rest. Same independent-rows,
    savepoint-per-row shape as the other bulk endpoints.
    """
    started: list[CandidateAssessment] = []
    errors: dict[str, list[str]] = {}
    for index, assessment in enumerate(assessments):
        try:
            with transaction.atomic():
                started.append(
                    update_candidate_assessment(
                        assessment,
                        status=CandidateAssessment.Status.IN_PROGRESS,
                        actor=actor,
                    ),
                )
        except ValidationError as exc:
            errors[str(index)] = exc.messages
    return started, errors


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
        CandidateAssessmentItem.objects.select_for_update(of=("self",))
        .select_related("assessment__candidate__session", "assessment__candidate")
        .get(pk=item.pk)
    )
    validate_assessment_item_can_be_changed(locked_item, result=result)
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
