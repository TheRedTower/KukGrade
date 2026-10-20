"""LegacyGradingRecord: immutability, void, and link/unlink/resolve services.

Helpers imported from gradings.testing rather than re-built here.
"""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.testing import legacy_batch, legacy_record
from gradings.legacy_services import (
    create_legacy_grading_record,
    link_legacy_record_to_student,
    resolve_legacy_current_rank,
    resolve_legacy_testing_for_rank,
    unlink_legacy_record_from_student,
    void_legacy_record,
)
from gradings.models import (
    LegacyAttendance,
    LegacyGradingRecord,
    LegacyOutcome,
    LegacyRecordKind,
)
from gradings.testing import rank, student, user
from students.models import Student

pytestmark = pytest.mark.django_db


def test_create_legacy_grading_record_persists_source_facts() -> None:
    batch = legacy_batch()
    record = create_legacy_grading_record(
        source_batch=batch,
        record_kind=LegacyRecordKind.GRADING_RESULT,
        source_sheet="06/2025",
        source_locator="06/2025!A14:E14",
        cycle_year=2025,
        cycle_month=6,
        source_name="A. Example",
        source_current_rank_text="Yellow Belt",
        source_testing_for_rank_text="Blue Stripe",
        source_outcome_text="Pass",
        outcome=LegacyOutcome.PASS,
    )
    assert record.pk is not None
    assert record.student is None
    assert record.current_rank is None
    assert record.is_void is False
    assert record.outcome == LegacyOutcome.PASS
    assert str(record) == "06/2025!06/2025!A14:E14: A. Example"


def test_duplicate_source_locator_within_a_batch_is_rejected() -> None:
    batch = legacy_batch()
    legacy_record(source_batch=batch, source_locator="06/2025!A14:E14")

    with pytest.raises(ValidationError, match="already exists"):
        legacy_record(source_batch=batch, source_locator="06/2025!A14:E14")


def test_source_fields_are_immutable_after_creation() -> None:
    record = legacy_record()

    record.source_name = "Someone Else"
    with pytest.raises(ValidationError, match="cannot be changed after import"):
        record.save()


def test_outcome_is_immutable_no_resolution_service_exists() -> None:
    record = legacy_record(outcome=LegacyOutcome.PASS)

    record.outcome = LegacyOutcome.FAIL
    with pytest.raises(ValidationError, match="cannot be changed after import"):
        record.save()


def test_instance_delete_is_refused() -> None:
    record = legacy_record()

    with pytest.raises(ValidationError, match="cannot be deleted"):
        record.delete()

    assert LegacyGradingRecord.objects.filter(pk=record.pk).exists()


def test_queryset_delete_is_refused() -> None:
    record = legacy_record()

    with pytest.raises(ValidationError, match="cannot be deleted"):
        LegacyGradingRecord.objects.filter(pk=record.pk).delete()

    assert LegacyGradingRecord.objects.filter(pk=record.pk).exists()


def test_queryset_update_is_refused() -> None:
    record = legacy_record()

    with pytest.raises(ValidationError, match="not updated directly"):
        LegacyGradingRecord.objects.filter(pk=record.pk).update(admin_note="sneaky")


def test_did_not_attend_has_no_outcome() -> None:
    record = legacy_record(
        record_kind=LegacyRecordKind.DID_NOT_ATTEND,
        attendance_status=LegacyAttendance.DID_NOT_ATTEND,
        outcome=None,
    )
    assert record.outcome is None
    assert record.attendance_status == LegacyAttendance.DID_NOT_ATTEND


def test_link_and_unlink_record_to_student() -> None:
    record = legacy_record()
    target = student(wksa_id="206-2-500")
    actor = user("legacy-link-admin@example.com")
    events_before = AuditEvent.objects.count()

    linked = link_legacy_record_to_student(record, target, actor=actor)
    assert linked.student_id == target.pk
    link_event = AuditEvent.objects.get(
        action=AuditAction.LEGACY_GRADING_LINKED,
        entity_type="LegacyGradingRecord",
        entity_id=str(record.pk),
    )
    assert link_event.metadata == {
        "legacy_record_id": record.pk,
        "student_id": target.pk,
        "batch_id": record.source_batch_id,
    }

    unlinked = unlink_legacy_record_from_student(linked, actor=actor)
    assert unlinked.student_id is None
    assert AuditEvent.objects.filter(
        action=AuditAction.LEGACY_GRADING_UNLINKED,
    ).exists()
    assert AuditEvent.objects.count() == events_before + 2


def test_unlink_an_unlinked_record_is_refused() -> None:
    record = legacy_record()
    actor = user("legacy-unlink-admin@example.com")

    with pytest.raises(ValidationError, match="not linked"):
        unlink_legacy_record_from_student(record, actor=actor)


