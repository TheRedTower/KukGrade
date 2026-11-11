from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.utils import timezone

from accounts.models import User
from accounts.people import title_of
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from audit.models import AuditAction
from audit.recording import grading_context, record, student_label
from gradings.locking import (
    lock_assessment,
    lock_candidate,
    lock_outcome,
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
    StagedDecision,
)
from gradings.service_support import each_independently, unique_violation_on
from gradings.services import NO_NEXT_RANK_MESSAGE, get_next_active_rank
from ranks.models import Rank
from students import wksa_ids
from students.models import Student

PROMOTION_SESSION_STATUSES = {
    GradingSession.Status.LOCKED,
    GradingSession.Status.COMPLETED,
}


def _outcome_label(outcome: str | None) -> str:
    """An outcome as the screens name it ("Pass"), for an audit summary."""
    return str(CandidateOutcome.Outcome(outcome).label) if outcome else "none"


@dataclass(frozen=True)
class PromotionEligibilityFacts:
    """One request's promotion and rank facts; never cached across requests."""

    promoted_outcomes: frozenset[int]
    promoted_candidates: frozenset[int]
    # Each rank's next active rank, by id (Rank.objects.next_rank_ids).
    next_rank_ids: dict[int, int | None]


def validate_outcome_assessment_state(outcome: CandidateOutcome) -> None:
    if outcome.assessment.status != CandidateAssessment.Status.COMPLETED:
        raise ValidationError(
            {"assessment": ["Candidate assessment must remain completed."]},
        )
    if outcome.candidate.status != GradingCandidate.Status.COMPLETED:
        raise ValidationError(
            {"candidate": ["Grading candidate must remain completed."]},
        )


def validate_candidate_outcome_creation(candidate: GradingCandidate) -> None:
    if candidate.session.status != GradingSession.Status.LOCKED:
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
def propose_for_candidate(
    candidate: GradingCandidate,
    proposed_outcome: str,
    proposal_notes: str,
    actor: User,
) -> CandidateOutcome:
    """Propose an outcome for a candidate in one step.

    The candidate's outcome record is born with the first proposal and revised
    by later ones, decided under the session lock so two proposals arriving
    together cannot both try to open it. A record never exists without one.
    """
    locked_candidate = lock_candidate(candidate.pk)
    existing = CandidateOutcome.objects.filter(candidate=locked_candidate).first()
    if existing is not None:
        return propose_candidate_outcome(
            existing,
            proposed_outcome,
            proposal_notes,
            actor,
        )
    validate_candidate_outcome_creation(locked_candidate)
    _validate_outcome_choice(proposed_outcome, "proposed_outcome")
    try:
        outcome = CandidateOutcome.objects.create(
            candidate=locked_candidate,
            assessment=locked_candidate.assessment,
            status=CandidateOutcome.Status.PROPOSED,
            proposed_outcome=proposed_outcome,
            proposal_notes=proposal_notes,
            proposed_by=actor,
            proposed_by_title=title_of(actor),
            proposed_at=timezone.now(),
        )
    except IntegrityError as exc:
        if not unique_violation_on(exc, CandidateOutcome):
            raise
        raise ValidationError(
            {"candidate": ["Candidate already has an outcome."]},
        ) from exc
    record(
        AuditAction.OUTCOME_CREATED,
        outcome,
        f"Outcome record opened for {student_label(locked_candidate.student)}.",
        actor=actor,
        metadata=grading_context(locked_candidate),
    )
    _record_proposal(outcome, None, actor)
    return outcome


def _validate_outcome_choice(value: str, field_name: str) -> None:
    if value not in CandidateOutcome.Outcome.values:
        raise ValidationError({field_name: ["That is not a valid outcome."]})


def _record_proposal(
    outcome: CandidateOutcome,
    previous: dict[str, str | None] | None,
    actor: User,
) -> None:
    # `before` is what makes a disagreement visible: without it the Master
    # sees only the latest proposal and no sign it ever said anything else.
    before = previous or {
        "proposed_outcome": None,
        "proposal_notes": "",
        "proposed_by": None,
    }
    record(
        AuditAction.OUTCOME_PROPOSED,
        outcome,
        (
            f"Outcome proposed as {_outcome_label(outcome.proposed_outcome)}"
            + (
                f", revising an earlier {_outcome_label(before['proposed_outcome'])}."
                if before["proposed_outcome"]
                else "."
            )
        ),
        actor=actor,
        metadata={
            "before": before,
            "after": {
                "proposed_outcome": outcome.proposed_outcome,
                "proposal_notes": outcome.proposal_notes,
                "proposed_by": str(actor.pk),
            },
            **grading_context(outcome.candidate),
        },
    )


