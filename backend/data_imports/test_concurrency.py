"""Expiry against commit and cancel, on real threads and connections.

Each race holds the first transition just before it commits and runs the
second against it (`kukgrade.testing.interleave`).
Exactly one terminal transition may win, with exactly its own audit event.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.models import ImportBatch
from data_imports.services import (
    cancel_import_batch,
    commit_student_import,
    expire_import_batch,
)
from data_imports.storage import import_upload_storage
from data_imports.tests import (
    CLEAN_ROW,
    STANDARD_MAPPING,
    admin_user,
    student_workbook,
    upload_batch,
)
from kukgrade.testing import interleave
from students.models import Student

pytestmark = [
    pytest.mark.django_db(transaction=True, serialized_rollback=True),
    pytest.mark.concurrency,
]

PAUSE_AT = "data_imports.services.record"
MAX_AGE = timedelta(hours=24)


def stale_batch() -> tuple[ImportBatch, User]:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    ImportBatch.objects.filter(pk=batch.pk).update(
        uploaded_at=timezone.now() - timedelta(hours=25),
    )
    return batch, admin


def fresh(batch: ImportBatch) -> ImportBatch:
    return ImportBatch.objects.get(pk=batch.pk)


def transition(name: str, batch: ImportBatch, admin: User) -> Callable[[], object]:
    if name == "commit":
        return lambda: commit_student_import(
            fresh(batch),
            actor=admin,
            column_mapping=STANDARD_MAPPING,
        )
    return lambda: cancel_import_batch(fresh(batch), actor=admin)


FINAL_STATUS = {
    "commit": (ImportBatch.Status.COMMITTED, AuditAction.IMPORT_BATCH_COMMITTED),
    "cancel": (ImportBatch.Status.CANCELLED, AuditAction.IMPORT_BATCH_CANCELLED),
}


def batch_events(batch: ImportBatch) -> list[str]:
    return list(
        AuditEvent.objects.filter(
            entity_type="ImportBatch",
            entity_id=str(batch.pk),
        ).values_list("action", flat=True),
    )


@pytest.mark.parametrize("other", ["commit", "cancel"])
def test_expiry_waits_for_a_transition_in_flight_and_then_leaves_it(
    other: str,
) -> None:
    batch, admin = stale_batch()
    name = batch.source_file.name

    first, second = interleave(
        transition(other, batch, admin),
        lambda: expire_import_batch(batch.pk, max_age=MAX_AGE),
        pause_first_at=PAUSE_AT,
    )

    status, action = FINAL_STATUS[other]
    assert isinstance(first, ImportBatch), first
    assert second is False
    assert fresh(batch).status == status
    assert batch_events(batch) == [action]
    assert not import_upload_storage().exists(name)


@pytest.mark.parametrize("other", ["commit", "cancel"])
def test_a_transition_after_expiry_in_flight_is_refused(other: str) -> None:
    batch, admin = stale_batch()
    name = batch.source_file.name

    first, second = interleave(
        lambda: expire_import_batch(batch.pk, max_age=MAX_AGE),
        transition(other, batch, admin),
        pause_first_at=PAUSE_AT,
    )

    assert first is True
    assert isinstance(second, ValidationError), second
    assert "already expired" in str(second)
    assert fresh(batch).status == ImportBatch.Status.EXPIRED
    assert batch_events(batch) == [AuditAction.IMPORT_BATCH_EXPIRED]
    assert not Student.objects.filter(wksa_id=CLEAN_ROW[0]).exists()
    assert not import_upload_storage().exists(name)