def test_relinking_to_a_different_student_overwrites_the_link() -> None:
    record = legacy_record()
    actor = user("legacy-relink-admin@example.com")
    first = student(wksa_id="206-2-501")
    second = student(wksa_id="206-2-502")

    link_legacy_record_to_student(record, first, actor=actor)
    relinked = link_legacy_record_to_student(record, second, actor=actor)

    assert relinked.student_id == second.pk


def test_resolve_and_clear_current_rank_mapping() -> None:
    record = legacy_record(source_current_rank_text="Yellow Belt")
    actor = user("legacy-rank-admin@example.com")
    yellow = rank("YELLOW")

    resolved = resolve_legacy_current_rank(record, yellow, actor=actor)
    assert resolved.current_rank_id == yellow.pk
    # Source text is untouched by the resolution.
    assert resolved.source_current_rank_text == "Yellow Belt"

    cleared = resolve_legacy_current_rank(resolved, None, actor=actor)
    assert cleared.current_rank_id is None

    event = AuditEvent.objects.filter(
        action=AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        entity_id=str(record.pk),
    ).first()
    assert event is not None
    assert event.metadata["field"] == "current_rank"


def test_a_correction_that_changes_nothing_records_nothing() -> None:
    record = legacy_record(source_current_rank_text="Yellow Belt")
    actor = user("legacy-noop-admin@example.com")
    linked = student(wksa_id="206-2-503")
    link_legacy_record_to_student(record, linked, actor=actor)
    resolve_legacy_current_rank(record, rank("YELLOW"), actor=actor)
    events_before = AuditEvent.objects.filter(entity_id=str(record.pk)).count()

    link_legacy_record_to_student(record, linked, actor=actor)
    resolve_legacy_current_rank(record, rank("YELLOW"), actor=actor)
    resolve_legacy_testing_for_rank(record, None, actor=actor)

    assert AuditEvent.objects.filter(entity_id=str(record.pk)).count() == events_before


def test_resolve_testing_for_rank_mapping() -> None:
    record = legacy_record(source_testing_for_rank_text="Blue Stripe")
    actor = user("legacy-testing-rank-admin@example.com")
    blue_stripe = rank("BLUE_STRIPE") if _rank_exists("BLUE_STRIPE") else rank("YELLOW")

    resolved = resolve_legacy_testing_for_rank(record, blue_stripe, actor=actor)
    assert resolved.testing_for_rank_id == blue_stripe.pk
    event = AuditEvent.objects.get(
        action=AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        entity_id=str(record.pk),
    )
    assert event.metadata["field"] == "testing_for_rank"


def _rank_exists(code: str) -> bool:
    from ranks.models import Rank

    return Rank.objects.filter(code=code).exists()


def test_void_requires_a_reason() -> None:
    record = legacy_record()
    actor = user("legacy-void-admin@example.com")

    with pytest.raises(ValidationError, match="reason is required"):
        void_legacy_record(record, reason="   ", actor=actor)


def test_void_records_actor_reason_and_timestamp() -> None:
    record = legacy_record()
    actor = user("legacy-void-admin-2@example.com")

    voided = void_legacy_record(
        record,
        reason="Duplicate row in source workbook",
        actor=actor,
    )

    assert voided.is_void is True
    assert voided.void_reason == "Duplicate row in source workbook"
    assert voided.voided_by_id == actor.pk
    assert voided.voided_at is not None
    event = AuditEvent.objects.get(
        action=AuditAction.LEGACY_GRADING_VOIDED,
        entity_id=str(record.pk),
    )
    assert event.metadata["reason"] == "Duplicate row in source workbook"


def test_voiding_twice_is_refused() -> None:
    record = legacy_record()
    actor = user("legacy-void-admin-3@example.com")
    void_legacy_record(record, reason="Duplicate row", actor=actor)

    with pytest.raises(ValidationError, match="already been voided"):
        void_legacy_record(record, reason="Second attempt", actor=actor)


def test_deleting_a_user_reassigns_legacy_void_attribution() -> None:
    from accounts.services import delete_platform_user

    record = legacy_record()
    voider = user("legacy-void-to-delete@example.com")
    void_legacy_record(record, reason="Duplicate row", actor=voider)

    remover = user("legacy-void-remover@example.com", role=User.Role.ADMINISTRATOR)
    placeholder = delete_platform_user(voider, remover)

    record.refresh_from_db()
    assert record.voided_by_id == placeholder.pk


def test_deleting_a_linked_student_is_protected() -> None:
    from django.db.models.deletion import ProtectedError

    record = legacy_record()
    target = student(wksa_id="206-2-504")
    actor = user("legacy-protect-admin@example.com")
    link_legacy_record_to_student(record, target, actor=actor)

    with pytest.raises(ProtectedError):
        Student.objects.filter(pk=target.pk).delete()