@transaction.atomic
def propose_candidate_outcome(
    outcome: CandidateOutcome,
    proposed_outcome: str,
    proposal_notes: str,
    actor: User,
) -> CandidateOutcome:
    locked_outcome = lock_outcome(outcome.pk)
    validate_outcome_assessment_state(locked_outcome)
    if locked_outcome.status == CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"status": ["A final decision cannot be proposed again."]},
        )
    # As for the first proposal: once the session is cancelled or completed,
    # nothing about its outcomes moves.
    if locked_outcome.candidate.session.status != GradingSession.Status.LOCKED:
        raise ValidationError(
            {"session": ["Outcomes can only be proposed in locked sessions."]},
        )
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
    locked_outcome.proposed_by_title = title_of(actor)
    locked_outcome.proposed_at = timezone.now()
    locked_outcome.final_outcome = None
    locked_outcome.decided_by = None
    locked_outcome.decided_by_title = ""
    locked_outcome.decided_at = None
    locked_outcome.decision_notes = ""
    locked_outcome.conditional_requirements = ""
    locked_outcome.status = CandidateOutcome.Status.PROPOSED
    locked_outcome.save()
    _record_proposal(locked_outcome, previous_proposal, actor)
    return locked_outcome


def validate_final_decision_actor(actor: User) -> None:
    if not actor.has_perm(FINAL_GRADING_DECISION_PERMISSION):
        raise ValidationError(
            {"actor": ["Final grading decision authority is required."]},
        )


def validate_promotion_actor(actor: User) -> None:
    if not actor.has_perm(PROMOTE_STUDENT_PERMISSION):
        raise ValidationError(
            {"actor": ["Student promotion authority is required."]},
        )


def validate_outcome_can_be_finalised(outcome: CandidateOutcome) -> None:
    """The rules about the outcome itself, whoever is deciding it."""
    validate_outcome_assessment_state(outcome)
    if outcome.status != CandidateOutcome.Status.PROPOSED:
        raise ValidationError(
            {"status": ["Only proposed candidate outcomes can be finalised."]},
        )
    if outcome.candidate.session.status != GradingSession.Status.LOCKED:
        raise ValidationError(
            {"session": ["Final decisions can only be made in locked sessions."]},
        )
    if outcome.proposed_outcome is None:
        raise ValidationError(
            {"proposed_outcome": ["Proposed outcome is required before finalisation."]},
        )


def outcome_can_be_finalised(outcome: CandidateOutcome) -> bool:
    try:
        validate_outcome_can_be_finalised(outcome)
    except ValidationError:
        return False
    return True


