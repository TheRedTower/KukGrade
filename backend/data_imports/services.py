"""Import batch lifecycle and student-roster preview/commit.

Every created `Student` goes through `students.services.create_student` -
the exact service a hand-created student uses - so full model validation and
the normal `STUDENT_CREATED` audit event happen identically either way (spec
section 21: a bulk importer must never bypass the domain-service layer).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record
from data_imports.mappings import (
    STUDENT_REQUIRED_TARGET_FIELDS,
    STUDENT_TARGET_FIELDS,
    suggest_column_mapping,
)
from data_imports.models import ImportBatch
from data_imports.parsers import UnsupportedImportFileError, load_tabular_dataset
from ranks.models import Rank
from students.models import Student
from students.services import create_student

MAX_UPLOAD_BYTES = 5 * 1024 * 1024

_ALLOWED_EXTENSIONS: dict[str, frozenset[str]] = {
    ImportBatch.Kind.STUDENT_ROSTER: frozenset({"xlsx", "csv"}),
    ImportBatch.Kind.LEGACY_GRADINGS: frozenset({"xlsx"}),
}

_READY = "READY"
_REVIEW_REQUIRED = "REVIEW_REQUIRED"
_SKIP_EXISTING = "SKIP_EXISTING"

_DATE_FORMATS: tuple[str, ...] = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y")


# --- batch lifecycle -------------------------------------------------------


@dataclass(frozen=True)
class CreateImportBatchResult:
    batch: ImportBatch
    already_imported_warning: bool
    detected_headers: list[str]
    suggested_mapping: dict[str, str]


@transaction.atomic
def create_import_batch(
    *,
    kind: str,
    upload: UploadedFile,
    uploaded_by: User,
) -> CreateImportBatchResult:
    allowed = _ALLOWED_EXTENSIONS.get(kind)
    if allowed is None:
        raise DjangoValidationError({"kind": [f"Unknown import kind {kind!r}."]})

    filename = upload.name or "upload"
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in allowed:
        raise DjangoValidationError(
            {
                "file": [
                    f"Unsupported file type .{suffix or '?'} for {kind}. "
                    f"Allowed: {', '.join(sorted(allowed))}.",
                ],
            },
        )

    content = upload.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise DjangoValidationError(
            {
                "file": [
                    f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit."
                ]
            },
        )

    # Parse-validate before the file is ever persisted, so a malformed
    # upload is rejected immediately rather than discovered at preview time.
    # The headers are also handed back so the frontend can build a mapping
    # UI without a second round trip.
    try:
        dataset = load_tabular_dataset(content=content, filename=filename)
    except UnsupportedImportFileError as exc:
        raise DjangoValidationError({"file": [str(exc)]}) from exc
    detected_headers = [str(header) for header in dataset.headers]

    digest = hashlib.sha256(content).hexdigest()
    already_imported_warning = ImportBatch.objects.filter(
        kind=kind,
        sha256=digest,
        status=ImportBatch.Status.COMMITTED,
    ).exists()

    upload.seek(0)
    batch = ImportBatch.objects.create(
        kind=kind,
        status=ImportBatch.Status.UPLOADED,
        source_file=upload,
        original_filename=filename,
        sha256=digest,
        file_size=len(content),
        uploaded_by=uploaded_by,
    )
    return CreateImportBatchResult(
        batch=batch,
        already_imported_warning=already_imported_warning,
        detected_headers=detected_headers,
        suggested_mapping=(
            suggest_column_mapping(detected_headers)
            if kind == ImportBatch.Kind.STUDENT_ROSTER
            else {}
        ),
    )


def delete_batch_file(batch: ImportBatch) -> None:
    if batch.source_file:
        batch.source_file.delete(save=False)


@transaction.atomic
def cancel_import_batch(batch: ImportBatch, *, actor: User) -> ImportBatch:
    locked = ImportBatch.objects.select_for_update(of=("self",)).get(pk=batch.pk)
    if locked.status not in ImportBatch.UNCOMMITTED_STATUSES:
        raise DjangoValidationError(
            {"batch": [f"Batch is already {locked.status} and cannot be cancelled."]},
        )

    delete_batch_file(locked)
    locked.status = ImportBatch.Status.CANCELLED
    locked.cancelled_by = actor
    locked.cancelled_at = timezone.now()
    locked.save(
        update_fields=[
            "status",
            "cancelled_by",
            "cancelled_at",
            "source_file",
            "updated_at",
        ],
    )
    record(
        AuditAction.IMPORT_BATCH_CANCELLED,
        locked,
        f"Import batch #{locked.pk} ({locked.kind}) cancelled.",
        actor=actor,
        metadata={"batch_id": locked.pk, "kind": locked.kind},
    )
    return locked


def _load_batch_dataset(batch: ImportBatch) -> Any:
    if not batch.source_file:
        raise DjangoValidationError(
            {
                "batch": [
                    "This batch's source file is no longer available "
                    "(already committed, cancelled, or expired).",
                ],
            },
        )
    with batch.source_file.open("rb") as handle:
        content = handle.read()
    try:
        return load_tabular_dataset(content=content, filename=batch.original_filename)
    except UnsupportedImportFileError as exc:
        raise DjangoValidationError({"batch": [str(exc)]}) from exc


# --- student roster preview/commit -----------------------------------------


@dataclass(frozen=True)
class StudentImportRowResult:
    row_number: int
    outcome: str
    wksa_id: str
    first_name: str
    last_name: str
    date_of_birth_display: str
    date_of_birth: date | None
    current_rank_text: str
    current_rank_id: int | None
    current_rank_code: str | None
    status: str
    issues: list[str] = field(default_factory=list)
    existing_student_id: int | None = None
    existing_student_display: str | None = None


@dataclass(frozen=True)
class StudentImportPreview:
    total: int
    ready: int
    review_required: int
    skip_existing: int
    rows: list[StudentImportRowResult]


def _coerce_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        text = value.strip()
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
    return None


def _resolve_rank(text: str) -> Rank | None:
    if not text:
        return None
    return Rank.objects.filter(
        Q(code__iexact=text) | Q(name__iexact=text), active=True
    ).first()


def _map_row(raw_row: dict[str, Any], column_mapping: dict[str, str]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for target_field in STUDENT_TARGET_FIELDS:
        source_header = column_mapping.get(target_field)
        values[target_field] = raw_row.get(source_header) if source_header else None
    return values


def _classify_student_row(
    row_number: int,
    values: dict[str, Any],
    correction: dict[str, str],
    seen_wksa_ids: set[str],
) -> StudentImportRowResult:
    issues: list[str] = []

    wksa_id = str(correction.get("wksa_id", values.get("wksa_id")) or "").strip()
    first_name = str(
        correction.get("first_name", values.get("first_name")) or ""
    ).strip()
    last_name = str(correction.get("last_name", values.get("last_name")) or "").strip()
    status_text = (
        str(correction.get("status", values.get("status")) or "").strip().upper()
        or Student.Status.ACTIVE
    )
    rank_text = str(
        correction.get("current_rank", values.get("current_rank")) or ""
    ).strip()
    dob_raw = correction.get("date_of_birth", values.get("date_of_birth"))

    if not wksa_id:
        issues.append("WKSA ID is required.")
    if not first_name:
        issues.append("First name is required.")
    if not last_name:
        issues.append("Last name is required.")

    dob_display = "" if dob_raw is None else str(dob_raw).strip()
    parsed_dob = _coerce_date(dob_raw)
    if not dob_display:
        issues.append("Date of birth is required.")
    elif parsed_dob is None:
        issues.append(f"Date of birth {dob_display!r} could not be parsed.")
    elif parsed_dob > timezone.localdate():
        issues.append("Date of birth cannot be in the future.")

    rank = _resolve_rank(rank_text)
    if not rank_text:
        issues.append("Current rank is required.")
    elif rank is None:
        issues.append(f"Rank {rank_text!r} did not match the rank catalogue.")

    if status_text not in Student.Status.values:
        issues.append(f"Status {status_text!r} is not recognised.")
        status_text = Student.Status.ACTIVE

    if wksa_id and wksa_id in seen_wksa_ids:
        issues.append("Duplicate WKSA ID within this file.")
    if wksa_id:
        seen_wksa_ids.add(wksa_id)

    existing = Student.objects.filter(wksa_id=wksa_id).first() if wksa_id else None

    if existing is not None:
        outcome = _SKIP_EXISTING
    elif issues:
        outcome = _REVIEW_REQUIRED
    else:
        outcome = _READY

    return StudentImportRowResult(
        row_number=row_number,
        outcome=outcome,
        wksa_id=wksa_id,
        first_name=first_name,
        last_name=last_name,
        date_of_birth_display=dob_display,
        date_of_birth=parsed_dob,
        current_rank_text=rank_text,
        current_rank_id=rank.id if rank else None,
        current_rank_code=rank.code if rank else None,
        status=status_text,
        issues=issues,
        existing_student_id=existing.id if existing else None,
        existing_student_display=str(existing) if existing else None,
    )


def preview_student_import(
    batch: ImportBatch,
    *,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> StudentImportPreview:
    dataset = _load_batch_dataset(batch)
    corrections = corrections or {}
    seen_wksa_ids: set[str] = set()
    rows: list[StudentImportRowResult] = []
    for index, raw_row in enumerate(dataset.dict, start=2):  # header is row 1
        values = _map_row(raw_row, column_mapping)
        row_correction = corrections.get(str(index), {})
        rows.append(_classify_student_row(index, values, row_correction, seen_wksa_ids))

    return StudentImportPreview(
        total=len(rows),
        ready=sum(1 for row in rows if row.outcome == _READY),
        review_required=sum(1 for row in rows if row.outcome == _REVIEW_REQUIRED),
        skip_existing=sum(1 for row in rows if row.outcome == _SKIP_EXISTING),
        rows=rows,
    )


@transaction.atomic
def commit_student_import(
    batch: ImportBatch,
    *,
    actor: User,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> ImportBatch:
    locked = ImportBatch.objects.select_for_update(of=("self",)).get(pk=batch.pk)
    if locked.status not in ImportBatch.UNCOMMITTED_STATUSES:
        raise DjangoValidationError(
            {
                "batch": [
                    f"Batch is already {locked.status} and cannot be committed again."
                ]
            },
        )

    # Never trusts a stale frontend preview - re-runs the exact same
    # validation against the source file right now (spec sections 10/20).
    preview = preview_student_import(
        locked,
        column_mapping=column_mapping,
        corrections=corrections,
    )
    ready_rows = [row for row in preview.rows if row.outcome == _READY]

    created = 0
    for row in ready_rows:
        # A READY row always has both resolved by _classify_student_row; the
        # None checks below are for mypy narrowing and the rare-race guard
        # (a rank deactivated between preview and commit) in one step.
        rank = (
            Rank.objects.filter(pk=row.current_rank_id, active=True).first()
            if row.current_rank_id is not None
            else None
        )
        if rank is None or row.date_of_birth is None:
            # Rare race: valid at preview time, no longer valid now (e.g. the
            # rank was deactivated in the last few minutes). All-or-nothing
            # per the recorded commit-semantics deviation - the whole batch
            # rolls back rather than silently skipping the row.
            raise DjangoValidationError(
                {"rows": [f"Row {row.row_number} ({row.wksa_id}) is no longer valid."]},
            )
        create_student(
            wksa_id=row.wksa_id,
            first_name=row.first_name,
            last_name=row.last_name,
            date_of_birth=row.date_of_birth,
            current_rank=rank,
            status=row.status,
            actor=actor,
        )
        created += 1

    locked.status = ImportBatch.Status.COMMITTED
    locked.committed_by = actor
    locked.committed_at = timezone.now()
    locked.summary_json = {
        "total": preview.total,
        "created": created,
        "skipped_existing": preview.skip_existing,
        "review_required": preview.review_required,
    }
    locked.configuration_json = {"column_mapping": column_mapping}
    delete_batch_file(locked)
    locked.save(
        update_fields=[
            "status",
            "committed_by",
            "committed_at",
            "summary_json",
            "configuration_json",
            "source_file",
            "updated_at",
        ],
    )

    record(
        AuditAction.IMPORT_BATCH_COMMITTED,
        locked,
        f"Import batch #{locked.pk} ({locked.kind}) committed: "
        f"{created} student(s) created.",
        actor=actor,
        metadata={
            "batch_id": locked.pk,
            "kind": locked.kind,
            "sha256_prefix": locked.sha256[:12],
            "record_count": created,
        },
    )
    return locked


__all__ = [
    "STUDENT_REQUIRED_TARGET_FIELDS",
    "CreateImportBatchResult",
    "StudentImportPreview",
    "StudentImportRowResult",
    "cancel_import_batch",
    "commit_student_import",
    "create_import_batch",
    "delete_batch_file",
    "preview_student_import",
]
