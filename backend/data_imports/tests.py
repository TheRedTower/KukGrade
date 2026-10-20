from __future__ import annotations

import csv
import os
from collections.abc import Sequence
from datetime import date, timedelta
from io import StringIO
from typing import Any
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import CommandError, call_command
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from openpyxl.workbook import Workbook
from rest_framework.test import APIClient

from accounts.models import User
from accounts.services import delete_platform_user
from audit.models import AuditAction, AuditEvent
from data_imports.mappings import suggest_column_mapping
from data_imports.models import ImportBatch
from data_imports.parsers import UnsupportedImportFileError, load_tabular_dataset
from data_imports.services import (
    cancel_import_batch,
    commit_student_import,
    create_import_batch,
    expire_import_batch,
    preview_student_import,
    remove_orphaned_uploads,
)
from data_imports.storage import import_upload_storage
from data_imports.testing import workbook_bytes
from ranks.matching import active_rank_lookup
from ranks.models import Rank
from students.models import Student
from students.services import create_student, create_students

pytestmark = pytest.mark.django_db


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def admin_user(email: str = "import-admin@example.com") -> User:
    return User.objects.create_user(email=email, role=User.Role.ADMINISTRATOR)


def instructor_user(email: str = "import-instructor@example.com") -> User:
    return User.objects.create_user(email=email, role=User.Role.INSTRUCTOR)


# The header row of the frontend's "Download standard template" file
# (ImportStudentsScreen), which suggest_column_mapping must recognise.
STANDARD_STUDENT_HEADERS = {
    "wksa_id": "WKSA ID",
    "first_name": "First Name",
    "last_name": "Last Name",
    "date_of_birth": "Date of Birth",
    "current_rank": "Current Rank",
    "status": "Status",
}
STANDARD_MAPPING = {field: header for field, header in STANDARD_STUDENT_HEADERS.items()}


def student_workbook(
    rows: Sequence[Sequence[object]],
    *,
    headers: list[str] | None = None,
    file_format: str = "xlsx",
) -> bytes:
    table = [headers or list(STANDARD_STUDENT_HEADERS.values()), *rows]
    if file_format == "csv":
        text = StringIO()
        csv.writer(text).writerows(table)
        return text.getvalue().encode("utf-8")

    def build(workbook: Workbook) -> None:
        sheet = workbook.create_sheet("Roster")
        for row in table:
            sheet.append(list(row))

    return workbook_bytes(build)


def upload_batch(
    *,
    kind: str = ImportBatch.Kind.STUDENT_ROSTER,
    content: bytes,
    filename: str = "roster.xlsx",
    uploaded_by: User | None = None,
) -> ImportBatch:
    upload = SimpleUploadedFile(filename, content)
    result = create_import_batch(
        kind=kind,
        upload=upload,
        uploaded_by=uploaded_by or admin_user(),
    )
    return result.batch


CLEAN_ROW = ["206-2-500", "Alex", "Kim", "2012-05-01", "White", "ACTIVE"]


def stored(name: str) -> bool:
    return import_upload_storage().exists(name)


def age_file(name: str, hours: int) -> None:
    then = (timezone.now() - timedelta(hours=hours)).timestamp()
    os.utime(import_upload_storage().path(name), (then, then))


# --- parsers -----------------------------------------------------------------


def test_load_tabular_dataset_rejects_unsupported_extension() -> None:
    with pytest.raises(UnsupportedImportFileError):
        load_tabular_dataset(content=b"whatever", filename="roster.txt")


def test_load_tabular_dataset_rejects_malformed_xlsx() -> None:
    with pytest.raises(UnsupportedImportFileError):
        load_tabular_dataset(content=b"not a real workbook", filename="roster.xlsx")


def test_load_tabular_dataset_reads_valid_csv() -> None:
    content = student_workbook([CLEAN_ROW], file_format="csv")
    dataset = load_tabular_dataset(content=content, filename="roster.csv")
    assert dataset.headers == list(STANDARD_STUDENT_HEADERS.values())
    assert [number for number, _ in dataset.rows] == [2]


# --- mappings ------------------------------------------------------------


def test_suggest_column_mapping_matches_standard_and_alias_headers() -> None:
    suggestion = suggest_column_mapping(
        ["Member No", "Forename", "Surname", "DOB", "Belt", "Status"],
    )
    assert suggestion == {
        "wksa_id": "Member No",
        "first_name": "Forename",
        "last_name": "Surname",
        "date_of_birth": "DOB",
        "current_rank": "Belt",
        "status": "Status",
    }


