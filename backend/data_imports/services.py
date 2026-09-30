"""Import batch lifecycle, and preview/commit for both batch kinds.

Every created `Student` goes through `students.services.create_student` -
the exact service a hand-created student uses - so full model validation and
the normal `STUDENT_CREATED` audit event happen identically either way: a
bulk importer never bypasses the domain-service layer.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import partial
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, models, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record
from data_imports.ksw_adapter import (
    CanonicalLegacyRow,
    WorkbookParseResult,
    WorkbookStructureError,
    parse_ksw_colchester_workbook,
)
from data_imports.mappings import (
    STUDENT_REQUIRED_TARGET_FIELDS,
    STUDENT_TARGET_FIELDS,
    suggest_column_mapping,
)
from data_imports.models import ImportBatch
from data_imports.parsers import (
    TabularData,
    UnsupportedImportFileError,
    file_suffix,
    load_tabular_dataset,
)
from data_imports.storage import import_upload_storage
from gradings.legacy_services import create_legacy_grading_record
from gradings.models import LegacyRecordKind
from ranks.models import Rank
from students.models import Student
from students.services import create_student

logger = logging.getLogger(__name__)

_ALLOWED_EXTENSIONS: dict[str, frozenset[str]] = {
    ImportBatch.Kind.STUDENT_ROSTER: frozenset({"xlsx", "csv"}),
    ImportBatch.Kind.LEGACY_GRADINGS: frozenset({"xlsx"}),
}


class StudentImportRowOutcome(models.TextChoices):
    READY = "READY", "Ready"
    REVIEW_REQUIRED = "REVIEW_REQUIRED", "Needs review"
    SKIP_EXISTING = "SKIP_EXISTING", "Skip - WKSA ID exists"


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
    suffix = file_suffix(filename)
    if suffix not in allowed:
        raise DjangoValidationError(
            {
                "file": [
                    f"Unsupported file type .{suffix or '?'} for {kind}. "
                    f"Allowed: {', '.join(sorted(allowed))}.",
                ],
            },
        )

    # The declared size is checked before reading and the read is capped
    # too, so a wrong declared size cannot make it read past the limit.
    limit = settings.IMPORT_UPLOAD_MAX_BYTES
    too_large = DjangoValidationError(
        {"file": [f"File exceeds the {limit / (1024 * 1024):g} MiB limit."]},
    )
    if upload.size is not None and upload.size > limit:
        raise too_large
    content = upload.read(limit + 1)
    if len(content) > limit:
        raise too_large

    # Parsed in full before the file is ever persisted, so a malformed or
    # unusable upload is refused now rather than discovered at preview. A
    # roster's headers also go back, so the mapping UI needs no second trip.
    detected_headers: list[str] = []
    if kind == ImportBatch.Kind.STUDENT_ROSTER:
        try:
            dataset = load_tabular_dataset(content=content, filename=filename)
        except UnsupportedImportFileError as exc:
            raise DjangoValidationError({"file": [str(exc)]}) from exc
        detected_headers = dataset.headers
    else:
        parsed = _parse_legacy_workbook(content, error_key="file")
        if not parsed.rows:
            raise DjangoValidationError(
                {
                    "file": [
                        "No historical records were found: the workbook has "
                        "no grading-period sheet (named like 06-2025) with a "
                        "Name / Current Rank / Testing For / Outcome table.",
                        *parsed.warnings,
                    ],
                },
            )

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


def _release_source_file(locked: ImportBatch) -> None:
    """Detach the batch's file now, and delete it once this transaction commits.

    Storage is not transactional (KG-A07): a file deleted before the commit
    stays deleted if the commit then fails, leaving an open batch with
    nothing to read. Until the commit the file is still on disk and the
    rolled-back row still names it, so a failure leaves the batch retryable.
    """
    name = locked.source_file.name
    if not name:
        return
    storage = locked.source_file.storage
    locked.source_file = ""
    transaction.on_commit(partial(_delete_stored_file, storage, name, locked.pk))


def _delete_stored_file(storage: Storage, name: str, batch_id: int) -> None:
    # Runs after the commit, so a failure here must not look like one: the
    # batch really is closed. The file is left for remove_orphaned_uploads.
    try:
        storage.delete(name)
    except OSError:
        logger.warning(
            "Import batch #%s is closed but its source file could not be "
            "deleted; expire_stale_import_batches will remove it.",
            batch_id,
            exc_info=True,
        )


def _lock_uncommitted(batch: ImportBatch, verb: str) -> ImportBatch:
    locked = ImportBatch.objects.select_for_update(of=("self",)).get(pk=batch.pk)
    if locked.status != ImportBatch.Status.UPLOADED:
        raise DjangoValidationError(
            {"batch": [f"Batch is already {locked.status} and cannot be {verb}."]},
        )
    return locked


_SOURCE_FILE_GONE = (
    "This batch's source file is no longer available "
    "(already committed, cancelled, or expired)."
)


def _read_source_file(batch: ImportBatch) -> bytes:
    # A preview holds no lock, so the batch can close - and its file go -
    # between loading the row and opening the file.
    if not batch.source_file:
        raise DjangoValidationError({"batch": [_SOURCE_FILE_GONE]})
    try:
        with batch.source_file.open("rb") as handle:
            content: bytes = handle.read()
    except FileNotFoundError as exc:
        raise DjangoValidationError({"batch": [_SOURCE_FILE_GONE]}) from exc
    return content


def _mark_committed(
    locked: ImportBatch,
    *,
    actor: User,
    summary: dict[str, int],
    configuration: dict[str, Any],
    record_count: int,
    what: str,
) -> ImportBatch:
    """Close a committed batch: provenance, safe counts, file removed, and
    one IMPORT_BATCH_COMMITTED event for the whole cascade."""
    locked.status = ImportBatch.Status.COMMITTED
    locked.committed_by = actor
    locked.committed_at = timezone.now()
    locked.summary_json = summary
    locked.configuration_json = configuration
    _release_source_file(locked)
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
        f"{record_count} {what} created.",
        actor=actor,
        metadata={
            "batch_id": locked.pk,
            "kind": locked.kind,
            "sha256_prefix": locked.sha256[:12],
            "record_count": record_count,
        },
    )
    return locked


@transaction.atomic
def cancel_import_batch(batch: ImportBatch, *, actor: User) -> ImportBatch:
    locked = _lock_uncommitted(batch, "cancelled")
    _release_source_file(locked)
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


@transaction.atomic
def expire_import_batch(batch_id: int, *, max_age: timedelta) -> bool:
    """Expire one abandoned batch, under the lock commit and cancel take.

    The caller's selection may be stale by now (KG-A08): the batch can have
    been committed, cancelled or deleted since. Rechecked under the lock, so
    exactly one of those transitions wins. Returns whether this one did.
    """
    locked = (
        ImportBatch.objects.select_for_update(of=("self",)).filter(pk=batch_id).first()
    )
    if (
        locked is None
        or locked.status != ImportBatch.Status.UPLOADED
        or locked.uploaded_at >= timezone.now() - max_age
    ):
        return False
    _release_source_file(locked)
    locked.status = ImportBatch.Status.EXPIRED
    locked.save(update_fields=["status", "source_file", "updated_at"])
    hours = max_age // timedelta(hours=1)
    record(
        AuditAction.IMPORT_BATCH_EXPIRED,
        locked,
        f"Import batch #{locked.pk} ({locked.kind}) expired after {hours}h.",
        metadata={"batch_id": locked.pk, "kind": locked.kind},
    )
    return True


def remove_orphaned_uploads(*, max_age: timedelta) -> int:
    """Delete stored files no batch names, once they are older than max_age.

    Covers a file saved for a batch whose creation then rolled back, and one
    a closed batch failed to delete after its commit. The age guard leaves
    alone a file whose batch is still being created.
    """
    storage = import_upload_storage()
    try:
        _, names = storage.listdir("")
    except FileNotFoundError:
        return 0
    named = set(
        ImportBatch.objects.exclude(source_file="").values_list(
            "source_file",
            flat=True,
        ),
    )
    cutoff = timezone.now() - max_age
    removed = 0
    for name in names:
        if name in named or storage.get_modified_time(name) >= cutoff:
            continue
        storage.delete(name)
        removed += 1
    return removed


def _load_batch_dataset(batch: ImportBatch) -> TabularData:
    content = _read_source_file(batch)
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


_STUDENT_FIELD_LABELS = {
    "wksa_id": "WKSA ID",
    "first_name": "First name",
    "last_name": "Last name",
    "date_of_birth": "Date of birth",
}


def _student_model_issues(
    *,
    wksa_id: str,
    first_name: str,
    last_name: str,
    date_of_birth: date | None,
) -> list[str]:
    """What `Student`'s own validation says of an unsaved row (KG-A09).

    The field and `clean()` rules `create_student` runs on save - lengths,
    blanks, a future date of birth - so a row preview calls ready is one
    commit can create. A value that is missing or did not parse already has
    its own issue, so its field is skipped here. So are the checks that each
    cost a query and repeat one preview has made: the rank was just read
    from the catalogue, the status checked against its choices, and the two
    check constraints restate `clean()` and those choices. An existing WKSA
    ID is a skip, not an error (import Decision 9).
    """
    given = {
        "wksa_id": wksa_id,
        "first_name": first_name,
        "last_name": last_name,
        "date_of_birth": date_of_birth,
    }
    unset = {name for name, value in given.items() if not value}
    candidate = Student(**{name: given[name] for name in given.keys() - unset})
    try:
        candidate.full_clean(
            exclude={"current_rank", *unset},
            validate_unique=False,
            validate_constraints=False,
        )
    except DjangoValidationError as exc:
        return [
            _labelled(name, message)
            for name, messages in exc.message_dict.items()
            for message in messages
        ]
    return []


def _labelled(name: str, message: str) -> str:
    label = _STUDENT_FIELD_LABELS.get(name)
    if label is None or message.startswith(label):
        return message
    return f"{label}: {message}"


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

    dob_display = "" if dob_raw is None else str(dob_raw).strip()
    parsed_dob = _coerce_date(dob_raw)
    if not dob_display:
        issues.append("Date of birth is required.")
    elif parsed_dob is None:
        issues.append(f"Date of birth {dob_display!r} could not be parsed.")

    rank = _resolve_rank(rank_text)
    if not rank_text:
        issues.append("Current rank is required.")
    elif rank is None:
        issues.append(f"Rank {rank_text!r} did not match the rank catalogue.")

    if status_text not in Student.Status.values:
        issues.append(f"Status {status_text!r} is not recognised.")
        status_text = Student.Status.ACTIVE

    issues.extend(
        _student_model_issues(
            wksa_id=wksa_id,
            first_name=first_name,
            last_name=last_name,
            date_of_birth=parsed_dob,
        ),
    )

    if wksa_id and wksa_id in seen_wksa_ids:
        issues.append("Duplicate WKSA ID within this file.")
    if wksa_id:
        seen_wksa_ids.add(wksa_id)

    existing = Student.objects.filter(wksa_id=wksa_id).first() if wksa_id else None

    if existing is not None:
        outcome = StudentImportRowOutcome.SKIP_EXISTING
    elif issues:
        outcome = StudentImportRowOutcome.REVIEW_REQUIRED
    else:
        outcome = StudentImportRowOutcome.READY

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
    for row_number, raw_row in dataset.rows:
        values = _map_row(raw_row, column_mapping)
        row_correction = corrections.get(str(row_number), {})
        rows.append(
            _classify_student_row(row_number, values, row_correction, seen_wksa_ids),
        )

    return StudentImportPreview(
        total=len(rows),
        ready=sum(1 for row in rows if row.outcome == StudentImportRowOutcome.READY),
        review_required=sum(
            1 for row in rows if row.outcome == StudentImportRowOutcome.REVIEW_REQUIRED
        ),
        skip_existing=sum(
            1 for row in rows if row.outcome == StudentImportRowOutcome.SKIP_EXISTING
        ),
        rows=rows,
    )


def _row_no_longer_valid(
    row: StudentImportRowResult,
    reason: str,
) -> DjangoValidationError:
    return DjangoValidationError(
        {
            "rows": [
                f"Row {row.row_number} ({row.wksa_id}) is no longer valid: "
                f"{reason} Nothing was imported - preview the file again.",
            ],
        },
    )


@transaction.atomic
def commit_student_import(
    batch: ImportBatch,
    *,
    actor: User,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> ImportBatch:
    locked = _lock_uncommitted(batch, "committed again")

    # Never trusts a stale frontend preview - re-runs the exact same
    # validation against the source file right now.
    preview = preview_student_import(
        locked,
        column_mapping=column_mapping,
        corrections=corrections,
    )
    ready_rows = [
        row for row in preview.rows if row.outcome == StudentImportRowOutcome.READY
    ]

    created = 0
    for row in ready_rows:
        # A READY row always has both resolved by _classify_student_row; the
        # None checks narrow the types and catch a rank deactivated since.
        rank = (
            Rank.objects.filter(pk=row.current_rank_id, active=True).first()
            if row.current_rank_id is not None
            else None
        )
        if rank is None or row.date_of_birth is None:
            raise _row_no_longer_valid(row, "its rank is no longer active.")
        # Preview ran the same validation moments ago, so a refusal here is a
        # concurrent change - such as the same WKSA ID created elsewhere.
        # All-or-nothing per the recorded commit-semantics deviation: the
        # whole batch rolls back rather than silently skipping the row.
        try:
            with transaction.atomic():
                create_student(
                    wksa_id=row.wksa_id,
                    first_name=row.first_name,
                    last_name=row.last_name,
                    date_of_birth=row.date_of_birth,
                    current_rank=rank,
                    status=row.status,
                    actor=actor,
                )
        except DjangoValidationError as exc:
            raise _row_no_longer_valid(row, " ".join(exc.messages)) from exc
        except IntegrityError as exc:
            raise _row_no_longer_valid(
                row,
                "it conflicts with a change saved since the preview.",
            ) from exc
        created += 1

    return _mark_committed(
        locked,
        actor=actor,
        summary={
            "total": preview.total,
            "created": created,
            "skipped_existing": preview.skip_existing,
            "review_required": preview.review_required,
        },
        configuration={"column_mapping": column_mapping},
        record_count=created,
        what="student(s)",
    )


# --- historical grading workbook preview/commit -----------------------------


def _parse_legacy_workbook(content: bytes, *, error_key: str) -> WorkbookParseResult:
    try:
        return parse_ksw_colchester_workbook(content)
    except WorkbookStructureError as exc:
        raise DjangoValidationError({error_key: [str(exc)]}) from exc


def _load_legacy_workbook(batch: ImportBatch) -> WorkbookParseResult:
    return _parse_legacy_workbook(_read_source_file(batch), error_key="batch")


@dataclass(frozen=True)
class RankMappingSuggestion:
    source_text: str
    suggested_rank_code: str | None


@dataclass(frozen=True)
class LegacyImportPreview:
    total: int
    grading_result: int
    auxiliary_note: int
    did_not_attend: int
    unresolved_current_rank: int
    unresolved_testing_for_rank: int
    unresolved_outcome: int
    warnings: list[str]
    rank_suggestions: list[RankMappingSuggestion]


def _distinct_rank_texts(rows: list[CanonicalLegacyRow]) -> list[str]:
    """Distinct source rank strings across the whole batch, not per-row -
    the admin reviews each value once, however many rows share it."""
    seen_lower: set[str] = set()
    distinct: list[str] = []
    for row in rows:
        for text in (row.source_current_rank_text, row.source_testing_for_rank_text):
            cleaned = text.strip()
            if not cleaned or cleaned.lower() in seen_lower:
                continue
            seen_lower.add(cleaned.lower())
            distinct.append(cleaned)
    return sorted(distinct, key=str.lower)


def _normalise_rank_mappings(
    rank_mappings: dict[str, str | None] | None,
) -> dict[str, str]:
    """Lowercased source text -> chosen Rank code. A missing or null value
    both mean "leave unresolved" - import Decision 4 is that this never
    blocks a row, unlike the student roster importer's required rank."""
    if not rank_mappings:
        return {}
    return {
        text.strip().lower(): code
        for text, code in rank_mappings.items()
        if text.strip() and code
    }


