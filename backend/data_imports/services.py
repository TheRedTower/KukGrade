"""Import batch lifecycle, stored rows, and preview/commit for both kinds.

A file is read once, at upload, into `ImportRow`s; every later step - matching
columns, checking, fixing a row, leaving one out, finishing - works on those
stored rows under the batch's lock, never on a fresh parse (decision log,
2026-10-20 import overhaul). Finishing still re-checks every row against the
database as it is at that moment, so nothing a stale screen showed is trusted.

Every created `Student` goes through `students.services.create_students` -
the hand-created student's rules and `STUDENT_CREATED` event, for many at
once - so a bulk importer never bypasses the domain-service layer.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from functools import partial
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, models, transaction
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
    EXTRA_LABEL_MAX_LENGTH,
    STUDENT_REQUIRED_TARGET_FIELDS,
    STUDENT_TARGET_FIELDS,
    suggest_column_mapping,
)
from data_imports.models import COMMITTED_ROWS_KEPT_FOR, ImportBatch, ImportRow
from data_imports.parsers import (
    TabularData,
    UnsupportedImportFileError,
    file_suffix,
    load_tabular_dataset,
)
from data_imports.storage import import_upload_storage
from gradings.legacy_services import (
    create_legacy_grading_records,
    void_legacy_records_from,
)
from gradings.models import LegacyGradingRecord, LegacyRecordKind
from ranks.matching import active_rank_lookup, suggest_rank
from ranks.models import Rank
from students import wksa_ids
from students.models import PreviousWksaId, RetiredWksaId, Student
from students.services import NewStudent, create_students

logger = logging.getLogger(__name__)

_ALLOWED_EXTENSIONS: dict[str, frozenset[str]] = {
    ImportBatch.Kind.STUDENT_ROSTER: frozenset({"xlsx", "csv"}),
    ImportBatch.Kind.LEGACY_GRADINGS: frozenset({"xlsx"}),
}


# One set of row outcomes for checking and storing alike.
StudentImportRowOutcome = ImportRow.Outcome


class ImportStep(models.TextChoices):
    """Where an import is up to, so a screen can resume it."""

    MATCH_COLUMNS = "MATCH_COLUMNS", "Match columns"
    REVIEW = "REVIEW", "Review rows"
    CLOSED = "CLOSED", "Finished"


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
    sheet: str | None = None,
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
                    f"KukGrade cannot read .{suffix or '?'} files for this import. "
                    f"Use {' or '.join(sorted(allowed))}.",
                ],
            },
        )

    # The declared size is checked before reading and the read is capped
    # too, so a wrong declared size cannot make it read past the limit.
    limit = settings.IMPORT_UPLOAD_MAX_BYTES
    too_large = DjangoValidationError(
        {"file": [f"The file is larger than the {limit / (1024 * 1024):g} MB limit."]},
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
    if sheet and (kind != ImportBatch.Kind.STUDENT_ROSTER or suffix != "xlsx"):
        raise DjangoValidationError(
            {"sheet": ["Only a roster workbook (.xlsx) has sheets to choose from."]},
        )
    if kind == ImportBatch.Kind.STUDENT_ROSTER:
        try:
            dataset = load_tabular_dataset(
                content=content,
                filename=filename,
                sheet=sheet or None,
            )
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
        configuration_json={
            "detected_headers": detected_headers,
            **(
                {"sheet": dataset.sheet, "sheet_names": list(dataset.sheet_names)}
                if kind == ImportBatch.Kind.STUDENT_ROSTER
                else {}
            ),
        },
    )
    if kind == ImportBatch.Kind.STUDENT_ROSTER:
        _store_roster_rows(batch, dataset)
    else:
        _store_legacy_rows(batch, parsed)
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


# --- stored rows -----------------------------------------------------------

_ROWS_STORED = "rows_stored"


def _jsonable(value: Any) -> Any:
    """A cell as JSON keeps it: a date as its ISO day, which _coerce_date reads."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date | time):
        return value.isoformat()
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _store_roster_rows(batch: ImportBatch, dataset: TabularData) -> None:
    ImportRow.objects.bulk_create(
        [
            ImportRow(
                batch=batch,
                row_number=row_number,
                source_locator=f"R{row_number}",
                raw={header: _jsonable(value) for header, value in cells.items()},
            )
            for row_number, cells in dataset.rows
        ],
        batch_size=500,
    )
    _mark_rows_stored(batch)


def _store_legacy_rows(batch: ImportBatch, parsed: WorkbookParseResult) -> None:
    ImportRow.objects.bulk_create(
        [
            ImportRow(
                batch=batch,
                row_number=index,
                source_locator=row.source_locator,
                raw={name: _jsonable(value) for name, value in asdict(row).items()},
                outcome=ImportRow.Outcome.READY,
                values=_legacy_values(row),
                search_text=_search_text(_legacy_values(row)),
            )
            for index, row in enumerate(parsed.rows, start=1)
        ],
        batch_size=500,
    )
    batch.configuration_json["warnings"] = list(parsed.warnings)
    _mark_rows_stored(batch)


