from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from io import StringIO

import pytest
import tablib
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.services import delete_platform_user
from audit.models import AuditAction, AuditEvent
from data_imports.mappings import STANDARD_STUDENT_HEADERS, suggest_column_mapping
from data_imports.models import ImportBatch
from data_imports.parsers import UnsupportedImportFileError, load_tabular_dataset
from data_imports.services import (
    cancel_import_batch,
    commit_student_import,
    create_import_batch,
    preview_student_import,
)
from ranks.models import Rank
from students.models import Student

pytestmark = pytest.mark.django_db


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def admin_user(email: str = "import-admin@example.com") -> User:
    return User.objects.create_user(email=email, role=User.Role.ADMINISTRATOR)


def instructor_user(email: str = "import-instructor@example.com") -> User:
    return User.objects.create_user(email=email, role=User.Role.INSTRUCTOR)


STANDARD_MAPPING = {field: header for field, header in STANDARD_STUDENT_HEADERS.items()}


def student_workbook(
    rows: Sequence[Sequence[object]],
    *,
    headers: list[str] | None = None,
    file_format: str = "xlsx",
) -> bytes:
    dataset = tablib.Dataset(headers=headers or list(STANDARD_STUDENT_HEADERS.values()))
    for row in rows:
        dataset.append(row)
    exported = dataset.export(file_format)
    return exported if isinstance(exported, bytes) else exported.encode("utf-8")


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


CLEAN_ROW = ["000123", "Alex", "Kim", "2012-05-01", "White", "ACTIVE"]


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
    assert dataset.headers is not None
    assert len(dataset) == 1


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
    with pytest.raises(Exception, match="Unsupported file type"):
        create_import_batch(
            kind=ImportBatch.Kind.LEGACY_GRADINGS,
            upload=SimpleUploadedFile("roster.csv", content),
            uploaded_by=admin_user(),
        )


def test_create_import_batch_rejects_oversized_file() -> None:
    huge = b"a" * (6 * 1024 * 1024)
    with pytest.raises(Exception, match="MiB limit"):
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


def test_preview_flags_missing_required_field_as_review_required() -> None:
    row = ["000124", "", "Kim", "2012-05-01", "White", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "First name is required." in preview.rows[0].issues


def test_preview_flags_future_dob_as_review_required() -> None:
    future = (timezone.localdate() + timedelta(days=1)).isoformat()
    row = ["000125", "Alex", "Kim", future, "White", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "cannot be in the future" in preview.rows[0].issues[0]


def test_preview_flags_unresolved_rank_as_review_required() -> None:
    row = ["000126", "Alex", "Kim", "2012-05-01", "Not A Rank", "ACTIVE"]
    batch = upload_batch(content=student_workbook([row]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert "did not match the rank catalogue" in preview.rows[0].issues[0]


def test_preview_flags_existing_wksa_id_as_skip_existing_and_never_updates() -> None:
    Student.objects.create(
        wksa_id="000123",
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
    assert row.existing_student_display == "Existing Student (000123)"


def test_preview_flags_duplicate_wksa_id_within_file() -> None:
    batch = upload_batch(content=student_workbook([CLEAN_ROW, CLEAN_ROW]))
    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)
    assert preview.review_required == 1
    assert preview.ready == 1
    duplicate_row = next(r for r in preview.rows if r.outcome == "REVIEW_REQUIRED")
    assert "Duplicate WKSA ID within this file." in duplicate_row.issues


def test_preview_applies_row_correction() -> None:
    row = ["000127", "", "Kim", "2012-05-01", "White", "ACTIVE"]
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


# --- commit_student_import ---------------------------------------------


def test_commit_creates_students_via_the_normal_service_and_audits_both() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    events_before = AuditEvent.objects.count()

    committed = commit_student_import(
        batch, actor=admin, column_mapping=STANDARD_MAPPING
    )

    assert committed.status == ImportBatch.Status.COMMITTED
    student = Student.objects.get(wksa_id="000123")
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
        wksa_id="000123",
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
    assert Student.objects.filter(wksa_id="000123").count() == 1


def test_commit_only_creates_ready_rows_never_review_required_ones() -> None:
    admin = admin_user()
    good_row = CLEAN_ROW
    bad_row = ["000128", "Blair", "Park", "2012-05-01", "Not A Rank", "ACTIVE"]
    batch = upload_batch(
        content=student_workbook([good_row, bad_row]), uploaded_by=admin
    )

    committed = commit_student_import(
        batch, actor=admin, column_mapping=STANDARD_MAPPING
    )

    assert committed.summary_json["created"] == 1
    assert committed.summary_json["review_required"] == 1
    assert Student.objects.filter(wksa_id="000123").exists()
    assert not Student.objects.filter(wksa_id="000128").exists()


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
    assert Student.objects.filter(wksa_id="000123").count() == 1


def test_commit_is_not_idempotent_a_second_attempt_is_refused() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    with pytest.raises(Exception, match="cannot be committed again"):
        commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)


def test_commit_deletes_the_temporary_source_file() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    assert batch.source_file

    committed = commit_student_import(
        batch, actor=admin, column_mapping=STANDARD_MAPPING
    )

    assert not committed.source_file


# --- cancel_import_batch -------------------------------------------------


def test_cancel_deletes_temp_file_and_audits() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    cancelled = cancel_import_batch(batch, actor=admin)

    assert cancelled.status == ImportBatch.Status.CANCELLED
    assert not cancelled.source_file
    assert AuditEvent.objects.filter(
        action=AuditAction.IMPORT_BATCH_CANCELLED,
        entity_type="ImportBatch",
        entity_id=str(batch.pk),
    ).exists()


def test_expiring_a_stale_batch_deletes_its_file_and_audits_it_as_expired() -> None:
    admin = admin_user()
    stale = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    fresh = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    ImportBatch.objects.filter(pk=stale.pk).update(
        uploaded_at=timezone.now() - timedelta(hours=25),
    )

    call_command("expire_stale_import_batches", "--hours", "24", stdout=StringIO())

    stale.refresh_from_db()
    fresh.refresh_from_db()
    assert stale.status == ImportBatch.Status.EXPIRED
    assert not stale.source_file
    assert fresh.status != ImportBatch.Status.EXPIRED
    events = AuditEvent.objects.filter(entity_id=str(stale.pk))
    assert [event.action for event in events] == [AuditAction.IMPORT_BATCH_EXPIRED]


def test_cancel_a_committed_batch_is_refused() -> None:
    admin = admin_user()
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    commit_student_import(batch, actor=admin, column_mapping=STANDARD_MAPPING)

    with pytest.raises(Exception, match="already COMMITTED"):
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
    assert commit_response.json()["status"] == ImportBatch.Status.COMMITTED
    assert Student.objects.filter(wksa_id="000123").exists()


def test_preview_rejects_incomplete_column_mapping() -> None:
    client = APIClient()
    admin = admin_user()
    client.force_authenticate(user=admin)
    batch = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)

    response = client.post(
        f"/api/data-imports/batches/{batch.pk}/preview/",
        {"column_mapping": {"wksa_id": "WKSA ID"}},
        format="json",
    )
    assert response.status_code == 400