# --- create_import_batch -----------------------------------------------------


def test_create_import_batch_accepts_valid_xlsx_and_computes_hash() -> None:
    content = student_workbook([CLEAN_ROW])
    admin = admin_user()
    result = create_import_batch(
        kind=ImportBatch.Kind.STUDENT_ROSTER,
        upload=SimpleUploadedFile("roster.xlsx", content),
        uploaded_by=admin,
    )
    assert result.batch.status == ImportBatch.Status.UPLOADED
    assert len(result.batch.sha256) == 64
    assert result.batch.uploaded_by == admin
    assert result.already_imported_warning is False
    assert result.detected_headers == list(STANDARD_STUDENT_HEADERS.values())
    assert result.suggested_mapping == STANDARD_MAPPING


def test_create_import_batch_rejects_csv_for_legacy_gradings_kind() -> None:
    content = student_workbook([CLEAN_ROW], file_format="csv")
    with pytest.raises(Exception, match="KukGrade cannot read"):
        create_import_batch(
            kind=ImportBatch.Kind.LEGACY_GRADINGS,
            upload=SimpleUploadedFile("roster.csv", content),
            uploaded_by=admin_user(),
        )


def test_create_import_batch_rejects_oversized_file() -> None:
    huge = b"a" * (6 * 1024 * 1024)
    with pytest.raises(Exception, match="MB limit"):
        create_import_batch(
            kind=ImportBatch.Kind.STUDENT_ROSTER,
            upload=SimpleUploadedFile("roster.csv", huge),
            uploaded_by=admin_user(),
        )


def test_create_import_batch_flags_identical_already_committed_hash() -> None:
    content = student_workbook([CLEAN_ROW])
    admin = admin_user()
    first = upload_batch(content=content, uploaded_by=admin)
    commit_student_import(first, actor=admin, column_mapping=STANDARD_MAPPING)

    result = create_import_batch(
        kind=ImportBatch.Kind.STUDENT_ROSTER,
        upload=SimpleUploadedFile("roster.xlsx", content),
        uploaded_by=admin,
    )
    assert result.already_imported_warning is True


# --- preview_student_import ---------------------------------------------


def test_preview_classifies_clean_row_as_ready() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.total == 1
    assert preview.ready == 1
    assert preview.rows[0].outcome == "READY"
    assert preview.rows[0].current_rank_code == "WHITE"


def test_preview_queries_do_not_grow_with_the_number_of_rows() -> None:
    def roster(size: int) -> list[list[object]]:
        # A mix: ready, already on the roster, and an unknown rank.
        rows: list[list[object]] = []
        for index in range(size):
            rank_text = ("White", "yellow stripe", "Purple")[index % 3]
            rows.append(
                [f"206-2-{index:03d}", "Alex", "Kim", "2012-05-01", rank_text, ""]
            )
        return rows

    creator = admin_user("preview-queries-creator@example.com")
    for index in range(0, 40, 4):
        create_student(
            wksa_id=f"206-2-{index:03d}",
            first_name="Existing",
            last_name="Student",
            date_of_birth=date(2012, 5, 1),
            current_rank=rank("WHITE"),
            actor=creator,
        )
    small = upload_batch(content=student_workbook(roster(2)), uploaded_by=creator)
    large = upload_batch(content=student_workbook(roster(40)), uploaded_by=creator)

    with CaptureQueriesContext(connection) as few:
        preview_student_import(small, column_mapping=STANDARD_MAPPING)
    with CaptureQueriesContext(connection) as many:
        preview = preview_student_import(large, column_mapping=STANDARD_MAPPING)

    assert {row.outcome for row in preview.rows} == {
        "READY",
        "SKIP_EXISTING",
        "REVIEW_REQUIRED",
    }
    assert len(many.captured_queries) == len(few.captured_queries)


