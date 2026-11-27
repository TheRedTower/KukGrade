"""The single way an audit event is written.

`record()` is always called inside the caller's existing transaction, so an
event cannot survive an action that rolled back. A trail claiming something
happened when it did not is worse than no trail.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from django.db import models

from accounts.models import User
from accounts.people import name_of, title_of
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


# What a person types: notes, reasons and conditions. They can name a child or
# say anything about one, so the log records that one was written or changed,
# by whom and when, never the words; the record itself holds them.
TYPED_TEXT = frozenset(
    {
        "notes",
        "proposal_notes",
        "withdrawal_note",
        "cancellation_reason",
        "conditional_requirements",
        "decision_notes",
        "void_reason",
    },
)


def changes(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    *,
    kept_out: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """A revision, for an event's metadata: `before` and `after`, and every
    field that differs in `changed_fields`. Typed text and the fields in
    `kept_out` are recorded only as having changed, never by value."""
    left_out = TYPED_TEXT | kept_out
    return {
        "changed_fields": [
            key
            for key in [*before, *(k for k in after if k not in before)]
            if before.get(key) != after.get(key)
        ],
        "before": {k: v for k, v in before.items() if k not in left_out},
        "after": {k: v for k, v in after.items() if k not in left_out},
    }


def _typed_text_in(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        found = {key for key in value if key in TYPED_TEXT}
        for item in value.values():
            found |= _typed_text_in(item)
        return found
    if isinstance(value, list):
        return set().union(*(_typed_text_in(item) for item in value))
    return set()


def _build(
    action: str,
    entity: models.Model,
    summary: str,
    actor: User | None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    if typed := _typed_text_in(metadata):
        msg = f"An audit event records typed text only as changed: {sorted(typed)}."
        raise ValueError(msg)
    return AuditEvent(
        actor=actor,
        actor_email=actor.email if actor else "",
        actor_name=name_of(actor) if actor else "",
        actor_title=title_of(actor),
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
