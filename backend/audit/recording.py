"""The single way an audit event is written.

`record()` is always called inside the caller's existing transaction, so an
event cannot survive an action that rolled back. A trail claiming something
happened when it did not is worse than no trail.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from django.db import models

from accounts.models import User
from audit.models import AuditEvent


def student_label(student: models.Model, *, first: bool = False) -> str:
    """How an event refers to a student: by WKSA ID only, never by name.

    The audit log is permanent, so it holds no names or dates of birth. Screens
    resolve the current name from the student's id while the student exists.
    """
    wksa_id = getattr(student, "wksa_id")  # noqa: B009 - any model with an ID
    return f"{'Student' if first else 'student'} {wksa_id}"


def grading_context(candidate: models.Model) -> dict[str, int]:
    """Where a grading event happened, by id: whose, which registration, which
    session. It is what lets a record's history gather everything that belongs to
    it (a session's events include its candidates' marks and decisions) without
    a name in the log."""
    return {
        "student_id": getattr(candidate, "student_id"),  # noqa: B009
        "candidate_id": candidate.pk,
        "session_id": getattr(candidate, "session_id"),  # noqa: B009
    }


def _build(
    action: str,
    entity: models.Model,
    summary: str,
    actor: User | None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    return AuditEvent(
        actor=actor,
        actor_email=actor.email if actor else "",
        actor_name=actor.get_full_name() if actor else "",
        action=action,
        # entity.__class__, not type(entity): request.user is a
        # SimpleLazyObject, which proxies __class__ to the real model but
        # reports itself under type(). Recording "SimpleLazyObject" made
        # AuditEvent.entity_type fail its choices validation, which is how
        # self-service password change came to 400 for a genuinely
        # session-authenticated caller.
        entity_type=entity.__class__.__name__,
        entity_id=str(entity.pk),
        summary=summary,
        metadata=metadata or {},
    )


def record(
    action: str,
    entity: models.Model,
    summary: str,
    actor: User | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    event = _build(action, entity, summary, actor, metadata)
    event.save(force_insert=True)
    return event


def record_many(
    action: str,
    entries: Sequence[tuple[models.Model, str]],
    actor: User | None = None,
) -> list[AuditEvent]:
    """One event per (entity, summary), written together - as record() would
    one at a time, for an action done to many rows at once (a roster import).

    Each is validated as AuditEvent.save() would, less what would cost a
    query per event: the actor is the caller's own, and the check
    constraints (no blank type, id or summary) are the database's on insert.
    """
    events = [_build(action, entity, summary, actor) for entity, summary in entries]
    for event in events:
        event.full_clean(exclude=["actor"], validate_constraints=False)
    return AuditEvent.objects.bulk_create(events, batch_size=500)