def test_the_rank_lookup_matches_code_or_name_of_active_ranks_ignoring_case() -> None:
    lookup = active_rank_lookup()
    inactive = rank("YELLOW_STRIPE")
    Rank.objects.filter(pk=inactive.pk).update(active=False)
    lookup_without_it = active_rank_lookup()

    for text in ("white", "WHITE", "White"):
        assert lookup[text.upper()] == rank("WHITE"), text
    assert lookup["BLUE STRIPE"] == rank("BLUE_STRIPE")
    for text in ("Purple", "x"):
        assert text.upper() not in lookup
    for text in ("yellow stripe", "YELLOW_STRIPE"):
        assert lookup_without_it.get(text.upper()) is None


def test_preview_flags_missing_required_field_as_review_required() -> None:
    row = ["206-2-524", "", "Kim", "2012-05-01", "White", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "First name is required." in preview.rows[0].issues


def test_preview_flags_future_dob_as_review_required() -> None:
    future = (timezone.localdate() + timedelta(days=1)).isoformat()
    row = ["206-2-525", "Alex", "Kim", future, "White", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "cannot be in the future" in preview.rows[0].issues[0]


def test_preview_flags_unresolved_rank_as_review_required() -> None:
    row = ["206-2-526", "Alex", "Kim", "2012-05-01", "Not A Rank", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "is not a rank KukGrade recognises" in preview.rows[0].issues[0]


def test_preview_flags_existing_wksa_id_as_skip_existing_and_never_updates() -> None:
    Student.objects.create(
        wksa_id="206-2-500",
        first_name="Existing",
        last_name="Student",
        date_of_birth=timezone.localdate().replace(year=2010),
        current_rank=rank("YELLOW"),
    )
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.skip_existing == 1
    row = preview.rows[0]
    assert row.outcome == "SKIP_EXISTING"


def test_preview_flags_duplicate_wksa_id_within_file() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW, CLEAN_ROW]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert preview.ready == 1
    duplicate_row = next(r for r in preview.rows if r.outcome == "REVIEW_REQUIRED")
    assert "Duplicate WKSA ID within this file." in duplicate_row.issues


def test_preview_applies_row_correction() -> None:
    row = ["206-2-527", "", "Kim", "2012-05-01", "White", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(
        batch,
        column_mapping=STANDARD_MAPPING,
        corrections={"2": {"first_name": "Alex"}},
    )
    assert preview.ready == 1
    assert preview.rows[0].first_name == "Alex"


def test_preview_is_recomputed_fresh_and_deterministic_across_calls() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))
    first = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    second = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert first == second


TOMORROW = (timezone.localdate() + timedelta(days=1)).isoformat()
FIELD_INDEX = {name: index for index, name in enumerate(STANDARD_STUDENT_HEADERS)}

# (changes to CLEAN_ROW, the issue preview must report or None for READY).
# Every case is committed as well as previewed: READY must mean committable.
PARITY_CASES = {
    "a black belt ID": ({"wksa_id": "A-20819"}, None),
    "a black belt ID typed in lower case, with spaces": (
        {"wksa_id": " a-20819 "},
        None,
    ),
    "a transfer's student ID from another school": ({"wksa_id": "206-1-044"}, None),
    "a black belt rank with a student ID": (
        {"current_rank": "JKN"},
        "WKSA ID: A black belt rank needs a black belt ID, such as A-20819.",
    ),
    "a black belt rank with a black belt ID": (
        {"current_rank": "JKN", "wksa_id": "A-20819"},
        None,
    ),
    "an ID in neither form": (
        {"wksa_id": "UK-5001"},
        "WKSA ID: Use a student ID such as 206-2-150 or a black belt ID such as "
        "A-20819.",
    ),
    "first name at its limit": ({"first_name": "F" * 150}, None),
    "first name over its limit": (
        {"first_name": "F" * 151},
        "First name: Ensure this value has at most 150 characters (it has 151).",
    ),
    "last name over its limit": (
        {"last_name": "L" * 151},
        "Last name: Ensure this value has at most 150 characters (it has 151).",
    ),
    "blank WKSA ID": ({"wksa_id": ""}, "WKSA ID is required."),
    "whitespace-only first name": ({"first_name": "   "}, "First name is required."),
    "future date of birth": (
        {"date_of_birth": TOMORROW},
        "Date of birth cannot be in the future.",
    ),
    "unparseable date of birth": (
        {"date_of_birth": "31/31/2012"},
        "Date of birth '31/31/2012' could not be parsed.",
    ),
    "status in lower case": ({"status": "left"}, None),
    "unrecognised status": ({"status": "GONE"}, "Status 'GONE' is not recognised."),
    "unknown rank": (
        {"current_rank": "Purple"},
        "Rank 'Purple' is not a rank KukGrade recognises.",
    ),
}


@pytest.mark.parametrize(
    ("changes", "issue"),
    list(PARITY_CASES.values()),
    ids=list(PARITY_CASES),
)
def test_preview_and_commit_agree_on_every_row(
    changes: dict[str, str],
    issue: str | None,
) -> None:
    row = list(CLEAN_ROW)
    for name, value in changes.items():
        row[FIELD_INDEX[name]] = value
    admin = admin_user()
    batch = upload_batch(content=student_workbook([row]), uploaded_by=admin)

    previewed = preview_student_import(batch, column_mapping=STANDARD_MAPPING).rows[0]

    if issue is None:
        assert previewed.outcome == "READY", previewed.issues
        committed = commit_student_import(
            batch, actor=admin, column_mapping=STANDARD_MAPPING
        )
        assert committed.summary_json["created"] == 1
    else:
        assert previewed.outcome == "REVIEW_REQUIRED"
        assert previewed.issues == [issue]
        # A row needing attention is never passed over: the commit refuses.
        with pytest.raises(DjangoValidationError):
            commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)
        assert not Student.objects.exists()


