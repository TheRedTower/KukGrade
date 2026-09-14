"""The single way an audit event is written.

`record()` is always called inside the caller's existing transaction, so an
event cannot survive an action that rolled back. A trail claiming something
happened when it did not is worse than no trail.
"""

from __future__ import annotations

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
        action=action,
        entity_type=type(entity).__name__,
        entity_id=str(entity.pk),
        summary=summary,
        metadata=metadata or {},
    )
