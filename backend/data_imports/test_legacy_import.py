"""Historical workbook upload and commit: how ranks are read, the adapter's
warnings, and the LegacyGradingRecord commit path, on top of the adapter's
own tests."""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl.workbook import Workbook
from rest_framework.test import APIClient

from audit.models import AuditAction, AuditEvent
from data_imports.models import ImportBatch
from data_imports.services import (
    cancel_import_batch,
    commit_legacy_grading_import,
    legacy_warnings,
)
from data_imports.testing import (
    MAIN_TABLE_HEADER,
    legacy_batch,
    standard_workbook,
    workbook_bytes,
)
from data_imports.tests import admin_user, instructor_user, rank
from gradings.models import LegacyGradingRecord, LegacyOutcome, LegacyRecordKind

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("students_exist")]


# --- preview -----------------------------------------------------------


def test_the_adapters_structural_warnings_are_served() -> None:
    # A sheet the adapter cannot place is skipped, not silently lost: the
    # administrator must see it before committing.
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(MAIN_TABLE_HEADER)
        ws.append(["A. Example", "White", "Yellow Stripe", "Pass", ""])
        workbook.create_sheet("Scratch notes").append(["Not a grading cycle"])

    batch = legacy_batch(workbook_bytes(build))

    assert batch.rows.count() == 1
    assert legacy_warnings(batch) == ["Unknown sheet 'Scratch notes' was not imported."]


def test_an_over_long_cell_is_refused_at_upload_naming_where_it_is() -> None:
    # Source text is kept verbatim, so it cannot be cut to fit; the commit
    # used to fail the whole batch naming no row, after a clean preview.
    from django.core.exceptions import ValidationError

    long_name = "N" * 201
    with pytest.raises(ValidationError) as refusal:
        legacy_batch(
            standard_workbook([[long_name, "White", "Yellow Stripe", "Pass", ""]])
        )

    message = refusal.value.message_dict["file"][0]
    assert message.startswith("06-2025!R2: source name is 201 characters")
    assert "at most 200" in message
    assert not ImportBatch.objects.exists()


def test_each_row_is_kept_as_its_kind_of_record() -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(MAIN_TABLE_HEADER)
        ws.append(["A. Example", "White", "Yellow Stripe", "Pass", ""])
        ws.append(["B. Second", "White", "Yellow Stripe", "DNA", ""])
        ws.append(["Missing"])
        ws.append(["C. Third", "note"])

    batch = legacy_batch(workbook_bytes(build))

    kinds = sorted(batch.rows.values_list("raw__record_kind", flat=True))
    assert kinds == sorted(
        [
            LegacyRecordKind.GRADING_RESULT,
            LegacyRecordKind.DID_NOT_ATTEND,
            LegacyRecordKind.AUXILIARY_NOTE,
        ],
    )


@pytest.mark.parametrize(
    ("text", "code"),
    [
        # The seeded catalogue's own name, read exactly.
        ("Yellow", "YELLOW"),
        # How the club's workbook writes them (2026-10-20): fixed spellings,
        # read as written - except one the workbook marks with "?", which
        # waits for the importer (data_imports.legacy_checks).
        ("Yellow Belt", "YELLOW"),
        ("red belt", "RED"),
        ("DBN", "DAHN_BO"),
        ("DBn", "DAHN_BO"),
        ("Red stripe?", None),
        ("Brown Stripe ?", None),
        # A slip for DBN, but a near miss is never guessed.
        ("DNB", None),
    ],
)
def test_a_spelling_kukgrade_reads_is_saved_as_read_and_any_other_waits(
    text: str,
    code: str | None,
) -> None:
    admin = admin_user()
    batch = legacy_batch(
        standard_workbook([["A. Example", text, "", "Pass", ""]]),
        uploaded_by=admin,
    )

    commit_legacy_grading_import(batch, actor=admin)

    record = LegacyGradingRecord.objects.get(source_batch=batch)
    assert (record.current_rank.code if record.current_rank else None) == code
    assert record.source_current_rank_text == text


def test_a_free_form_outcome_is_a_reason_to_look_at_the_record() -> None:
    content = standard_workbook(
        [["A. Example", "White", "Yellow Stripe", "Testing? JKN Example: No", ""]],
    )
    batch = legacy_batch(content)

    assert "Outcome 'Testing? JKN Example: No' is not one KukGrade knows." in (
        batch.rows.get().issues
    )


# --- commit --------------------------------------------------------------