def test_a_correction_is_held_to_the_same_rules() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))

    preview = preview_student_import(
        batch,
        column_mapping=STANDARD_MAPPING,
        corrections={"2": {"last_name": "L" * 151}},
    )

    assert preview.rows[0].issues == [
        "Last name: Ensure this value has at most 150 characters (it has 151).",
    ]


def test_a_row_taken_since_the_preview_fails_the_commit_clearly() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    real_create_students = create_students

    def created_elsewhere_first(new: Any, **kwargs: Any) -> list[Student]:
        first = new[0]
        Student.objects.create(
            wksa_id=first.wksa_id,
            first_name="Someone",
            last_name="Else",
            date_of_birth=first.date_of_birth,
            current_rank=first.current_rank,
        )
        return real_create_students(new, **kwargs)

    with (
        patch(
            "data_imports.services.create_students",
            side_effect=created_elsewhere_first,
        ),
        pytest.raises(DjangoValidationError) as raised,
    ):
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    [message] = raised.value.message_dict["rows"]
    assert message.startswith("Row 2 (206-2-500) is no longer valid: ")
    assert "now held by a student" in message
    assert message.endswith("Nothing was imported - check the file again.")
    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED


def test_a_database_conflict_during_commit_fails_it_clearly() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    with (
        patch(
            "data_imports.services.create_students",
            side_effect=IntegrityError("duplicate key"),
        ),
        pytest.raises(DjangoValidationError, match="conflicts with a change saved"),
    ):
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)


# --- commit_student_import ---------------------------------------------


def test_commit_creates_students_via_the_normal_service_and_audits_both() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    events_before = AuditEvent.objects.count()

    committed = commit_student_import(
        batch, actor=admin, column_mapping=STANDARD_MAPPING
    )

    assert committed.status == ImportBatch.Status.COMMITTED
    student = Student.objects.get(wksa_id="206-2-500")
    assert student.current_rank == rank("WHITE")
    assert AuditEvent.objects.filter(
        action=AuditAction.STUDENT_CREATED,
        entity_type="Student",
        entity_id=str(student.pk),
    ).exists()
    import_event = AuditEvent.objects.get(
        action=AuditAction.IMPORT_BATCH_COMMITTED,
        entity_type="ImportBatch",
        entity_id=str(batch.pk),
    )
    assert import_event.metadata["record_count"] == 1
    assert "wksa_id" not in import_event.summary
    assert AuditEvent.objects.count() == events_before + 2  # student + batch


def test_commit_never_creates_a_student_for_a_skip_existing_row() -> None:
    existing = Student.objects.create(
        wksa_id="206-2-500",
        first_name="Existing",
        last_name="Student",
        date_of_birth=timezone.localdate().replace(year=2010),
        current_rank=rank("YELLOW"),
    )
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    existing.refresh_from_db()
    assert existing.first_name == "Existing"
    assert existing.current_rank == rank("YELLOW")
    assert Student.objects.filter(wksa_id="206-2-500").count() == 1


