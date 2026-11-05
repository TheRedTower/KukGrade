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

import re
from typing import Any

from django.db import models, transaction

from audit.models import AuditAction, AuditEntity, AuditEvent

NAME_ERASED = "[name erased]"
PERSONAL_KEYS = ("first_name", "last_name", "date_of_birth")


def _redact_text(text: str, *, full_name: str) -> str:
    # The old form was "<name> (<WKSA ID>)": keep the ID, which is the reference.
    text = re.sub(
        rf"Student {re.escape(full_name)} \(([^)]+)\)",
        r"Student \1",
        text,
    )
    text = re.sub(rf"{re.escape(full_name)} \(([^)]+)\)", r"student \1", text)
    return text.replace(full_name, NAME_ERASED)


def _redact_value(value: Any, *, wksa_ids: set[str], tied: bool, full_name: str) -> Any:
    if isinstance(value, str):
        return _redact_text(value, full_name=full_name)
    if isinstance(value, list):
        return [
            _redact_value(v, wksa_ids=wksa_ids, tied=tied, full_name=full_name)
            for v in value
        ]
    if isinstance(value, dict):
        # A snapshot of this student: the personal fields go, whatever they were
        # (a name edited later is in an earlier snapshot of the same student).
        own = tied or value.get("wksa_id") in wksa_ids
        return {
            key: _redact_value(item, wksa_ids=wksa_ids, tied=tied, full_name=full_name)
            for key, item in value.items()
            if not (own and key in PERSONAL_KEYS)
        }
    return value


def _snapshot_ids(value: Any) -> set[str]:
    """Every WKSA ID in a snapshot of a student inside this event's details."""
    found: set[str] = set()
    if isinstance(value, dict):
        if isinstance(value.get("wksa_id"), str):
            found.add(value["wksa_id"])
        for item in value.values():
            found |= _snapshot_ids(item)
    elif isinstance(value, list):
        for item in value:
            found |= _snapshot_ids(item)
    return found


def _students_of(wksa_ids: set[str]) -> set[str]:
    """The ids of the student records that ever held one of these WKSA IDs.

    Found through the student's own events, which name the student by id, so a
    student whose ID changed (a black belt ID, a corrected typo) is followed
    through every ID without touching whoever else once held the old number.
    """
    return {
        event.entity_id
        for event in AuditEvent.objects.filter(
            entity_type=AuditEntity.STUDENT
        ).iterator(
            chunk_size=500,
        )
        if _snapshot_ids(event.metadata) & wksa_ids
        or any(f"({wksa_id})" in event.summary for wksa_id in wksa_ids)
    }


def redact_student_details(
    *,
    wksa_id: str,
    first_name: str,
    last_name: str,
    dry_run: bool = False,
) -> int:
    """Remove this student's name and date of birth from every older event.

    The personal fields are removed from every snapshot of the student: those
    under the given WKSA ID, and those in the events of any student record that
    ever held it (so a changed ID is followed). A date is never matched by
    value, since another student may share it. The name is removed wherever the
    full name appears. The student need not still exist: the name is given, not
    looked up. Run it once for each name the student has had. Returns how many
    events changed (or would, for a dry run); a second run changes none.
    """
    full_name = f"{first_name} {last_name}".strip()
    if not wksa_id.strip() or not full_name:
        # An empty name matches everywhere and would rewrite the whole log.
        raise ValueError("A WKSA ID and a name are both needed.")
    ids = {wksa_id}
    changed = 0
    with transaction.atomic():
        students = _students_of(ids)
        for event in AuditEvent.objects.all().iterator(chunk_size=500):
            tied = (
                event.entity_type == AuditEntity.STUDENT and event.entity_id in students
            )
            summary = _redact_text(event.summary, full_name=full_name)
            metadata = _redact_value(
                event.metadata, wksa_ids=ids, tied=tied, full_name=full_name
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
