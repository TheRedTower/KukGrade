"""Erasing one student's personal details from events written before the log
stopped recording them.

The audit log is permanent, and `AuditEvent` refuses every change. Older events
(written before 2026-11) copied a student's name and date of birth into their
summaries and snapshots. This is the one sanctioned way to remove them: it
rewrites only those details, leaves every event, its action, actor and time
as they were, and records that it happened.

It is run by an operator from the command line (`manage.py
redact_student_audit`, see docs/privacy.md), never through the API.
"""

from __future__ import annotations

from typing import Any

from django.db import models, transaction

from audit.models import AuditAction, AuditEntity, AuditEvent

NAME_ERASED = "[name erased]"
PERSONAL_KEYS = ("first_name", "last_name", "date_of_birth")


def _redact_text(text: str, *, wksa_id: str, full_name: str) -> str:
    # The old form was "<name> (<WKSA ID>)"; keep the ID, which is the reference.
    text = text.replace(f"Student {full_name} ({wksa_id})", f"Student {wksa_id}")
    text = text.replace(f"{full_name} ({wksa_id})", f"student {wksa_id}")
    return text.replace(full_name, NAME_ERASED)


def _redact_value(value: Any, *, wksa_id: str, full_name: str) -> Any:
    if isinstance(value, str):
        return _redact_text(value, wksa_id=wksa_id, full_name=full_name)
    if isinstance(value, list):
        return [_redact_value(v, wksa_id=wksa_id, full_name=full_name) for v in value]
    if isinstance(value, dict):
        # A snapshot of this student: the personal fields go, whatever they were
        # (a name edited later is in an earlier snapshot under the same ID).
        own = value.get("wksa_id") == wksa_id
        return {
            key: _redact_value(item, wksa_id=wksa_id, full_name=full_name)
            for key, item in value.items()
            if not (own and key in PERSONAL_KEYS)
        }
    return value


def redact_student_details(
    *,
    wksa_id: str,
    first_name: str,
    last_name: str,
    dry_run: bool = False,
) -> int:
    """Remove this student's name and date of birth from every older event.

    The date of birth is removed from every snapshot of the student, found by
    their WKSA ID, so it is never matched by value (another student may share
    the date). The name is removed wherever the full name appears. The student
    need not still exist: the name is given, not looked up. Run it once for
    each name the student has had. Returns how many events changed (or would,
    for a dry run); a second run changes none.
    """
    full_name = f"{first_name} {last_name}".strip()
    changed = 0
    with transaction.atomic():
        for event in AuditEvent.objects.all().iterator(chunk_size=500):
            summary = _redact_text(event.summary, wksa_id=wksa_id, full_name=full_name)
            metadata = _redact_value(
                event.metadata, wksa_id=wksa_id, full_name=full_name
            )
            if summary == event.summary and metadata == event.metadata:
                continue
            changed += 1
            if not dry_run:
                # The base QuerySet.update, not AuditEvent's guarded one: this
                # is the single sanctioned rewrite.
                models.QuerySet.update(
                    AuditEvent.objects.filter(pk=event.pk),
                    summary=summary,
                    metadata=metadata,
                )
        if changed and not dry_run:
            AuditEvent.objects.create(
                action=AuditAction.AUDIT_REDACTED,
                entity_type=AuditEntity.AUDIT_LOG,
                entity_id=wksa_id,
                summary=(
                    f"Personal details of student {wksa_id} erased from "
                    f"{changed} audit event(s)."
                ),
                metadata={"wksa_id": wksa_id, "events_changed": changed},
            )
    return changed