def test_commit_refuses_while_a_row_needs_attention_and_creates_nothing() -> None:
    admin = admin_user()
    good_row = CLEAN_ROW
    bad_row = ["206-2-501", "Blair", "Park", "2012-05-01", "Not A Rank", "ACTIVE"]
    batch = upload_batch(
        content=student_workbook([good_row, bad_row]), uploaded_by=admin
    )

    with pytest.raises(DjangoValidationError) as refused:
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    assert "1 row needs attention" in str(refused.value)
    assert not Student.objects.exists()
    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED


def test_committing_two_batches_with_the_same_wksa_id_skips_the_second_safely() -> None:
    # commit_student_import always re-validates immediately before writing
    # (never trusts a stale preview), so a row that looked READY when this
    # batch was first uploaded is safely re-classified as SKIP_EXISTING - not
    # a duplicate and not a crash - if another batch committed that WKSA ID
    # first in the meantime.
    admin = admin_user()
    batch_a = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    batch_b = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    commit_student_import(batch_a, actor=admin, column_mapping=STANDARD_MAPPING)
    committed_b = commit_student_import(
        batch_b, actor=admin, column_mapping=STANDARD_MAPPING
    )

    assert committed_b.summary_json["created"] == 0
    assert committed_b.summary_json["skipped_existing"] == 1
    assert Student.objects.filter(wksa_id="206-2-500").count() == 1


def test_commit_is_not_idempotent_a_second_attempt_is_refused() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    with pytest.raises(Exception, match="cannot be imported again"):
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)


