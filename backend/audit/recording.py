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


def record(
    action: str,
    entity: models.Model,
    summary: str,
    actor: User | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    return AuditEvent.objects.create(
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
    events = [
        AuditEvent(
            actor=actor,
            actor_email=actor.email if actor else "",
            actor_name=actor.get_full_name() if actor else "",
            action=action,
            entity_type=entity.__class__.__name__,
            entity_id=str(entity.pk),
            summary=summary,
            metadata={},
        )
        for entity, summary in entries
    ]
    for event in events:
        event.full_clean(exclude=["actor"], validate_constraints=False)
    return AuditEvent.objects.bulk_create(events, batch_size=500)
