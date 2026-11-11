"""The history of one record: its own events and everything that belongs to it.

A link from a record to "its audit log" must show that record's story, not the
whole log narrowed by a number. A grading's story is the grading, and the
registrations, assessments, marks, outcomes and promotions inside it; a student's
is their own record and every grading event about them; a user's is what was
done to their account and what they did.

Events name what they are about by `entity_type` and `entity_id`, and the
grading ones also carry `session_id`, `candidate_id` and `student_id` in their
details (audit.recording.grading_context). Older events carry fewer, so the
records that still exist are followed by their ids too, and the two together
cover both. The apps recorded are reached by name, so the log keeps no import of
them.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.apps import apps
from django.db.models import CharField, Q, QuerySet
from django.db.models.functions import Cast

from audit.models import AuditEntity, AuditEvent

SESSION = "session"
STUDENT = "student"
CANDIDATE = "candidate"
USER = "user"
KINDS = (SESSION, STUDENT, CANDIDATE, USER)


def parse(value: str) -> tuple[str, str] | None:
    """`kind:id` as a link writes it, or None for anything else."""
    kind, _, ident = value.partition(":")
    if kind not in KINDS or not ident.strip() or len(ident) > 64:
        return None
    return kind, ident.strip()


def _model(label: str) -> Any:
    app, name = label.split(".")
    return apps.get_model(app, name)


def _ids(queryset: QuerySet[Any]) -> QuerySet[Any]:
    """The rows' ids as text, which is how an event holds an entity_id."""
    texts: QuerySet[Any] = queryset.annotate(_text_id=Cast("pk", CharField()))
    return texts.values("_text_id")


def _belonging_to_candidates(candidates: QuerySet[Any]) -> Q:
    """Events about these registrations and what hangs off each of them."""
    assessments = _model("gradings.CandidateAssessment").objects.filter(
        candidate__in=candidates,
    )
    items = _model("gradings.CandidateAssessmentItem").objects.filter(
        assessment__candidate__in=candidates,
    )
    outcomes = _model("gradings.CandidateOutcome").objects.filter(
        candidate__in=candidates,
    )
    promotions = _model("gradings.Promotion").objects.filter(
        grading_candidate__in=candidates,
    )
    return (
        Q(entity_type=AuditEntity.GRADING_CANDIDATE, entity_id__in=_ids(candidates))
        | Q(
            entity_type=AuditEntity.CANDIDATE_ASSESSMENT,
            entity_id__in=_ids(assessments),
        )
        | Q(
            entity_type=AuditEntity.CANDIDATE_ASSESSMENT_ITEM, entity_id__in=_ids(items)
        )
        | Q(entity_type=AuditEntity.CANDIDATE_OUTCOME, entity_id__in=_ids(outcomes))
        | Q(entity_type=AuditEntity.PROMOTION, entity_id__in=_ids(promotions))
    )


def events_of(queryset: QuerySet[AuditEvent], value: str) -> QuerySet[AuditEvent]:
    """The events in `queryset` that belong to the record `value` names."""
    parsed = parse(value)
    if parsed is None:
        return queryset.none()
    kind, ident = parsed
    if kind == USER:
        account = _uuid(ident)
        if account is None:
            # Not an account at all: nothing, never "events with no actor".
            return queryset.none()
        return queryset.filter(
            Q(entity_type=AuditEntity.USER, entity_id=str(account))
            | Q(actor_id=account),
        )
    if not ident.isdecimal():
        return queryset.none()
    number = int(ident)
    candidates = _model("gradings.GradingCandidate").objects
    if kind == SESSION:
        return queryset.filter(
            Q(entity_type=AuditEntity.GRADING_SESSION, entity_id=ident)
            | _belonging_to_candidates(candidates.filter(session_id=number))
            | Q(metadata__session_id=number),
        )
    if kind == CANDIDATE:
        return queryset.filter(
            # Its own events, even once the registration is gone (a removed
            # candidate's registration and removal are still in the log).
            Q(entity_type=AuditEntity.GRADING_CANDIDATE, entity_id=ident)
            | _belonging_to_candidates(candidates.filter(pk=number))
            | Q(metadata__candidate_id=number),
        )
    return queryset.filter(
        Q(entity_type=AuditEntity.STUDENT, entity_id=ident)
        | _belonging_to_candidates(candidates.filter(student_id=number))
        | Q(metadata__student_id=number),
    )


def _uuid(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


def describe(value: str) -> dict[str, Any]:
    """What a history is of: its kind, its ids and its current name.

    The ids are what the app needs to open the record (a registration opens
    inside its grading, so a candidate also names its `session_id`); the app
    keeps its own routes. `exists` is false and `name` empty once the record
    no longer exists (a deleted student's events are still there), so a
    screen can say so.
    """
    parsed = parse(value)
    if parsed is None:
        return {
            "kind": "",
            "id": value,
            "session_id": None,
            "name": "",
            "exists": False,
        }
    kind, ident = parsed
    name, session_id, row = "", None, None
    if ident.isdecimal() or kind == USER:
        if kind == SESSION:
            row = _model("gradings.GradingSession").objects.filter(pk=ident).first()
            if row is not None:
                name = f"{row.title} ({row.grading_date:%d %B %Y})"
        elif kind == STUDENT:
            row = _model("students.Student").objects.filter(pk=ident).first()
            if row is not None:
                name = str(row)
        elif kind == CANDIDATE:
            row = (
                _model("gradings.GradingCandidate")
                .objects.select_related("student", "session")
                .filter(pk=ident)
                .first()
            )
            if row is not None:
                name, session_id = str(row), row.session_id
        else:
            row = _model("accounts.User").objects.filter(pk=_uuid(ident)).first()
            if row is not None:
                name = row.get_full_name()
    return {
        "kind": kind,
        "id": ident,
        "session_id": session_id,
        "name": name,
        "exists": row is not None,
    }