def _rank_resolver(
    normalised_mappings: dict[str, str],
) -> Callable[[str], Rank | None]:
    """Source rank text -> the administrator's chosen active Rank, if any."""
    ranks_by_code = {
        rank.code: rank
        for rank in Rank.objects.filter(
            code__in=set(normalised_mappings.values()),
            active=True,
        )
    }

    def resolve(text: str) -> Rank | None:
        cleaned = text.strip()
        if not cleaned:
            return None
        return ranks_by_code.get(normalised_mappings.get(cleaned.lower(), ""))

    return resolve


def preview_legacy_grading_import(
    batch: ImportBatch,
    *,
    rank_mappings: dict[str, str | None] | None = None,
) -> LegacyImportPreview:
    parsed = _load_legacy_workbook(batch)
    rows = parsed.rows
    resolve = _rank_resolver(_normalise_rank_mappings(rank_mappings))

    def unresolved(text: str) -> bool:
        return bool(text.strip()) and resolve(text) is None

    unresolved_current = sum(
        1 for row in rows if unresolved(row.source_current_rank_text)
    )
    unresolved_testing = sum(
        1 for row in rows if unresolved(row.source_testing_for_rank_text)
    )
    unresolved_outcome = sum(
        1
        for row in rows
        if row.record_kind == LegacyRecordKind.GRADING_RESULT
        and row.source_outcome_text.strip()
        and row.outcome is None
    )

    suggestions = []
    for text in _distinct_rank_texts(rows):
        suggested = _resolve_rank(text)
        suggestions.append(
            RankMappingSuggestion(
                source_text=text,
                suggested_rank_code=suggested.code if suggested else None,
            ),
        )

    return LegacyImportPreview(
        total=len(rows),
        grading_result=sum(
            1 for r in rows if r.record_kind == LegacyRecordKind.GRADING_RESULT
        ),
        auxiliary_note=sum(
            1 for r in rows if r.record_kind == LegacyRecordKind.AUXILIARY_NOTE
        ),
        did_not_attend=sum(
            1 for r in rows if r.record_kind == LegacyRecordKind.DID_NOT_ATTEND
        ),
        unresolved_current_rank=unresolved_current,
        unresolved_testing_for_rank=unresolved_testing,
        unresolved_outcome=unresolved_outcome,
        warnings=parsed.warnings,
        rank_suggestions=suggestions,
    )