def test_commit_deletes_the_temporary_source_file(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    name = batch.source_file.name
    assert stored(name)

    with django_capture_on_commit_callbacks(execute=True):
        committed = commit_student_import(
            batch, actor=admin, column_mapping=STANDARD_MAPPING
        )

    assert not committed.source_file
    assert not stored(name)


def test_a_commit_whose_audit_fails_leaves_the_batch_retryable(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    with (
        django_capture_on_commit_callbacks(execute=True),
        patch("data_imports.services.record", side_effect=RuntimeError("audit")),
        pytest.raises(RuntimeError),
    ):
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED
    assert stored(batch.source_file.name)
    assert not Student.objects.filter(wksa_id="206-2-500").exists()
    retried = commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)
    assert retried.status == ImportBatch.Status.COMMITTED


def test_a_failed_delete_after_commit_still_reports_the_commit(
    django_capture_on_commit_callbacks: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    name = batch.source_file.name
    storage_class = type(import_upload_storage())

    # The patch encloses the capture: captured callbacks run as it exits.
    with (
        patch.object(storage_class, "delete", side_effect=OSError("read-only")),
        django_capture_on_commit_callbacks(execute=True),
    ):
        committed = commit_student_import(
            batch, actor=admin, column_mapping=STANDARD_MAPPING
        )

    assert committed.status == ImportBatch.Status.COMMITTED
    assert f"Import batch #{batch.pk} is closed" in caplog.text
    # Left for the sweep, which removes it once it is old enough.
    assert stored(name)
    age_file(name, hours=2)
    remove_orphaned_uploads(max_age=timedelta(hours=1))
    assert not stored(name)


# --- cancel_import_batch -------------------------------------------------


def test_cancel_deletes_temp_file_and_audits(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    name = batch.source_file.name

    with django_capture_on_commit_callbacks(execute=True):
        cancelled = cancel_import_batch(batch, actor=admin)

    assert cancelled.status == ImportBatch.Status.CANCELLED
    assert not cancelled.source_file
    assert not stored(name)
    assert AuditEvent.objects.filter(
        action=AuditAction.IMPORT_BATCH_CANCELLED,
        entity_type="ImportBatch",
        entity_id=str(batch.pk),
    ).exists()


def test_a_cancel_whose_save_fails_keeps_the_file(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    with (
        django_capture_on_commit_callbacks(execute=True),
        patch.object(ImportBatch, "save", side_effect=DatabaseError("disk full")),
        pytest.raises(DatabaseError),
    ):
        cancel_import_batch(batch, actor=admin)

    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED
    assert stored(batch.source_file.name)


def test_rolling_back_an_enclosing_transaction_keeps_the_file(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    with (
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(RuntimeError),
        transaction.atomic(),
    ):
        cancel_import_batch(batch, actor=admin)
        raise RuntimeError("the caller's own work failed")

    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED
    assert stored(batch.source_file.name)


def stale_batch(admin: User) -> ImportBatch:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    ImportBatch.objects.filter(pk=batch.pk).update(
        uploaded_at=timezone.now() - timedelta(hours=25),
    )
    return batch


def test_expiring_a_stale_batch_deletes_its_file_and_audits_it_as_expired(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = admin_user()
    stale = stale_batch(admin)
    fresh = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    name = stale.source_file.name

    with django_capture_on_commit_callbacks(execute=True):
        call_command("expire_stale_import_batches", "--hours", "24", stdout=StringIO())

    stale.refresh_from_db()
    fresh.refresh_from_db()
    assert stale.status == ImportBatch.Status.EXPIRED
    assert not stale.source_file
    assert not stored(name)
    assert fresh.status != ImportBatch.Status.EXPIRED
    assert stored(fresh.source_file.name)
    events = AuditEvent.objects.filter(entity_id=str(stale.pk))
    assert [event.action for event in events] == [AuditAction.IMPORT_BATCH_EXPIRED]


@pytest.mark.parametrize("hours", ["0", "-5"])
def test_expiry_refuses_a_retention_under_one_hour(hours: str) -> None:
    with pytest.raises(CommandError, match="at least 1"):
        call_command("expire_stale_import_batches", "--hours", hours)


def test_expiry_leaves_a_batch_that_closed_since_it_was_selected() -> None:
    admin = admin_user()
    batch = stale_batch(admin)
    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    assert expire_import_batch(batch.pk, max_age=timedelta(hours=24)) is False

    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.COMMITTED
    assert not AuditEvent.objects.filter(
        action=AuditAction.IMPORT_BATCH_EXPIRED,
    ).exists()


def test_expiry_leaves_a_batch_that_is_not_yet_stale() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))

    assert expire_import_batch(batch.pk, max_age=timedelta(hours=24)) is False
    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED


def test_an_expiry_whose_audit_fails_leaves_the_batch_open(
    django_capture_on_commit_callbacks: Any,
) -> None:
    batch = stale_batch(admin_user())

    with (
        django_capture_on_commit_callbacks(execute=True),
        patch("data_imports.services.record", side_effect=RuntimeError("audit")),
        pytest.raises(RuntimeError),
    ):
        expire_import_batch(batch.pk, max_age=timedelta(hours=24))

    batch.refresh_from_db()
    assert batch.status == ImportBatch.Status.UPLOADED
    assert stored(batch.source_file.name)


def test_expiry_carries_on_past_a_failing_batch_and_a_rerun_finishes() -> None:
    admin = admin_user()
    first, second = stale_batch(admin), stale_batch(admin)
    real = expire_import_batch

    def fail_first(batch_id: int, **kwargs: Any) -> bool:
        if batch_id == first.pk:
            raise DatabaseError("lock timeout")
        return real(batch_id, **kwargs)

    command = "data_imports.management.commands.expire_stale_import_batches"
    with (
        patch(f"{command}.expire_import_batch", side_effect=fail_first),
        pytest.raises(CommandError, match="1 batch"),
    ):
        call_command(
            "expire_stale_import_batches", stdout=StringIO(), stderr=StringIO()
        )

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == ImportBatch.Status.UPLOADED
    assert second.status == ImportBatch.Status.EXPIRED

    call_command("expire_stale_import_batches", stdout=StringIO())
    first.refresh_from_db()
    assert first.status == ImportBatch.Status.EXPIRED


def test_orphan_sweep_removes_only_old_files_no_batch_names() -> None:
    storage = import_upload_storage()
    named = upload_batch(content=student_workbook([CLEAN_ROW])).source_file.name
    old_orphan = storage.save("old-orphan.xlsx", ContentFile(b"x"))
    new_orphan = storage.save("new-orphan.xlsx", ContentFile(b"x"))
    age_file(named, hours=48)
    age_file(old_orphan, hours=48)

    remove_orphaned_uploads(max_age=timedelta(hours=24))

    assert stored(named)
    assert not stored(old_orphan)
    assert stored(new_orphan)
    storage.delete(new_orphan)


def test_a_check_reads_the_stored_rows_not_the_file() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))
    import_upload_storage().delete(batch.source_file.name)

    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)

    assert preview.ready == 1


def test_an_open_import_from_before_rows_were_stored_reads_its_file_once() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW]))
    # As an import uploaded before this release left it: no rows.
    batch.rows.all().delete()
    batch.configuration_json = {}
    batch.save()

    assert preview_student_import(batch, column_mapping=STANDARD_MAPPING).ready == 1
    assert batch.rows.count() == 1

    import_upload_storage().delete(batch.source_file.name)
    gone = upload_batch(
        content=student_workbook([CLEAN_ROW]),
        uploaded_by=batch.uploaded_by,
    )
    gone.rows.all().delete()
    gone.configuration_json = {}
    gone.save()
    import_upload_storage().delete(gone.source_file.name)
    with pytest.raises(Exception, match="no longer available"):
        preview_student_import(gone, column_mapping=STANDARD_MAPPING)