def _mark_rows_stored(batch: ImportBatch) -> None:
    batch.configuration_json[_ROWS_STORED] = True
    batch.save(update_fields=["configuration_json", "updated_at"])


def _ensure_rows_stored(locked: ImportBatch) -> None:
    """Rows for an open import uploaded before rows were stored, read once now."""
    if locked.configuration_json.get(_ROWS_STORED):
        return
    if locked.kind == ImportBatch.Kind.STUDENT_ROSTER:
        dataset = _load_batch_dataset(locked)
        locked.configuration_json.setdefault("detected_headers", dataset.headers)
        locked.configuration_json.setdefault("sheet", dataset.sheet)
        locked.configuration_json.setdefault("sheet_names", list(dataset.sheet_names))
        _store_roster_rows(locked, dataset)
    else:
        _store_legacy_rows(locked, _load_legacy_workbook(locked))


def _search_text(values: dict[str, str]) -> str:
    return " ".join(value for value in values.values() if value).lower()


def _locked_row(locked: ImportBatch, row_number: int) -> ImportRow:
    row = locked.rows.filter(row_number=row_number).first()
    if row is None:
        raise DjangoValidationError({"row": ["This import has no such row."]})
    return row


ROW_COUNT_NAMES: tuple[str, ...] = (
    "total",
    "ready",
    "review_required",
    "skip_existing",
    "excluded",
)


def with_row_counts(
    batches: models.QuerySet[ImportBatch],
) -> models.QuerySet[ImportBatch]:
    """Imports annotated with `rows_<name>` for each of ROW_COUNT_NAMES."""

    def outcome(value: str) -> models.Count:
        return models.Count("rows", filter=models.Q(rows__outcome=value))

    return batches.annotate(
        row_counts_annotated=models.Value(True),
        rows_total=models.Count("rows"),
        rows_ready=outcome(ImportRow.Outcome.READY),
        rows_review_required=outcome(ImportRow.Outcome.REVIEW_REQUIRED),
        rows_skip_existing=outcome(ImportRow.Outcome.SKIP_EXISTING),
        rows_excluded=outcome(ImportRow.Outcome.EXCLUDED),
    )


def row_counts(batch: ImportBatch) -> dict[str, int]:
    """How many of an import's rows have each outcome."""
    counts = dict(
        batch.rows.values_list("outcome").annotate(models.Count("pk")).order_by(),
    )
    return {
        "total": sum(counts.values()),
        "ready": counts.get(ImportRow.Outcome.READY, 0),
        "review_required": counts.get(ImportRow.Outcome.REVIEW_REQUIRED, 0),
        "skip_existing": counts.get(ImportRow.Outcome.SKIP_EXISTING, 0),
        "excluded": counts.get(ImportRow.Outcome.EXCLUDED, 0),
    }


def next_step(batch: ImportBatch) -> str:
    if batch.status != ImportBatch.Status.UPLOADED:
        return ImportStep.CLOSED
    if (
        batch.kind == ImportBatch.Kind.STUDENT_ROSTER
        and not batch.configuration_json.get(
            "column_mapping",
        )
    ):
        return ImportStep.MATCH_COLUMNS
    return ImportStep.REVIEW


def _drop_rows(locked: ImportBatch) -> None:
    # Rows are the file's content: they go with it.
    locked.rows.all().delete()


def prune_finished_import_rows(*, now: datetime | None = None) -> int:
    """Delete the rows of imports finished longer ago than they are kept."""
    cutoff = (now or timezone.now()) - COMMITTED_ROWS_KEPT_FOR
    deleted, _ = ImportRow.objects.filter(
        batch__status=ImportBatch.Status.COMMITTED,
        batch__committed_at__lt=cutoff,
    ).delete()
    return deleted


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
            {
                "batch": [
                    f"This import is already "
                    f"{ImportBatch.Status(locked.status).label.lower()} and cannot "
                    f"be {verb}.",
                ],
            },
        )
    return locked


_SOURCE_FILE_GONE = (
    "This import's file is no longer available: it was already imported, "
    "cancelled or expired. Upload the file again."
)