def test_commit_creates_one_legacy_record_per_row() -> None:
    admin = admin_user()
    content = standard_workbook(
        [["A. Example", "Yellow Belt", "Blue Stripe", "Pass", "Nice form"]],
    )
    batch = legacy_batch(content, uploaded_by=admin)
    events_before = AuditEvent.objects.count()

    committed = commit_legacy_grading_import(batch, actor=admin)

    assert committed.status == ImportBatch.Status.COMMITTED
    record = LegacyGradingRecord.objects.get(source_batch=committed)
    assert record.source_name == "A. Example"
    assert record.outcome == LegacyOutcome.PASS
    assert record.comments == "Nice form"
    # No choice made: read as KukGrade reads the spelling.
    assert record.current_rank == rank("YELLOW")
    import_event = AuditEvent.objects.get(
        action=AuditAction.IMPORT_BATCH_COMMITTED,
        entity_type="ImportBatch",
        entity_id=str(batch.pk),
    )
    assert import_event.metadata["record_count"] == 1
    assert "A. Example" not in import_event.summary
    assert AuditEvent.objects.count() == events_before + 1


def test_commit_never_creates_a_native_promotion_or_outcome() -> None:
    from gradings.models import CandidateOutcome, Promotion

    admin = admin_user()
    content = standard_workbook([["A. Example", "White", "Yellow Stripe", "Pass", ""]])
    batch = legacy_batch(content, uploaded_by=admin)
    promotions_before = Promotion.objects.count()
    outcomes_before = CandidateOutcome.objects.count()

    commit_legacy_grading_import(batch, actor=admin)

    assert Promotion.objects.count() == promotions_before
    assert CandidateOutcome.objects.count() == outcomes_before


def test_commit_did_not_attend_row_has_no_outcome() -> None:
    admin = admin_user()
    content = standard_workbook([["A. Example", "White", "Yellow Stripe", "DNA", ""]])
    batch = legacy_batch(content, uploaded_by=admin)

    commit_legacy_grading_import(batch, actor=admin)

    record = LegacyGradingRecord.objects.get(source_batch=batch)
    assert record.record_kind == LegacyRecordKind.DID_NOT_ATTEND
    assert record.outcome is None


def test_commit_is_not_idempotent_a_second_attempt_is_refused() -> None:
    admin = admin_user()
    batch = legacy_batch(uploaded_by=admin)
    commit_legacy_grading_import(batch, actor=admin)

    with pytest.raises(Exception, match="cannot be imported again"):
        commit_legacy_grading_import(batch, actor=admin)


def test_commit_deletes_the_temporary_source_file() -> None:
    admin = admin_user()
    batch = legacy_batch(uploaded_by=admin)
    assert batch.source_file

    committed = commit_legacy_grading_import(batch, actor=admin)

    assert not committed.source_file


def test_cancel_a_legacy_batch_deletes_temp_file() -> None:
    admin = admin_user()
    batch = legacy_batch(uploaded_by=admin)

    cancelled = cancel_import_batch(batch, actor=admin)

    assert cancelled.status == ImportBatch.Status.CANCELLED
    assert not cancelled.source_file


# --- API/permissions -----------------------------------------------------


def test_instructor_cannot_decide_a_check_or_commit_a_legacy_batch() -> None:
    client = APIClient()
    client.force_authenticate(user=instructor_user())
    batch = legacy_batch()

    decided = client.post(
        f"/api/data-imports/batches/{batch.pk}/checks/resolve/",
        {"key": "RANK:yellow belt", "decision": "KEEP"},
        format="json",
    )
    assert decided.status_code == 403

    commit_response = client.post(f"/api/data-imports/batches/{batch.pk}/commit/")
    assert commit_response.status_code == 403


def test_admin_completes_the_full_legacy_flow_via_the_api() -> None:
    client = APIClient()
    admin = admin_user()
    client.force_authenticate(user=admin)
    content = standard_workbook(
        [["A. Example", "Yellow Belt", "Bown Stripe", "Pass", ""]],
    )

    create_response = client.post(
        "/api/data-imports/batches/",
        {
            "kind": ImportBatch.Kind.LEGACY_GRADINGS,
            "file": SimpleUploadedFile("workbook.xlsx", content),
        },
        format="multipart",
    )
    assert create_response.status_code == 201
    batch_id = create_response.json()["id"]

    summary = client.get(f"/api/data-imports/batches/{batch_id}/checks/summary/")
    assert (summary.status_code, summary.json()["open"]) == (200, 1)
    chosen = client.post(
        f"/api/data-imports/batches/{batch_id}/checks/resolve/",
        {"key": "RANK:bown stripe", "decision": "RANK", "rank_code": "BROWN_STRIPE"},
        format="json",
    )
    assert chosen.status_code == 200
    commit_response = client.post(f"/api/data-imports/batches/{batch_id}/commit/")
    assert commit_response.status_code == 200
    assert commit_response.json()["id"] == batch_id
    assert ImportBatch.objects.get(pk=batch_id).status == ImportBatch.Status.COMMITTED

    record = LegacyGradingRecord.objects.get(source_batch_id=batch_id)
    assert record.current_rank == rank("YELLOW")
    assert record.testing_for_rank == rank("BROWN_STRIPE")