@transaction.atomic
def finalise_candidate_outcome(
    outcome: CandidateOutcome,
    final_outcome: str,
    decision_notes: str,
    conditional_requirements: str,
    actor: User,
) -> CandidateOutcome:
    validate_final_decision_actor(actor)
    locked_outcome = lock_outcome(outcome.pk)
    validate_outcome_can_be_finalised(locked_outcome)
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

    # Recorded, so nobody's staged copy of this decision is wanted any more.
    StagedDecision.objects.filter(outcome=locked_outcome).delete()
    locked_outcome.final_outcome = final_outcome
    locked_outcome.decision_notes = decision_notes
    locked_outcome.conditional_requirements = cleaned_conditions
    locked_outcome.decided_by = actor
    locked_outcome.decided_by_title = title_of(actor)
    locked_outcome.decided_at = timezone.now()
    locked_outcome.status = CandidateOutcome.Status.FINALISED
    locked_outcome.save()
    record(
        AuditAction.OUTCOME_FINALISED,
        locked_outcome,
        (
            f"Final decision {_outcome_label(final_outcome)} recorded for "
            f"{student_label(locked_outcome.candidate.student)}"
            + (
                ", overriding a proposed "
                f"{_outcome_label(locked_outcome.proposed_outcome)}."
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
            **grading_context(locked_outcome.candidate),
        },
    )
    return locked_outcome


@transaction.atomic
def stage_final_decision(
    outcome: CandidateOutcome,
    final_outcome: str,
    decision_notes: str,
    conditional_requirements: str,
    actor: User,
) -> StagedDecision:
    """Keep the actor's chosen decision, unrecorded, until they record it.

    Not audited: it decides nothing and changes no record. Recording it is
    what is audited, by finalise_candidate_outcome.
    """
    validate_final_decision_actor(actor)
    locked_outcome = lock_outcome(outcome.pk)
    if not outcome_can_be_finalised(locked_outcome):
        raise ValidationError(
            {"status": ["This candidate's decision can no longer be staged."]},
        )
    _validate_outcome_choice(final_outcome, "final_outcome")
    staged, _created = StagedDecision.objects.update_or_create(
        outcome=locked_outcome,
        author=actor,
        defaults={
            "final_outcome": final_outcome,
            "decision_notes": decision_notes,
            "conditional_requirements": conditional_requirements,
        },
    )
    return staged


def discard_staged_decision(outcome: CandidateOutcome, actor: User) -> None:
    """Drop the actor's staged decision for this outcome, if there is one."""
    validate_final_decision_actor(actor)
    StagedDecision.objects.filter(outcome=outcome, author=actor).delete()


def staged_decisions_for_session(
    session_id: int,
    actor: User,
) -> QuerySet[StagedDecision]:
    """The actor's own staged decisions in a session that can still be recorded."""
    validate_final_decision_actor(actor)
    return StagedDecision.objects.filter(
        author=actor,
        outcome__candidate__session_id=session_id,
        outcome__in=CandidateOutcome.objects.can_be_finalised(),
    ).order_by("outcome_id")


def validate_promotion_eligibility(
    *,
    outcome: CandidateOutcome,
    candidate: GradingCandidate,
    assessment: CandidateAssessment,
    student: Student,
    facts: PromotionEligibilityFacts | None = None,
) -> tuple[Rank, Rank]:
    if (
        outcome.pk in facts.promoted_outcomes
        if facts is not None
        else Promotion.objects.filter(outcome=outcome).exists()
    ):
        raise ValidationError({"outcome": ["Outcome already has a promotion."]})
    if (
        candidate.pk in facts.promoted_candidates
        if facts is not None
        else Promotion.objects.filter(grading_candidate=candidate).exists()
    ):
        raise ValidationError(
            {"grading_candidate": ["Grading candidate already has a promotion."]},
        )
    if outcome.status != CandidateOutcome.Status.FINALISED:
        raise ValidationError(
            {"status": ["Only finalised candidate outcomes can be promoted."]},
        )
    if outcome.final_outcome != CandidateOutcome.Outcome.PASS:
        raise ValidationError({"final_outcome": ["Only a pass can be promoted."]})
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

    from_rank = student.current_rank
    to_rank = candidate.testing_for_rank
    if from_rank == to_rank:
        raise ValidationError(
            {"to_rank": ["Promotion target rank must differ from source rank."]},
        )
    if facts is not None:
        next_rank_id = facts.next_rank_ids.get(from_rank.pk)
    else:
        next_rank = get_next_active_rank(from_rank)
        next_rank_id = next_rank.pk if next_rank is not None else None
    if next_rank_id is None:
        raise ValidationError({"to_rank": [NO_NEXT_RANK_MESSAGE]})
    if to_rank.pk != next_rank_id:
        raise ValidationError(
            {
                "to_rank": [
                    "Candidate testing-for rank is no longer the next active "
                    "rank after the student's current rank.",
                ],
            },
        )
    # The promotion writes the rank directly, past Student.clean(), so the
    # rule that a black belt holds a black belt ID is checked here too: the
    # ID WKSA handed out at the national grading is recorded first.
    if (
        to_rank.category == Rank.Category.BLACK_BELT
        and wksa_ids.form_of(student.wksa_id) is not wksa_ids.BLACK_BELT_ID
    ):
        raise ValidationError(
            {
                "student": [
                    f"Record {student.first_name} {student.last_name}'s black "
                    "belt ID, such as A-20819, before promoting them to "
                    f"{to_rank.name}.",
                ],
            },
        )
    return from_rank, to_rank


def promotion_eligibility_for_session(session_id: int) -> list[dict[str, object]]:
    """Use command-time policy for the ledger, with bounded query count."""
    candidates = GradingCandidate.objects.filter(session_id=session_id).select_related(
        "session", "student__current_rank", "testing_for_rank", "assessment", "outcome"
    )
    promoted = list(
        Promotion.objects.filter(grading_candidate__session_id=session_id).values_list(
            "outcome_id", "grading_candidate_id"
        )
    )
    facts = PromotionEligibilityFacts(
        promoted_outcomes=frozenset(outcome_id for outcome_id, _ in promoted),
        promoted_candidates=frozenset(candidate_id for _, candidate_id in promoted),
        next_rank_ids=Rank.objects.next_rank_ids(),
    )
    answer: list[dict[str, object]] = []
    for candidate in candidates:
        outcome = getattr(candidate, "outcome", None)
        assessment = getattr(candidate, "assessment", None)
        reason = ""
        if outcome is None:
            reason = "Outcome pending finalisation."
        elif assessment is None:
            reason = "Candidate has no assessment."
        else:
            try:
                validate_promotion_eligibility(
                    outcome=outcome,
                    candidate=candidate,
                    assessment=assessment,
                    student=candidate.student,
                    facts=facts,
                )
            except ValidationError as exc:
                reason = next(iter(exc.message_dict.values()))[0]
        answer.append(
            {
                "candidate": candidate.pk,
                "outcome": outcome.pk if outcome is not None else None,
                "eligible": not reason,
                "reason": reason,
            }
        )
    return answer


@transaction.atomic
def promote_candidate(
    outcome: CandidateOutcome,
    actor: User,
    notes: str = "",
) -> Promotion:
    """Promote a candidate whose outcome was a finalised PASS, dated the
    grading it came from."""
    validate_promotion_actor(actor)
    locked_outcome = lock_outcome(outcome.pk)
    locked_candidate = lock_candidate(locked_outcome.candidate_id)
    locked_assessment = lock_assessment(locked_outcome.assessment_id)
    locked_student = lock_student(locked_candidate.student_id)
    candidate_effective_date = locked_candidate.session.grading_date
    from_rank, to_rank = validate_promotion_eligibility(
        outcome=locked_outcome,
        candidate=locked_candidate,
        assessment=locked_assessment,
        student=locked_student,
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
        if not unique_violation_on(exc, Promotion):
            raise
        raise ValidationError(
            {"promotion": ["Outcome or grading candidate already has a promotion."]},
        ) from exc

    Student.objects.filter(pk=locked_student.pk).update(current_rank=to_rank)
    locked_student.current_rank = to_rank
    record(
        AuditAction.PROMOTION_RECORDED,
        promotion,
        (
            f"{student_label(locked_student, first=True)} promoted from "
            f"{from_rank.name} to {to_rank.name}."
        ),
        actor=actor,
        metadata={
            "from_rank": from_rank.code,
            "to_rank": to_rank.code,
            "effective_date": str(candidate_effective_date),
            "outcome": str(locked_outcome.pk),
            **grading_context(locked_candidate),
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
    single request. One outcome that is not eligible (not finalised, not a
    PASS, already promoted) does not block the rest.

    Every session and student is locked before the first row: taken row by
    row, the students would be locked in row order, which is how two
    batches - or a batch and a session cleanup - came to hold each other's
    students.
    """
    pinned = lock_sessions_of(
        CandidateOutcome,
        [outcome.pk for outcome in outcomes],
        "candidate__session_id",
    )
    lock_students(
        CandidateOutcome.objects.filter(pk__in=pinned).values_list(
            "candidate__student_id",
            flat=True,
        ),
    )

    def promote(outcome: CandidateOutcome) -> Promotion:
        require_pinned(outcome.pk, pinned, "outcome")
        return promote_candidate(outcome, actor=actor)

    return each_independently(outcomes, promote, key=lambda outcome: outcome.pk)