def _read_source_file(batch: ImportBatch) -> bytes:
    # Read once at upload, and again only to store an older import's rows or
    # to read another sheet - by then the file may have gone with its batch.
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
        f"Import #{locked.pk} ({locked.get_kind_display()}) finished: "
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
    _drop_rows(locked)
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
        f"Import #{locked.pk} ({locked.get_kind_display()}) cancelled.",
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
    _drop_rows(locked)
    locked.status = ImportBatch.Status.EXPIRED
    locked.save(update_fields=["status", "source_file", "updated_at"])
    hours = max_age // timedelta(hours=1)
    record(
        AuditAction.IMPORT_BATCH_EXPIRED,
        locked,
        f"Import #{locked.pk} ({locked.get_kind_display()}) expired after "
        f"{hours} hours.",
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


def _load_batch_dataset(batch: ImportBatch, sheet: str | None = None) -> TabularData:
    content = _read_source_file(batch)
    try:
        return load_tabular_dataset(
            content=content,
            filename=batch.original_filename,
            sheet=sheet or batch.configuration_json.get("sheet") or None,
        )
    except UnsupportedImportFileError as exc:
        raise DjangoValidationError({"batch": [str(exc)]}) from exc


@transaction.atomic
def void_import_records(
    batch: ImportBatch,
    *,
    reason: str,
    actor: User,
) -> int:
    """Void every record a finished historical import created - the undo for
    the wrong file imported, since a record is never deleted (import
    Decision 16). Each is voided as one alone would be, with its own event;
    records already voided are left as they are. Returns how many."""
    if (
        batch.kind != ImportBatch.Kind.LEGACY_GRADINGS
        or batch.status != ImportBatch.Status.COMMITTED
    ):
        raise DjangoValidationError(
            {
                "batch": [
                    "Only a finished historical gradings import has records to void."
                ]
            },
        )
    return void_legacy_records_from(batch.pk, reason=reason, actor=actor)


@transaction.atomic
def choose_import_sheet(batch: ImportBatch, *, sheet: str) -> ImportBatch:
    """Read a roster from another sheet of its workbook.

    The rows are read again from that sheet, and the column matches, whole-
    file values, kept columns and fixes made for the old sheet go: they were
    about other columns.
    """
    locked = _lock_uncommitted(batch, "changed")
    _require_roster(locked)
    if sheet not in locked.configuration_json.get("sheet_names", []):
        raise DjangoValidationError(
            {"sheet": [f"The workbook has no sheet named {sheet!r}."]},
        )
    try:
        dataset = _load_batch_dataset(locked, sheet)
    except DjangoValidationError as exc:
        raise DjangoValidationError({"sheet": exc.messages}) from exc
    _drop_rows(locked)
    for stale in ("column_mapping", "defaults", "extra_columns"):
        locked.configuration_json.pop(stale, None)
    locked.configuration_json["sheet"] = dataset.sheet
    locked.configuration_json["detected_headers"] = dataset.headers
    _store_roster_rows(locked, dataset)
    return locked


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
    excluded: int = 0


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


def _map_row(
    raw_row: dict[str, Any],
    column_mapping: dict[str, str],
    defaults: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A row's value for each KukGrade field: its own cell, or the whole-file
    value where it has none (no column, or a blank cell)."""
    values: dict[str, Any] = {}
    for target_field in STUDENT_TARGET_FIELDS:
        source_header = column_mapping.get(target_field)
        value = raw_row.get(source_header) if source_header else None
        if (value is None or str(value).strip() == "") and defaults:
            value = defaults.get(target_field, value)
        values[target_field] = value
    return values


def extra_values(raw_row: dict[str, Any], extra_columns: list[str]) -> dict[str, str]:
    """The kept columns' values in this row, by header; blanks left out."""
    extra: dict[str, str] = {}
    for header in extra_columns:
        value = raw_row.get(header)
        text = "" if value is None else str(value).strip()
        if text:
            extra[header] = text
    return extra


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
    rank: Rank | None,
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
    # The roster check against previous IDs is one query for the whole file.
    candidate.previous_ids_checked = True
    # Not validated as a field - it was just read from the catalogue - but
    # clean() needs it: a black belt rank requires a black belt ID.
    if rank is not None:
        candidate.current_rank = rank
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


def _row_wksa_id(values: dict[str, Any], correction: dict[str, str]) -> str:
    # Tidied as Student.clean() tidies it, so a file's "a-20819" is found as
    # the existing A-20819 and counted once.
    return wksa_ids.normalise(correction.get("wksa_id", values.get("wksa_id")))


def _classify_student_row(
    row_number: int,
    values: dict[str, Any],
    correction: dict[str, str],
    seen_wksa_ids: set[str],
    ranks: dict[str, Rank],
    existing_wksa_ids: set[str],
    replaced_wksa_ids: dict[str, str],
    retired_wksa_ids: set[str],
) -> StudentImportRowResult:
    issues: list[str] = []

    wksa_id = _row_wksa_id(values, correction)
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

    # The club's own fixed spellings are the rank they spell ("White Belt"
    # is White, "DBN" Dahn Bo - ranks.matching); a rank the file marks as
    # doubtful ("Red stripe?") is for the importer to confirm, never taken.
    rank, doubtful = suggest_rank(rank_text, ranks) if rank_text else (None, False)
    if not rank_text:
        issues.append("Current rank is required.")
    elif doubtful:
        issues.append(
            f"Rank {rank_text!r} is marked as uncertain in the file: choose the "
            "rank it should be.",
        )
        rank = None
    elif rank is None:
        issues.append(f"Rank {rank_text!r} is not a rank KukGrade recognises.")

    if status_text not in Student.Status.values:
        issues.append(f"Status {status_text!r} is not recognised.")
        status_text = Student.Status.ACTIVE

    issues.extend(
        _student_model_issues(
            wksa_id=wksa_id,
            first_name=first_name,
            last_name=last_name,
            date_of_birth=parsed_dob,
            rank=rank,
        ),
    )

    if wksa_id in retired_wksa_ids:
        issues.append(
            "This ID belonged to a student who was deleted. A number is never "
            "given to anyone else.",
        )
    if wksa_id and wksa_id in seen_wksa_ids:
        issues.append("Duplicate WKSA ID within this file.")
    if wksa_id:
        seen_wksa_ids.add(wksa_id)

    if wksa_id in replaced_wksa_ids:
        # An old student ID is still its student's: a number is never reused.
        issues.append(
            f"This ID belongs to a student who now holds {replaced_wksa_ids[wksa_id]}.",
        )
        outcome = StudentImportRowOutcome.SKIP_EXISTING
    elif wksa_id in existing_wksa_ids:
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


def _classify_roster(locked: ImportBatch) -> StudentImportPreview:
    """Check every stored row of a roster against its mapping and the database.

    Rows are checked together, not one by one: a WKSA ID repeated in the file
    is only seen across rows, and the lookups are one query each for the
    whole file. Each row's result is stored on it.
    """
    column_mapping: dict[str, str] = locked.configuration_json.get(
        "column_mapping",
        {},
    )
    defaults: dict[str, str] = locked.configuration_json.get("defaults", {})
    stored_rows = list(locked.rows.order_by("row_number"))
    mapped = [
        (stored, _map_row(stored.raw, column_mapping, defaults), stored.correction)
        for stored in stored_rows
    ]
    ranks = active_rank_lookup()
    wanted = {
        _row_wksa_id(values, correction)
        for stored, values, correction in mapped
        if not stored.excluded
    } - {""}
    existing_wksa_ids = set(
        Student.objects.filter(wksa_id__in=wanted).values_list("wksa_id", flat=True),
    )
    # Old student IDs that a black belt ID replaced, by the ID now held.
    replaced_wksa_ids = dict(
        PreviousWksaId.objects.filter(wksa_id__in=wanted).values_list(
            "wksa_id",
            "student__wksa_id",
        ),
    )
    retired_wksa_ids = set(
        RetiredWksaId.objects.filter(wksa_id__in=wanted).values_list(
            "wksa_id",
            flat=True,
        ),
    )
    seen_wksa_ids: set[str] = set()
    results: list[StudentImportRowResult] = []
    for stored, values, correction in mapped:
        if stored.excluded:
            result = _excluded_roster_row(stored, values, correction)
        else:
            result = _classify_student_row(
                stored.row_number,
                values,
                correction,
                seen_wksa_ids,
                ranks,
                existing_wksa_ids,
                replaced_wksa_ids,
                retired_wksa_ids,
            )
        shown = _roster_values(result)
        stored.outcome = result.outcome
        stored.issues = list(result.issues)
        stored.values = shown
        stored.search_text = _search_text(shown)
        results.append(result)
    ImportRow.objects.bulk_update(
        stored_rows,
        ["outcome", "issues", "values", "search_text"],
        batch_size=500,
    )

    def count(outcome: str) -> int:
        return sum(1 for row in results if row.outcome == outcome)

    return StudentImportPreview(
        total=len(results),
        ready=count(StudentImportRowOutcome.READY),
        review_required=count(StudentImportRowOutcome.REVIEW_REQUIRED),
        skip_existing=count(StudentImportRowOutcome.SKIP_EXISTING),
        excluded=count(StudentImportRowOutcome.EXCLUDED),
        rows=results,
    )


def _excluded_roster_row(
    stored: ImportRow,
    values: dict[str, Any],
    correction: dict[str, str],
) -> StudentImportRowResult:
    def text(name: str) -> str:
        value = correction.get(name, values.get(name))
        return "" if value is None else str(value).strip()

    return StudentImportRowResult(
        row_number=stored.row_number,
        outcome=StudentImportRowOutcome.EXCLUDED,
        wksa_id=text("wksa_id"),
        first_name=text("first_name"),
        last_name=text("last_name"),
        date_of_birth_display=text("date_of_birth"),
        date_of_birth=None,
        current_rank_text=text("current_rank"),
        current_rank_id=None,
        current_rank_code=None,
        status=text("status"),
    )


def _roster_values(result: StudentImportRowResult) -> dict[str, str]:
    return {
        "wksa_id": result.wksa_id,
        "first_name": result.first_name,
        "last_name": result.last_name,
        "date_of_birth": result.date_of_birth_display,
        "current_rank": result.current_rank_text,
        "status": result.status,
    }


_MAPPING_FIRST = "Match the file's columns to KukGrade's fields first."


def _require_mapping(locked: ImportBatch) -> None:
    if not locked.configuration_json.get("column_mapping"):
        raise DjangoValidationError({"column_mapping": [_MAPPING_FIRST]})


def _require_roster(locked: ImportBatch) -> None:
    if locked.kind != ImportBatch.Kind.STUDENT_ROSTER:
        raise DjangoValidationError(
            {"batch": ["Only a student roster's columns are matched."]},
        )


def _save_column_mapping(
    locked: ImportBatch,
    column_mapping: dict[str, str],
    *,
    defaults: dict[str, str] | None = None,
    extra_columns: list[str] | None = None,
) -> None:
    """Store how the file maps onto KukGrade: a column per field, whole-file
    values, and the columns kept as extra information. Each named column must
    be one of the file's own, and a column is used once."""
    chosen = {field: header for field, header in column_mapping.items() if header}
    headers = set(locked.configuration_json.get("detected_headers", []))
    errors: dict[str, list[str]] = {}
    missing = sorted(set(chosen.values()) - headers)
    used = list(chosen.values())
    repeated = sorted({header for header in used if used.count(header) > 1})
    if missing:
        errors["column_mapping"] = [
            f"The file has no column named {', '.join(map(repr, missing))}.",
        ]
    elif repeated:
        errors["column_mapping"] = [
            f"The column {', '.join(map(repr, repeated))} is matched to more than "
            "one KukGrade field; match each column once.",
        ]
    kept = list(dict.fromkeys(extra_columns or []))
    if set(kept) - headers:
        errors["extra_columns"] = [
            "The file has no column named "
            f"{', '.join(map(repr, sorted(set(kept) - headers)))}.",
        ]
    elif set(kept) & set(chosen.values()):
        errors["extra_columns"] = [
            "A column matched to a KukGrade field cannot also be kept as extra "
            "information.",
        ]
    elif any(len(header) > EXTRA_LABEL_MAX_LENGTH for header in kept):
        errors["extra_columns"] = [
            f"A column kept as extra information needs a heading of at most "
            f"{EXTRA_LABEL_MAX_LENGTH} characters.",
        ]
    cleaned_defaults = {
        field: value.strip()
        for field, value in (defaults or {}).items()
        if value.strip()
    }
    if "status" in cleaned_defaults:
        cleaned_defaults["status"] = cleaned_defaults["status"].upper()
    rank_default = cleaned_defaults.get("current_rank")
    rank_default_found, rank_default_doubtful = (
        suggest_rank(rank_default, active_rank_lookup())
        if rank_default
        else (None, False)
    )
    if rank_default and (rank_default_found is None or rank_default_doubtful):
        errors["defaults"] = [f"{rank_default!r} is not a rank KukGrade recognises."]
    if errors:
        raise DjangoValidationError(errors)
    locked.configuration_json["column_mapping"] = chosen
    locked.configuration_json["defaults"] = cleaned_defaults
    locked.configuration_json["extra_columns"] = kept
    locked.save(update_fields=["configuration_json", "updated_at"])


def _replace_corrections(
    locked: ImportBatch,
    corrections: dict[str, dict[str, str]],
) -> None:
    stored_rows = list(locked.rows.all())
    for stored in stored_rows:
        stored.correction = dict(corrections.get(str(stored.row_number), {}))
    ImportRow.objects.bulk_update(stored_rows, ["correction"], batch_size=500)


@transaction.atomic
def save_import_mapping(
    batch: ImportBatch,
    *,
    column_mapping: dict[str, str],
    defaults: dict[str, str] | None = None,
    extra_columns: list[str] | None = None,
) -> ImportBatch:
    """Match a roster's columns to KukGrade's fields, and check every row.

    `defaults` gives a whole-file value for a field the file lacks or leaves
    blank (STUDENT_WHOLE_FILE_FIELDS); `extra_columns` are the columns kept
    as each student's extra information.
    """
    locked = _lock_uncommitted(batch, "changed")
    _require_roster(locked)
    _ensure_rows_stored(locked)
    _save_column_mapping(
        locked,
        column_mapping,
        defaults=defaults,
        extra_columns=extra_columns,
    )
    _classify_roster(locked)
    return locked


@transaction.atomic
def correct_import_row(
    batch: ImportBatch,
    *,
    row_number: int,
    changes: dict[str, str | None],
) -> ImportRow:
    """Fix a roster row's values; a null value goes back to what the file says.

    Every row is checked again, not only this one: fixing a WKSA ID can make
    or end a repeat elsewhere in the file.
    """
    locked = _lock_uncommitted(batch, "changed")
    _require_roster(locked)
    _ensure_rows_stored(locked)
    _require_mapping(locked)
    row = _locked_row(locked, row_number)
    correction = dict(row.correction)
    for name, value in changes.items():
        if value is None:
            correction.pop(name, None)
        else:
            correction[name] = value
    row.correction = correction
    row.save(update_fields=["correction"])
    _classify_roster(locked)
    row.refresh_from_db()
    return row


@transaction.atomic
def set_import_row_excluded(
    batch: ImportBatch,
    *,
    row_number: int,
    excluded: bool,
) -> ImportRow:
    """Leave a row out of the import, or bring it back."""
    locked = _lock_uncommitted(batch, "changed")
    _ensure_rows_stored(locked)
    row = _locked_row(locked, row_number)
    row.excluded = excluded
    if excluded:
        row.outcome = ImportRow.Outcome.EXCLUDED
    elif locked.kind == ImportBatch.Kind.STUDENT_ROSTER:
        # Until the check below, which a roster with its columns matched gets.
        row.outcome = ImportRow.Outcome.REVIEW_REQUIRED
    else:
        # A historical record is never held back by what it lacks (import
        # Decision 5), so one brought back is ready.
        row.outcome = ImportRow.Outcome.READY
    row.save(update_fields=["excluded", "outcome"])
    if locked.kind == ImportBatch.Kind.STUDENT_ROSTER and locked.configuration_json.get(
        "column_mapping",
    ):
        # Every row again: a row left out, or back, can end or make a repeat.
        _classify_roster(locked)
    row.refresh_from_db()
    return row


@transaction.atomic
def preview_student_import(
    batch: ImportBatch,
    *,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> StudentImportPreview:
    """Save the mapping (and, when given, every row's corrections) and check.

    The single-request check the current roster screen uses: corrections
    given here replace the stored ones, as that screen sends them all.
    """
    locked = _lock_uncommitted(batch, "checked")
    _require_roster(locked)
    _ensure_rows_stored(locked)
    _save_column_mapping(
        locked,
        column_mapping,
        defaults=locked.configuration_json.get("defaults"),
        extra_columns=locked.configuration_json.get("extra_columns"),
    )
    if corrections is not None:
        _replace_corrections(locked, corrections)
    return _classify_roster(locked)


def _row_no_longer_valid(
    row: StudentImportRowResult,
    reason: str,
) -> DjangoValidationError:
    return DjangoValidationError(
        {
            "rows": [
                f"Row {row.row_number} ({row.wksa_id}) is no longer valid: "
                f"{reason} Nothing was imported - check the file again.",
            ],
        },
    )


@transaction.atomic
def commit_student_import(
    batch: ImportBatch,
    *,
    actor: User,
    column_mapping: dict[str, str] | None = None,
    corrections: dict[str, dict[str, str]] | None = None,
) -> ImportBatch:
    """Create a student for every ready row, all or nothing.

    The mapping and corrections are the stored ones unless given here (as the
    current roster screen sends them). Never trusts what a screen last
    showed - every row is checked again now, under the batch's lock.
    """
    locked = _lock_uncommitted(batch, "imported again")
    _require_roster(locked)
    _ensure_rows_stored(locked)
    if column_mapping is not None:
        _save_column_mapping(
            locked,
            column_mapping,
            defaults=locked.configuration_json.get("defaults"),
            extra_columns=locked.configuration_json.get("extra_columns"),
        )
    if corrections is not None:
        _replace_corrections(locked, corrections)
    _require_mapping(locked)
    preview = _classify_roster(locked)
    extra_columns: list[str] = locked.configuration_json.get("extra_columns", [])
    raw_by_row = dict(locked.rows.values_list("row_number", "raw"))
    ready_rows = [
        row for row in preview.rows if row.outcome == StudentImportRowOutcome.READY
    ]

    active_ranks = {rank.pk: rank for rank in Rank.objects.filter(active=True)}
    new_students: list[NewStudent] = []
    for row in ready_rows:
        # A READY row always has both resolved by _classify_student_row; the
        # None checks narrow the types and catch a rank deactivated since.
        rank = active_ranks.get(row.current_rank_id) if row.current_rank_id else None
        if rank is None or row.date_of_birth is None:
            raise _row_no_longer_valid(row, "its rank is no longer active.")
        new_students.append(
            NewStudent(
                wksa_id=row.wksa_id,
                first_name=row.first_name,
                last_name=row.last_name,
                date_of_birth=row.date_of_birth,
                current_rank=rank,
                status=row.status,
                extra_information=tuple(
                    extra_values(raw_by_row[row.row_number], extra_columns).items(),
                ),
            ),
        )
    # All at once, all or nothing (the recorded commit-semantics deviation).
    # Checked moments ago, so a refusal here is a concurrent change - such as
    # the same WKSA ID created elsewhere - and the whole batch rolls back
    # rather than silently skipping the row.
    try:
        created = create_students(
            new_students,
            actor=actor,
            source_import=locked.pk,
        )
    except DjangoValidationError as exc:
        by_id = {row.wksa_id: row for row in ready_rows}
        first_id, messages = next(iter(exc.message_dict.items()))
        refused = by_id.get(first_id, ready_rows[0])
        raise _row_no_longer_valid(refused, " ".join(messages)) from exc
    except IntegrityError as exc:
        raise DjangoValidationError(
            {
                "rows": [
                    "A row conflicts with a change saved since the check. "
                    "Nothing was imported - check the file again.",
                ],
            },
        ) from exc
    created_ids = {
        row.row_number: student.pk
        for row, student in zip(ready_rows, created, strict=True)
    }

    _record_created(locked, created_ids)
    return _mark_committed(
        locked,
        actor=actor,
        summary={
            "total": preview.total,
            "created": len(created_ids),
            "skipped_existing": preview.skip_existing,
            "review_required": preview.review_required,
            "excluded": preview.excluded,
        },
        configuration=locked.configuration_json,
        record_count=len(created_ids),
        what="student(s)",
    )


def _record_created(locked: ImportBatch, created_ids: dict[int, int]) -> None:
    """Note on each row what it became, for the results page."""
    stored_rows = list(locked.rows.filter(row_number__in=created_ids))
    for stored in stored_rows:
        stored.created_id = str(created_ids[stored.row_number])
    ImportRow.objects.bulk_update(stored_rows, ["created_id"], batch_size=500)


# --- historical grading workbook preview/commit -----------------------------


def _parse_legacy_workbook(content: bytes, *, error_key: str) -> WorkbookParseResult:
    try:
        parsed = parse_ksw_colchester_workbook(content)
    except WorkbookStructureError as exc:
        raise DjangoValidationError({error_key: [str(exc)]}) from exc
    _check_legacy_field_lengths(parsed.rows, error_key=error_key)
    return parsed


def _check_legacy_field_lengths(
    rows: list[CanonicalLegacyRow],
    *,
    error_key: str,
) -> None:
    """Refuse a cell longer than its record field, naming where it is.

    Source text is kept verbatim (import Decision 7), so it is never
    truncated; committing it would fail the whole batch with an error that
    names no row, after a preview that looked clean.
    """
    problems: list[str] = []
    for row in rows:
        for name, value in vars(row).items():
            if not isinstance(value, str):
                continue
            model_field = LegacyGradingRecord._meta.get_field(name)
            limit = getattr(model_field, "max_length", None)
            if limit is not None and len(value) > limit:
                problems.append(
                    f"{row.source_locator}: {name.replace('_', ' ')} is "
                    f"{len(value)} characters; at most {limit} can be kept.",
                )
    if problems:
        raise DjangoValidationError({error_key: problems})


def _load_legacy_workbook(batch: ImportBatch) -> WorkbookParseResult:
    return _parse_legacy_workbook(_read_source_file(batch), error_key="batch")


def _legacy_values(row: CanonicalLegacyRow) -> dict[str, str]:
    """A historical row's values, as the review table shows them."""
    return {
        "name": row.source_name,
        "period": f"{row.cycle_month:02d}/{row.cycle_year}",
        "current_rank": row.source_current_rank_text,
        "testing_for_rank": row.source_testing_for_rank_text,
        "outcome": row.source_outcome_text,
        "report": row.comments,
        # Where on the sheet: blank for the main table, else its side table
        # or the column a sheet note was in.
        "section": row.source_section,
        "note": row.admin_note,
    }


def _stored_legacy_rows(
    locked: ImportBatch,
    *,
    include_excluded: bool = False,
) -> list[tuple[ImportRow, CanonicalLegacyRow]]:
    stored = locked.rows.order_by("row_number")
    if not include_excluded:
        stored = stored.filter(excluded=False)
    return [(row, CanonicalLegacyRow(**row.raw)) for row in stored]


def _require_legacy(locked: ImportBatch) -> None:
    if locked.kind != ImportBatch.Kind.LEGACY_GRADINGS:
        raise DjangoValidationError(
            {"batch": ["This is not a historical gradings import."]},
        )


def _save_rank_mappings(
    locked: ImportBatch,
    rank_mappings: dict[str, str | None],
) -> dict[str, str]:
    normalised = _normalise_rank_mappings(rank_mappings)
    locked.configuration_json["rank_mappings"] = normalised
    locked.save(update_fields=["configuration_json", "updated_at"])
    return normalised


@dataclass(frozen=True)
class RankMappingSuggestion:
    source_text: str
    suggested_rank_code: str | None
    # The source marks its own doubt ("Red stripe?"): the rank it suggests is
    # what was written, not something known.
    doubtful: bool = False
    rows: int = 0


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
    excluded: int = 0


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


@transaction.atomic
def preview_legacy_grading_import(
    batch: ImportBatch,
    *,
    rank_mappings: dict[str, str | None] | None = None,
) -> LegacyImportPreview:
    """Save the rank choices (when given) and count what the import would do."""
    locked = _lock_uncommitted(batch, "checked")
    _require_legacy(locked)
    _ensure_rows_stored(locked)
    if rank_mappings is not None:
        _save_rank_mappings(locked, rank_mappings)
    rows = [row for _, row in _stored_legacy_rows(locked)]
    resolve = _rank_resolver(locked.configuration_json.get("rank_mappings", {}))

    def unresolved(text: str) -> bool:
        return bool(text.strip()) and resolve(text) is None

    suggestions = []
    ranks = active_rank_lookup()
    uses: dict[str, int] = {}
    for row in rows:
        for text in {
            row.source_current_rank_text.strip().lower(),
            row.source_testing_for_rank_text.strip().lower(),
        } - {""}:
            uses[text] = uses.get(text, 0) + 1
    for text in _distinct_rank_texts(rows):
        suggested, doubtful = suggest_rank(text, ranks)
        suggestions.append(
            RankMappingSuggestion(
                source_text=text,
                suggested_rank_code=suggested.code if suggested else None,
                doubtful=doubtful,
                rows=uses.get(text.lower(), 0),
            ),
        )

    def kind_count(kind: str) -> int:
        return sum(1 for row in rows if row.record_kind == kind)

    return LegacyImportPreview(
        total=len(rows),
        grading_result=kind_count(LegacyRecordKind.GRADING_RESULT),
        auxiliary_note=kind_count(LegacyRecordKind.AUXILIARY_NOTE),
        did_not_attend=kind_count(LegacyRecordKind.DID_NOT_ATTEND),
        unresolved_current_rank=sum(
            1 for row in rows if unresolved(row.source_current_rank_text)
        ),
        unresolved_testing_for_rank=sum(
            1 for row in rows if unresolved(row.source_testing_for_rank_text)
        ),
        unresolved_outcome=sum(
            1
            for row in rows
            if row.record_kind == LegacyRecordKind.GRADING_RESULT
            and row.source_outcome_text.strip()
            and row.outcome is None
        ),
        warnings=list(locked.configuration_json.get("warnings", [])),
        rank_suggestions=suggestions,
        excluded=locked.rows.filter(excluded=True).count(),
    )


@transaction.atomic
def commit_legacy_grading_import(
    batch: ImportBatch,
    *,
    actor: User,
    rank_mappings: dict[str, str | None] | None = None,
) -> ImportBatch:
    """Create a historical record for every row not left out, all or nothing.

    The rank choices are the stored ones unless given here. Each is resolved
    again now against the active ranks, so a screen's stale view is never
    trusted.
    """
    locked = _lock_uncommitted(batch, "imported again")
    _require_legacy(locked)
    _ensure_rows_stored(locked)
    if rank_mappings is not None:
        _save_rank_mappings(locked, rank_mappings)
    normalised_mappings: dict[str, str] = locked.configuration_json.get(
        "rank_mappings",
        {},
    )
    resolve = _rank_resolver(normalised_mappings)
    stored_rows = _stored_legacy_rows(locked)

    counts: dict[str, int] = {
        LegacyRecordKind.GRADING_RESULT: 0,
        LegacyRecordKind.AUXILIARY_NOTE: 0,
        LegacyRecordKind.DID_NOT_ATTEND: 0,
    }
    unresolved_current = 0
    unresolved_testing = 0
    fields: list[dict[str, Any]] = []
    for _stored, row in stored_rows:
        current_rank = resolve(row.source_current_rank_text)
        testing_for_rank = resolve(row.source_testing_for_rank_text)
        fields.append(
            {
                "record_kind": row.record_kind,
                "source_sheet": row.source_sheet,
                "source_section": row.source_section,
                "source_locator": row.source_locator,
                "cycle_year": row.cycle_year,
                "cycle_month": row.cycle_month,
                "source_name": row.source_name,
                "source_current_rank_text": row.source_current_rank_text,
                "current_rank": current_rank,
                "source_testing_for_rank_text": row.source_testing_for_rank_text,
                "testing_for_rank": testing_for_rank,
                "source_outcome_text": row.source_outcome_text,
                "outcome": row.outcome,
                "attendance_status": row.attendance_status,
                "comments": row.comments,
                "admin_note": row.admin_note,
            },
        )
        counts[row.record_kind] = counts.get(row.record_kind, 0) + 1
        if row.source_current_rank_text.strip() and current_rank is None:
            unresolved_current += 1
        if row.source_testing_for_rank_text.strip() and testing_for_rank is None:
            unresolved_testing += 1
    # One write for the whole workbook, all or nothing.
    created = create_legacy_grading_records(locked, fields)
    created_ids = {
        stored.row_number: record_.pk
        for (stored, _row), record_ in zip(stored_rows, created, strict=True)
    }

    _record_created(locked, created_ids)
    return _mark_committed(
        locked,
        actor=actor,
        summary={
            "total": len(stored_rows),
            "grading_result": counts[LegacyRecordKind.GRADING_RESULT],
            "auxiliary_note": counts[LegacyRecordKind.AUXILIARY_NOTE],
            "did_not_attend": counts[LegacyRecordKind.DID_NOT_ATTEND],
            "unresolved_current_rank": unresolved_current,
            "unresolved_testing_for_rank": unresolved_testing,
            "excluded": locked.rows.filter(excluded=True).count(),
        },
        configuration=locked.configuration_json,
        record_count=len(stored_rows),
        what="historical record(s)",
    )


__all__ = [
    "STUDENT_REQUIRED_TARGET_FIELDS",
    "CreateImportBatchResult",
    "ImportStep",
    "LegacyImportPreview",
    "RankMappingSuggestion",
    "StudentImportPreview",
    "StudentImportRowOutcome",
    "StudentImportRowResult",
    "cancel_import_batch",
    "commit_legacy_grading_import",
    "choose_import_sheet",
    "commit_student_import",
    "correct_import_row",
    "create_import_batch",
    "expire_import_batch",
    "extra_values",
    "next_step",
    "preview_legacy_grading_import",
    "preview_student_import",
    "prune_finished_import_rows",
    "remove_orphaned_uploads",
    "ROW_COUNT_NAMES",
    "row_counts",
    "save_import_mapping",
    "void_import_records",
    "set_import_row_excluded",
    "with_row_counts",
]