def test_cancel_a_committed_batch_is_refused() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    with pytest.raises(Exception, match="already imported"):
        cancel_import_batch(batch, actor=admin)


# --- deleting a user reassigns ImportBatch attribution -----------------------


def test_deleting_a_user_reassigns_import_batch_attribution() -> None:
    uploader = admin_user("uploader@example.com")
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=uploader)
    commit_student_import(batch, actor=uploader, column_mapping=STANDARD_MAPPING)
    batch.refresh_from_db()
    assert batch.committed_by == uploader

    remover = admin_user("remover@example.com")
    placeholder = delete_platform_user(uploader, remover)

    batch.refresh_from_db()
    assert batch.uploaded_by == placeholder
    assert batch.committed_by == placeholder


# --- API/permissions -----------------------------------------------------


def test_instructor_cannot_upload_preview_commit_or_cancel() -> None:
    client = APIClient()
    client.force_authenticate(user=instructor_user())
    content = student_workbook([CLEAN_ROW])

    create_response = client.post(
        "/api/data-imports/batches/",
        {
            "kind": ImportBatch.Kind.STUDENT_ROSTER,
            "file": SimpleUploadedFile("r.xlsx", content),
        },
        format="multipart",
    )
    assert create_response.status_code == 403

    admin = admin_user()
    batch = upload_batch(content=content, uploaded_by=admin)

    preview_response = client.post(
        f"/api/data-imports/batches/{batch.pk}/preview/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )
    assert preview_response.status_code == 403

    commit_response = client.post(
        f"/api/data-imports/batches/{batch.pk}/commit/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )
    assert commit_response.status_code == 403

    cancel_response = client.post(f"/api/data-imports/batches/{batch.pk}/cancel/")
    assert cancel_response.status_code == 403


def test_anonymous_user_is_denied() -> None:
    client = APIClient()
    response = client.post("/api/data-imports/batches/", {}, format="json")
    assert response.status_code in (401, 403)


def test_admin_completes_the_full_upload_preview_commit_flow_via_the_api() -> None:
    client = APIClient()
    admin = admin_user()
    client.force_authenticate(user=admin)
    content = student_workbook([CLEAN_ROW])

    create_response = client.post(
        "/api/data-imports/batches/",
        {
            "kind": ImportBatch.Kind.STUDENT_ROSTER,
            "file": SimpleUploadedFile("r.xlsx", content),
        },
        format="multipart",
    )
    assert create_response.status_code == 201
    created = create_response.json()
    batch_id = created["id"]
    assert created["detected_headers"] == list(STANDARD_STUDENT_HEADERS.values())
    assert created["suggested_mapping"] == STANDARD_MAPPING

    preview_response = client.post(
        f"/api/data-imports/batches/{batch_id}/preview/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )
    assert preview_response.status_code == 200
    assert preview_response.json()["ready"] == 1

    commit_response = client.post(
        f"/api/data-imports/batches/{batch_id}/commit/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )
    assert commit_response.status_code == 200
    assert commit_response.json()["id"] == batch_id
    assert ImportBatch.objects.get(pk=batch_id).status == ImportBatch.Status.COMMITTED
    assert Student.objects.filter(wksa_id="206-2-500").exists()


def test_preview_of_a_mapping_missing_a_needed_field_shows_the_row_waiting() -> None:
    # A needed field may have no column: its value is typed in row by row.
    client = APIClient()
    admin = admin_user()
    client.force_authenticate(user=admin)
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    response = client.post(
        f"/api/data-imports/batches/{batch.pk}/preview/",
        {"column_mapping": {"wksa_id": "WKSA ID"}},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["review_required"] == 1