@transaction.atomic
def commit_legacy_grading_import(
    batch: ImportBatch,
    *,
    actor: User,
    rank_mappings: dict[str, str | None] | None = None,
) -> ImportBatch:
    locked = _lock_uncommitted(batch, "committed again")

    # Never trusts a stale frontend preview - re-parses the source file and
    # re-resolves every rank mapping right now.
    rows = _load_legacy_workbook(locked).rows
    normalised_mappings = _normalise_rank_mappings(rank_mappings)
    resolve = _rank_resolver(normalised_mappings)

    counts: dict[str, int] = {
        LegacyRecordKind.GRADING_RESULT: 0,
        LegacyRecordKind.AUXILIARY_NOTE: 0,
        LegacyRecordKind.DID_NOT_ATTEND: 0,
    }
    unresolved_current = 0
    unresolved_testing = 0

    for row in rows:
        current_rank = resolve(row.source_current_rank_text)
        testing_for_rank = resolve(row.source_testing_for_rank_text)
        create_legacy_grading_record(
            source_batch=locked,
            record_kind=row.record_kind,
            source_sheet=row.source_sheet,
            source_section=row.source_section,
            source_locator=row.source_locator,
            cycle_year=row.cycle_year,
            cycle_month=row.cycle_month,
            source_name=row.source_name,
            source_current_rank_text=row.source_current_rank_text,
            current_rank=current_rank,
            source_testing_for_rank_text=row.source_testing_for_rank_text,
            testing_for_rank=testing_for_rank,
            source_outcome_text=row.source_outcome_text,
            outcome=row.outcome,
            attendance_status=row.attendance_status,
            comments=row.comments,
            admin_note=row.admin_note,
        )
        counts[row.record_kind] = counts.get(row.record_kind, 0) + 1
        if row.source_current_rank_text.strip() and current_rank is None:
            unresolved_current += 1
        if row.source_testing_for_rank_text.strip() and testing_for_rank is None:
            unresolved_testing += 1

    return _mark_committed(
        locked,
        actor=actor,
        summary={
            "total": len(rows),
            "grading_result": counts[LegacyRecordKind.GRADING_RESULT],
            "auxiliary_note": counts[LegacyRecordKind.AUXILIARY_NOTE],
            "did_not_attend": counts[LegacyRecordKind.DID_NOT_ATTEND],
            "unresolved_current_rank": unresolved_current,
            "unresolved_testing_for_rank": unresolved_testing,
        },
        configuration={"rank_mappings": normalised_mappings},
        record_count=len(rows),
        what="historical record(s)",
    )


__all__ = [
    "STUDENT_REQUIRED_TARGET_FIELDS",
    "CreateImportBatchResult",
    "LegacyImportPreview",
    "RankMappingSuggestion",
    "StudentImportPreview",
    "StudentImportRowOutcome",
    "StudentImportRowResult",
    "cancel_import_batch",
    "commit_legacy_grading_import",
    "commit_student_import",
    "create_import_batch",
    "expire_import_batch",
    "preview_legacy_grading_import",
    "preview_student_import",
    "remove_orphaned_uploads",
]
