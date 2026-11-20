"""Import batch lifecycle, stored rows, and preview/commit for both kinds.

A file is read once, at upload, into `ImportRow`s; every later step - matching
columns, checking, fixing a row, leaving one out, finishing - works on those
stored rows under the batch's lock, never on a fresh parse. Finishing still
re-checks every row against the database as it is at that moment, so nothing a
stale screen showed is trusted.

Every created `Student` goes through `students.services.create_students` -
the hand-created student's rules and `STUDENT_CREATED` event, for many at
once - so a bulk importer never bypasses the domain-service layer.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from functools import partial
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, connection, models, transaction
from django.utils import timezone

from accounts.models import User
from accounts.people import title_of
from audit.models import AuditAction
from audit.recording import record
from data_imports.ksw_adapter import (
    CanonicalLegacyRow,
    WorkbookParseResult,
    WorkbookStructureError,
    names_not_checked,
    parse_ksw_workbook,
    workbook_checks,
)
from data_imports.legacy_checks import (
    DECISIONS,
    CheckDecision,
    CheckKind,
    LegacyCheck,
    legacy_checks,
    outcome_reader,
    outcome_unread,
    rank_reader,
    with_outcomes_read,
)
from data_imports.mappings import (
    EXTRA_LABEL_MAX_LENGTH,
    STUDENT_FIELD_LABELS,
    STUDENT_OPTIONAL_FIELDS,
    STUDENT_TARGET_FIELDS,
    STUDENT_WHOLE_FILE_FIELDS,
)
from data_imports.models import (
    COMMITTED_ROWS_KEPT_FOR,
    ImportBatch,
    ImportConfiguration,
    ImportRow,
)
from data_imports.parsers import (
    CSV_SUFFIX,
    NO_SUCH_SHEET,
    WORKBOOK_SUFFIX,
    TabularData,
    UnsupportedImportFileError,
    cell_text,
    file_suffix,
    inspect_workbook_sheets,
    load_tabular_dataset,
)
from data_imports.storage import import_upload_storage
from gradings.legacy_services import (
    create_legacy_grading_records,
    void_legacy_records_from,
)
from gradings.models import (
    LegacyGradingRecord,
    LegacyOutcome,
    LegacyRecordKind,
    legacy_content_key,
)
from ranks.matching import active_rank_lookup, suggest_rank
from ranks.models import Rank
from students import wksa_ids
from students.models import PreviousWksaId, RetiredWksaId, Student
from students.services import NewStudent, create_students

logger = logging.getLogger(__name__)

# The file types each kind of import reads, in the order they are offered.
ALLOWED_SUFFIXES: dict[str, tuple[str, ...]] = {
    ImportBatch.Kind.STUDENT_ROSTER: (WORKBOOK_SUFFIX, CSV_SUFFIX),
    ImportBatch.Kind.LEGACY_GRADINGS: (WORKBOOK_SUFFIX,),
}

STALE_BATCH_AGE = timedelta(hours=24)

_DATE_FORMATS: tuple[str, ...] = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y")

_SOURCE_FILE_GONE = (
    "This import's file is no longer available: it was already imported, "
    "cancelled or expired. Upload the file again."
)
_MAPPING_FIRST = "Match the file's columns to KukGrade's fields first."
_NO_SUCH_COLUMN = "The file has no column named {columns}."
STATUS_NOT_RECOGNISED = "Status {status!r} is not recognised."
STUDENTS_FIRST = (
    "Import your students first: past gradings are linked to students, and "
    "KukGrade has none yet."
)

NOTHING_TO_IMPORT = (
    "Nothing to import: every record is already in KukGrade, left out, or on "
    "a sheet not chosen."
)


class ImportStep(models.TextChoices):
    """The steps every import runs through, in order."""

    CHOOSE_FILE = "CHOOSE_FILE", "Choose file"
    MATCH = "MATCH", "Match"
    REVIEW = "REVIEW", "Review"
    CONFIRM = "CONFIRM", "Confirm"
    RESULTS = "RESULTS", "Results"


# Where a review can stand (review_step).
REVIEW_STEPS: tuple[str, ...] = (ImportStep.REVIEW, ImportStep.CONFIRM)

# Each step as an import of that kind names it on screen.
IMPORT_STEP_NAMES: dict[str, dict[str, str]] = {
    ImportBatch.Kind.STUDENT_ROSTER: {
        ImportStep.CHOOSE_FILE: "Choose file",
        ImportStep.MATCH: "Your file",
        ImportStep.REVIEW: "Things to check",
        ImportStep.CONFIRM: "Save",
        ImportStep.RESULTS: "Results",
    },
    ImportBatch.Kind.LEGACY_GRADINGS: {
        ImportStep.CHOOSE_FILE: "Choose file",
        ImportStep.MATCH: "Sheets",
        ImportStep.REVIEW: "Things to check",
        ImportStep.CONFIRM: "Save",
        ImportStep.RESULTS: "Results",
    },
}


# --- batch lifecycle -------------------------------------------------------


def why_not_startable(kind: str) -> str | None:
    """Why an import of this kind cannot start now, or None when it can.
    Past gradings are linked to students and never create one, so they wait
    for the students to be imported first."""
    if kind == ImportBatch.Kind.LEGACY_GRADINGS and not Student.objects.exists():
        return STUDENTS_FIRST
    return None


@dataclass(frozen=True)
class CreateImportBatchResult:
    batch: ImportBatch
    already_imported_warning: bool


def expire_stale_import_batches(
    max_age: timedelta = STALE_BATCH_AGE,
) -> tuple[int, list[int]]:
    """Expire every batch left uploaded for longer than `max_age`.

    Returns how many expired and which could not. Only a selection: each batch
    is rechecked under its lock, in its own transaction, so one failure neither
    rolls back nor stops the others.
    """
    candidates = ImportBatch.objects.filter(
        status=ImportBatch.Status.UPLOADED,
        uploaded_at__lt=timezone.now() - max_age,
    ).values_list("pk", flat=True)
    expired = 0
    failed: list[int] = []
    for batch_id in candidates.order_by("pk"):
        try:
            if expire_import_batch(batch_id, max_age=max_age):
                expired += 1
        except Exception:
            logger.exception("Import batch #%s could not be expired.", batch_id)
            failed.append(batch_id)
    return expired, failed


def create_import_batch(
    *,
    kind: str,
    upload: UploadedFile,
    uploaded_by: User,
    sheet: str | None = None,
) -> CreateImportBatchResult:
    """Store a new upload, after clearing the abandoned ones.

    Abandoned uploads hold personal data, so they do not wait for a scheduler:
    every upload expires the stale ones first (one cheap query when there are
    none), and the container does the full sweep each time it starts. A failure
    clearing them never stops the upload.
    """
    try:
        expire_stale_import_batches()
    except Exception:
        logger.exception("Stale import batches could not be cleared.")
    return _create_import_batch(
        kind=kind,
        upload=upload,
        uploaded_by=uploaded_by,
        sheet=sheet,
    )


@transaction.atomic
def _create_import_batch(
    *,
    kind: str,
    upload: UploadedFile,
    uploaded_by: User,
    sheet: str | None = None,
) -> CreateImportBatchResult:
    allowed = ALLOWED_SUFFIXES.get(kind)
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

    refusal = why_not_startable(kind)
    if refusal:
        raise DjangoValidationError({"kind": [refusal]})

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

    # Parse before persisting. For a multi-sheet roster with an unreadable
    # opening sheet, retain only its bounded workbook and sheet names so a
    # person can explicitly select another sheet before matching columns.
    detected_headers: list[str] = []
    sheet_error = ""
    if sheet and (kind != ImportBatch.Kind.STUDENT_ROSTER or suffix != WORKBOOK_SUFFIX):
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
            if sheet or suffix != WORKBOOK_SUFFIX:
                raise DjangoValidationError({"file": [str(exc)]}) from exc
            try:
                active_sheet, sheet_names = inspect_workbook_sheets(content)
            except UnsupportedImportFileError:
                raise DjangoValidationError({"file": [str(exc)]}) from exc
            if len(sheet_names) < 2:
                raise DjangoValidationError({"file": [str(exc)]}) from exc
            # Keep the selected opening sheet and the parse error visible. A
            # different sheet can be chosen through the existing sheet action.
            dataset = TabularData([], [], active_sheet, sheet_names)
            sheet_error = str(exc)
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

    configuration = ImportConfiguration({})
    configuration.detected_headers = detected_headers
    if sheet_error:
        configuration.sheet_error = sheet_error
    if kind == ImportBatch.Kind.STUDENT_ROSTER:
        configuration.sheet = dataset.sheet
        configuration.sheet_names = list(dataset.sheet_names)
    upload.seek(0)
    batch = ImportBatch.objects.create(
        kind=kind,
        status=ImportBatch.Status.UPLOADED,
        source_file=upload,
        original_filename=filename,
        sha256=digest,
        file_size=len(content),
        uploaded_by=uploaded_by,
        uploaded_by_title=title_of(uploaded_by),
        configuration_json=configuration.stored,
    )
    if kind == ImportBatch.Kind.STUDENT_ROSTER:
        _store_roster_rows(batch, dataset)
    else:
        _store_legacy_rows(batch, parsed)
    return CreateImportBatchResult(
        batch=batch,
        already_imported_warning=already_imported_warning,
    )


# --- stored rows -----------------------------------------------------------


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


def _store_legacy_rows(batch: ImportBatch, parsed: WorkbookParseResult) -> None:
    """Every record read, then each sheet against what KukGrade holds: only
    the new ones are chosen, so a workbook uploaded again with one more sheet
    brings in that sheet alone. Then each row is classified."""
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
    keys: dict[str, list[str]] = {}
    for row in parsed.rows:
        keys.setdefault(row.source_sheet, []).append(legacy_content_key(row))
    batch.configuration.warnings = list(parsed.warnings)
    batch.configuration.sheets = [
        {
            "name": sheet.name,
            "cycle_year": sheet.cycle_year,
            "cycle_month": sheet.cycle_month,
            "records": len(keys.get(sheet.name, [])),
            "fingerprint": _fingerprint(keys.get(sheet.name, [])),
            "included": False,
        }
        for sheet in parsed.sheets
    ]
    new = {
        sheet.name for sheet in legacy_sheets(batch) if sheet.state == SheetState.NEW
    }
    for entry in batch.configuration.sheets:
        entry["included"] = entry["name"] in new
    batch.save(update_fields=["configuration_json", "updated_at"])
    _classify_legacy(batch)


def _search_text(values: dict[str, str]) -> str:
    return " ".join(value for value in values.values() if value).lower()


def _locked_row(locked: ImportBatch, row_number: int) -> ImportRow:
    row = locked.rows.filter(row_number=row_number).first()
    if row is None:
        raise DjangoValidationError({"row": ["This import has no such row."]})
    return row


def _row_counted(path: str = "") -> dict[str, models.Count]:
    """The one statement of an import's row counts: every row, and the rows of
    each outcome, named by it lower-cased ("ready", "review_required"...).
    `path` reaches the rows from where they are counted."""
    return {
        "total": models.Count(f"{path}pk"),
        **{
            outcome.lower(): models.Count(
                f"{path}pk",
                filter=models.Q(**{f"{path}outcome": outcome}),
            )
            for outcome in ImportRow.Outcome.values
        },
    }


ROW_COUNT_NAMES: tuple[str, ...] = tuple(_row_counted())


def with_row_counts(
    batches: models.QuerySet[ImportBatch],
) -> models.QuerySet[ImportBatch]:
    """Imports annotated with `rows_<name>` for each of ROW_COUNT_NAMES, so a
    page of imports is counted in its one query."""
    return batches.annotate(
        **{f"rows_{name}": count for name, count in _row_counted("rows__").items()},
    )


def row_counts(rows: models.QuerySet[ImportRow]) -> dict[str, int]:
    """How many of these rows there are, and of each outcome."""
    counts: dict[str, int] = rows.aggregate(**_row_counted())
    return counts


def review_step(batch: ImportBatch, *, rows_needing_review: int) -> str:
    """Where the review stands: still reviewing while a roster has rows needing
    attention, otherwise ready to confirm. A historical import's records are
    never fixed one by one, so its review is always ready to confirm."""
    if batch.kind == ImportBatch.Kind.STUDENT_ROSTER and rows_needing_review:
        return ImportStep.REVIEW
    return ImportStep.CONFIRM


def uncovered_fields(batch: ImportBatch) -> list[str]:
    """A roster's needed fields that no column holds and no whole-file value
    gives: each row's value must then be typed in as a fix. None until the
    columns are first saved, and none for a historical workbook."""
    configuration = batch.configuration
    roster = batch.kind == ImportBatch.Kind.STUDENT_ROSTER
    if not roster or not configuration.column_mapping:
        return []
    return [
        field
        for field in STUDENT_TARGET_FIELDS
        if field not in STUDENT_OPTIONAL_FIELDS
        and not configuration.column_mapping.get(field)
        and not configuration.defaults.get(field)
    ]


def next_step(batch: ImportBatch, *, rows_needing_review: int) -> str:
    """Where an import is up to, so a screen can resume it: matching until a
    roster's columns are saved, and always its sheets first for a historical
    workbook (what KukGrade holds of them can change between two visits)."""
    if batch.status != ImportBatch.Status.UPLOADED:
        return ImportStep.RESULTS
    if (
        batch.kind == ImportBatch.Kind.LEGACY_GRADINGS
        or not batch.configuration.column_mapping
    ):
        return ImportStep.MATCH
    return review_step(batch, rows_needing_review=rows_needing_review)


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

    Storage is not transactional: a file deleted before the commit
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


def _read_source_file(batch: ImportBatch) -> bytes:
    # Read once at upload, and again only to read another sheet - by then
    # the file may have gone with its batch.
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
    record_count: int,
    what: str,
) -> ImportBatch:
    """Close a committed batch: provenance, safe counts, file removed, and
    one IMPORT_BATCH_COMMITTED event for the whole cascade."""
    locked.status = ImportBatch.Status.COMMITTED
    locked.committed_by = actor
    locked.committed_by_title = title_of(actor)
    locked.committed_at = timezone.now()
    locked.summary_json = summary
    _release_source_file(locked)
    locked.save(
        update_fields=[
            "status",
            "committed_by",
            "committed_by_title",
            "committed_at",
            "summary_json",
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

    The caller's selection may be stale by now: the batch can have
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
            sheet=sheet or batch.configuration.sheet or None,
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
    the wrong file imported, since a record is never deleted. Each is voided
    as one alone would be, with its own event; records already voided are
    left as they are. Returns how many."""
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
    configuration = locked.configuration
    if sheet not in configuration.sheet_names:
        raise DjangoValidationError({"sheet": [NO_SUCH_SHEET.format(sheet=sheet)]})
    try:
        dataset = _load_batch_dataset(locked, sheet)
    except DjangoValidationError as exc:
        raise DjangoValidationError({"sheet": exc.messages}) from exc
    _drop_rows(locked)
    del configuration.column_mapping
    del configuration.defaults
    del configuration.extra_columns
    del configuration.sheet_error
    configuration.sheet = dataset.sheet
    configuration.detected_headers = dataset.headers
    locked.save(update_fields=["configuration_json", "updated_at"])
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
    # The fields the issues are about, so a screen can mark them.
    issue_fields: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StudentImportPreview:
    rows: list[StudentImportRowResult]
    # The rows' counts, by ROW_COUNT_NAMES.
    counts: dict[str, int]


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
        if not cell_text(value) and defaults:
            value = defaults.get(target_field, value)
        values[target_field] = value
    return values


def extra_values(raw_row: dict[str, Any], extra_columns: list[str]) -> dict[str, str]:
    """The kept columns' values in this row, by header; blanks left out."""
    extra: dict[str, str] = {}
    for header in extra_columns:
        text = cell_text(raw_row.get(header))
        if text:
            extra[header] = text
    return extra


def roster_cells(raw_row: dict[str, Any]) -> dict[str, str]:
    """Every cell of a roster row, by header, as the file has it."""
    return {header: cell_text(value) for header, value in raw_row.items()}


def roster_file_values(
    raw_row: dict[str, Any],
    column_mapping: dict[str, str],
) -> dict[str, str]:
    """Each matched field's value as the file has it, before any fix."""
    return {
        field: cell_text(raw_row.get(header))
        for field, header in column_mapping.items()
        if header
    }


def rows_given_a_value(
    batch: ImportBatch,
    rows: models.QuerySet[ImportRow],
    field_name: str,
) -> models.QuerySet[ImportRow]:
    """A roster's rows whose `field_name` (current_rank or status) the file
    did not give - no column, or a blank cell - and nobody typed in, so the
    whole-file value or KukGrade's own default (Active) was used."""
    if (
        batch.kind != ImportBatch.Kind.STUDENT_ROSTER
        or field_name not in STUDENT_WHOLE_FILE_FIELDS
    ):
        return rows.none()
    header = batch.configuration.column_mapping.get(field_name)
    given = [
        row_number
        for row_number, raw, correction in rows.values_list(
            "row_number",
            "raw",
            "correction",
        )
        if field_name not in correction and not (header and cell_text(raw.get(header)))
    ]
    return rows.filter(row_number__in=given)


def second_look_counts(batch: ImportBatch) -> dict[str, int]:
    """Of a roster's rows that were added, how many hold a fix of the
    importer's, and how many were given the whole-file (or default) status or
    rank because the file gave none."""
    added = batch.rows.filter(outcome=ImportRow.Outcome.READY)
    return {
        "corrected": added.exclude(correction={}).count(),
        "given_status": rows_given_a_value(batch, added, "status").count(),
        "given_rank": rows_given_a_value(batch, added, "current_rank").count(),
    }


def _student_model_issues(
    *,
    wksa_id: str,
    first_name: str,
    last_name: str,
    date_of_birth: date | None,
    rank: Rank | None,
) -> list[tuple[str, str]]:
    """What `Student`'s own validation says of an unsaved row, as
    (field, message) - the field blank for a rule about the whole student.

    The field and `clean()` rules `create_student` runs on save - lengths,
    blanks, a future date of birth - so a row preview calls ready is one
    commit can create. A value that is missing or did not parse already has
    its own issue, so its field is skipped here. So are the checks that each
    cost a query and repeat one preview has made: the rank was just read
    from the catalogue, the status checked against its choices, and the two
    check constraints restate `clean()` and those choices. An existing WKSA
    ID is a skip, not an error.
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
            (name if name in given else "", _labelled(name, message))
            for name, messages in exc.message_dict.items()
            for message in messages
        ]
    return []


def _labelled(name: str, message: str) -> str:
    label = STUDENT_FIELD_LABELS.get(name)
    if label is None or message.startswith(label):
        return message
    return f"{label}: {message}"


def _row_value(values: dict[str, Any], correction: dict[str, str], name: str) -> Any:
    """A roster row's value for a field: the importer's fix, else the file's."""
    return correction.get(name, values.get(name))


def _row_wksa_id(values: dict[str, Any], correction: dict[str, str]) -> str:
    # Tidied as Student.clean() tidies it, so a file's "a-20819" is found as
    # the existing A-20819 and counted once.
    return wksa_ids.normalise(_row_value(values, correction, "wksa_id"))


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
    issue_fields: set[str] = set()

    def issue(name: str, message: str) -> None:
        issues.append(message)
        if name:
            issue_fields.add(name)

    def text(name: str) -> str:
        return cell_text(_row_value(values, correction, name))

    wksa_id = _row_wksa_id(values, correction)
    first_name = text("first_name")
    last_name = text("last_name")
    status_text = text("status").upper() or Student.Status.ACTIVE
    rank_text = text("current_rank")
    dob_raw = _row_value(values, correction, "date_of_birth")

    dob_display = cell_text(dob_raw)
    parsed_dob = _coerce_date(dob_raw)
    if not dob_display:
        issue("date_of_birth", "Date of birth is required.")
    elif parsed_dob is None:
        issue("date_of_birth", f"Date of birth {dob_display!r} is not a valid date.")

    # The club's own fixed spellings are the rank they spell ("White Belt"
    # is White, "DBN" Dahn Bo - ranks.matching); a rank the file marks as
    # doubtful ("Red stripe?") is for the importer to confirm, never taken.
    rank, doubtful = suggest_rank(rank_text, ranks) if rank_text else (None, False)
    if not rank_text:
        issue("current_rank", "Current rank is required.")
    elif doubtful:
        issue(
            "current_rank",
            f"Rank {rank_text!r} is marked as uncertain in the file: choose the "
            "rank it should be.",
        )
        rank = None
    elif rank is None:
        issue("current_rank", f"Rank {rank_text!r} is not a rank KukGrade recognises.")

    if status_text not in Student.Status.values:
        issue("status", STATUS_NOT_RECOGNISED.format(status=status_text))
        status_text = Student.Status.ACTIVE

    for name, message in _student_model_issues(
        wksa_id=wksa_id,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=parsed_dob,
        rank=rank,
    ):
        issue(name, message)

    if wksa_id in retired_wksa_ids:
        issue(
            "wksa_id",
            "This ID belonged to a student who was deleted. A number is never "
            "given to anyone else.",
        )
    if wksa_id and wksa_id in seen_wksa_ids:
        issue("wksa_id", "Duplicate WKSA ID within this file.")
    if wksa_id:
        seen_wksa_ids.add(wksa_id)

    if wksa_id in replaced_wksa_ids:
        # An old student ID is still its student's: a number is never reused.
        issue(
            "wksa_id",
            f"This ID belongs to a student who now holds {replaced_wksa_ids[wksa_id]}.",
        )
        outcome = ImportRow.Outcome.SKIP_EXISTING
    elif wksa_id in existing_wksa_ids:
        outcome = ImportRow.Outcome.SKIP_EXISTING
    elif issues:
        outcome = ImportRow.Outcome.REVIEW_REQUIRED
    else:
        outcome = ImportRow.Outcome.READY

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
        issue_fields=sorted(issue_fields),
    )


def _classify_roster(locked: ImportBatch) -> StudentImportPreview:
    """Check every stored row of a roster against its mapping and the database.

    Rows are checked together, not one by one: a WKSA ID repeated in the file
    is only seen across rows, and the lookups are one query each for the
    whole file. Each row's result is stored on it.
    """
    configuration = locked.configuration
    column_mapping = configuration.column_mapping
    defaults = configuration.defaults
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
        stored.issue_fields = list(result.issue_fields)
        stored.values = shown
        stored.search_text = _search_text(shown)
        results.append(result)
    ImportRow.objects.bulk_update(
        stored_rows,
        ["outcome", "issues", "issue_fields", "values", "search_text"],
        batch_size=500,
    )
    return StudentImportPreview(rows=results, counts=row_counts(locked.rows.all()))


def _excluded_roster_row(
    stored: ImportRow,
    values: dict[str, Any],
    correction: dict[str, str],
) -> StudentImportRowResult:
    def text(name: str) -> str:
        return cell_text(_row_value(values, correction, name))

    return StudentImportRowResult(
        row_number=stored.row_number,
        outcome=ImportRow.Outcome.EXCLUDED,
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


def _require_mapping(locked: ImportBatch) -> None:
    if not locked.configuration.column_mapping:
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
    values, and the columns kept as extra information. Every rule of the
    mapping is checked here: each field is one of KukGrade's, each named
    column one of the file's own and used once, and a whole-file value is
    given only for a field that can have one, and is one KukGrade knows.

    A needed field may have no column: each row's value is then typed in as
    a fix, and the row needs attention until it is. Commit refuses while any
    row does.
    """
    configuration = locked.configuration
    chosen = {field: header for field, header in column_mapping.items() if header}
    headers = set(configuration.detected_headers)
    errors: dict[str, list[str]] = {}
    unknown = sorted(set(column_mapping) - set(STUDENT_TARGET_FIELDS))
    missing = sorted(set(chosen.values()) - headers)
    used = list(chosen.values())
    repeated = sorted({header for header in used if used.count(header) > 1})
    if unknown:
        errors["column_mapping"] = [f"Unknown field(s): {', '.join(unknown)}."]
    elif missing:
        errors["column_mapping"] = [
            _NO_SUCH_COLUMN.format(columns=", ".join(map(repr, missing))),
        ]
    elif repeated:
        errors["column_mapping"] = [
            f"The column {', '.join(map(repr, repeated))} is matched to more than "
            "one KukGrade field; match each column once.",
        ]
    kept = list(dict.fromkeys(extra_columns or []))
    if set(kept) - headers:
        errors["extra_columns"] = [
            _NO_SUCH_COLUMN.format(
                columns=", ".join(map(repr, sorted(set(kept) - headers))),
            ),
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
    status_default = cleaned_defaults.get("status")
    rank_default = cleaned_defaults.get("current_rank")
    rank_default_found, rank_default_doubtful = (
        suggest_rank(rank_default, active_rank_lookup())
        if rank_default
        else (None, False)
    )
    if set(defaults or {}) - set(STUDENT_WHOLE_FILE_FIELDS):
        errors["defaults"] = [
            "Only current rank and status can be given for the whole file.",
        ]
    elif status_default and status_default not in Student.Status.values:
        errors["defaults"] = [STATUS_NOT_RECOGNISED.format(status=status_default)]
    elif rank_default and (rank_default_found is None or rank_default_doubtful):
        errors["defaults"] = [f"{rank_default!r} is not a rank KukGrade recognises."]
    if errors:
        raise DjangoValidationError(errors)
    configuration.column_mapping = chosen
    configuration.defaults = cleaned_defaults
    configuration.extra_columns = kept
    locked.save(update_fields=["configuration_json", "updated_at"])


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
def leave_out_rows_needing_attention(batch: ImportBatch) -> int:
    """Leave out every roster row still needing attention, in one go - the
    importer's "Leave out the rest". Returns how many were left out."""
    locked = _lock_uncommitted(batch, "changed")
    _require_roster(locked)
    _require_mapping(locked)
    left_out = locked.rows.filter(
        outcome=ImportRow.Outcome.REVIEW_REQUIRED,
        excluded=False,
    ).update(excluded=True, outcome=ImportRow.Outcome.EXCLUDED)
    _classify_roster(locked)
    return left_out


@transaction.atomic
def set_import_row_excluded(
    batch: ImportBatch,
    *,
    row_number: int,
    excluded: bool,
) -> ImportRow:
    """Leave a row out of the import, or bring it back."""
    locked = _lock_uncommitted(batch, "changed")
    row = _locked_row(locked, row_number)
    row.excluded = excluded
    if excluded:
        row.outcome = ImportRow.Outcome.EXCLUDED
    elif locked.kind == ImportBatch.Kind.STUDENT_ROSTER:
        # Until the check below, which a roster with its columns matched gets.
        row.outcome = ImportRow.Outcome.REVIEW_REQUIRED
    else:
        # A historical record is never held back by what it lacks, so one
        # brought back is ready.
        row.outcome = ImportRow.Outcome.READY
    row.save(update_fields=["excluded", "outcome"])
    # Every row again: a row left out, or back, can end or make a repeat.
    if locked.kind == ImportBatch.Kind.LEGACY_GRADINGS:
        # Left out or brought back here, the row is no check's to undo.
        configuration = locked.configuration
        configuration.checks_left_out = _disowned(
            configuration.checks_left_out,
            [row_number],
        )
        locked.save(update_fields=["configuration_json", "updated_at"])
        _classify_legacy(locked)
    elif locked.configuration.column_mapping:
        _classify_roster(locked)
    row.refresh_from_db()
    return row


def _row_no_longer_valid(
    row: StudentImportRowResult,
    reason: str,
) -> DjangoValidationError:
    return DjangoValidationError(
        {
            "rows": [
                f"Row {row.row_number} ({row.wksa_id}) is no longer valid: "
                f"{reason} Nothing was imported.",
            ],
        },
    )


@transaction.atomic
def commit_student_import(
    batch: ImportBatch,
    *,
    actor: User,
) -> ImportBatch:
    """Create a student for every ready row, all or nothing, from the stored
    mapping and fixes. Never trusts what a screen last showed - every row is
    checked again now, under the batch's lock.
    """
    locked = _lock_uncommitted(batch, "imported again")
    _require_roster(locked)
    _require_mapping(locked)
    preview = _classify_roster(locked)
    counts = preview.counts
    # A row is only imported once KukGrade's own fields are right (owner,
    # 2026-10-20): one still needing attention is fixed or left out first,
    # never passed over without a word.
    if counts["review_required"]:
        raise DjangoValidationError(
            {"rows": [_rows_need_attention(counts["review_required"])]},
        )
    extra_columns = locked.configuration.extra_columns
    raw_by_row = dict(locked.rows.values_list("row_number", "raw"))
    ready_rows = [row for row in preview.rows if row.outcome == ImportRow.Outcome.READY]

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
                    "Nothing was imported.",
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
            "total": counts["total"],
            "created": len(created_ids),
            "skipped_existing": counts["skip_existing"],
            "review_required": counts["review_required"],
            "excluded": counts["excluded"],
        },
        record_count=len(created_ids),
        what="student(s)",
    )


def _rows_need_attention(count: int) -> str:
    rows = "row needs" if count == 1 else "rows need"
    return (
        f"{count} {rows} attention. Fix each one or leave it out, then import "
        "again. Nothing was imported."
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
        parsed = parse_ksw_workbook(content)
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

    Source text is kept verbatim, so it is never
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
) -> list[tuple[ImportRow, CanonicalLegacyRow]]:
    """The rows that come in, as the last check found (_classify_legacy): not
    left out, on a chosen sheet, and not already in KukGrade."""
    stored = locked.rows.filter(outcome=ImportRow.Outcome.READY).order_by("row_number")
    return [(row, CanonicalLegacyRow(**row.raw)) for row in stored]


def legacy_warnings(batch: ImportBatch) -> list[str]:
    """What a historical import could not read or check, for its things to
    check: what reading the workbook left out, and a sheet naming too many of
    the people still coming in to be checked for anyone written twice."""
    if batch.kind != ImportBatch.Kind.LEGACY_GRADINGS:
        return []
    rows = [canonical for _, canonical in _stored_legacy_rows(batch)]
    return [*batch.configuration.warnings, *names_not_checked(rows)]


class SheetState(models.TextChoices):
    """A grading sheet against what KukGrade already holds for its month."""

    NEW = "NEW", "New"
    IMPORTED = "IMPORTED", "Already imported"
    CHANGED = "CHANGED", "Changed since imported"


# Records of a changed sheet listed as what differs, each way; the rest counted.
_DIFFERENCES_SHOWN = 50


@dataclass(frozen=True)
class SheetRecord:
    """A record named in what differs, as the workbook writes it."""

    name: str
    current_rank: str
    testing_for_rank: str
    outcome: str


@dataclass(frozen=True)
class LegacySheet:
    """A grading sheet of an import, and how it stands against KukGrade."""

    name: str
    cycle_year: int
    cycle_month: int
    records: int
    included: bool
    state: str
    # The finished imports holding records for its month.
    held_by: list[int]
    # A changed sheet's records KukGrade does not hold yet, and those it
    # holds for the month that the sheet no longer has.
    added: list[SheetRecord]
    removed: list[SheetRecord]
    added_count: int
    removed_count: int


def _fingerprint(keys: Iterable[str]) -> str:
    """What a sheet's records say, as one value: the same records give the
    same fingerprint in any order."""
    return hashlib.sha256("\n".join(sorted(keys)).encode()).hexdigest()


def _held_records() -> models.QuerySet[LegacyGradingRecord]:
    """The historical records KukGrade holds: imported and not voided. A
    voided record was set aside, so its row may be wanted again."""
    return LegacyGradingRecord.objects.filter(
        is_void=False,
        source_batch__status=ImportBatch.Status.COMMITTED,
    )


def legacy_sheets(batch: ImportBatch) -> list[LegacySheet]:
    """Each grading sheet of a historical import, against the records KukGrade
    holds for its month now: new, already imported, or changed since - with
    what differs. Read every time, never stored: another import may have
    finished, or a record been voided, since the upload. A roster has none."""
    if batch.kind != ImportBatch.Kind.LEGACY_GRADINGS:
        return []
    sheets = batch.configuration.sheets
    keys: dict[str, list[tuple[str, CanonicalLegacyRow]]] = {}
    for stored in batch.rows.order_by("row_number"):
        row = CanonicalLegacyRow(**stored.raw)
        keys.setdefault(row.source_sheet, []).append((legacy_content_key(row), row))
    months = {(sheet["cycle_year"], sheet["cycle_month"]) for sheet in sheets}
    held: dict[tuple[int, int], list[LegacyGradingRecord]] = {}
    for record_ in (
        _held_records()
        .filter(
            cycle_year__in={year for year, _ in months},
            cycle_month__in={month for _, month in months},
        )
        .only(
            "content_key",
            "cycle_year",
            "cycle_month",
            "source_batch_id",
            "source_name",
            "source_current_rank_text",
            "source_testing_for_rank_text",
            "source_outcome_text",
        )
        .order_by("pk")
    ):
        month = (record_.cycle_year, record_.cycle_month)
        if month in months:
            held.setdefault(month, []).append(record_)

    found: list[LegacySheet] = []
    for sheet in sheets:
        rows = keys.get(sheet["name"], [])
        records = held.get((sheet["cycle_year"], sheet["cycle_month"]), [])
        unmatched = Counter(record_.content_key for record_ in records)
        added: list[CanonicalLegacyRow] = []
        for key, row in rows:
            if unmatched[key] > 0:
                unmatched[key] -= 1
            else:
                added.append(row)
        removed: list[LegacyGradingRecord] = []
        for record_ in records:
            if unmatched[record_.content_key] > 0:
                unmatched[record_.content_key] -= 1
                removed.append(record_)
        if not records:
            state = SheetState.NEW
        elif _fingerprint(r.content_key for r in records) == sheet["fingerprint"]:
            state = SheetState.IMPORTED
        else:
            state = SheetState.CHANGED
        changed = state == SheetState.CHANGED
        found.append(
            LegacySheet(
                name=sheet["name"],
                cycle_year=sheet["cycle_year"],
                cycle_month=sheet["cycle_month"],
                records=sheet["records"],
                included=sheet["included"],
                state=state,
                held_by=sorted({record_.source_batch_id for record_ in records}),
                added=[
                    SheetRecord(
                        name=row.source_name,
                        current_rank=row.source_current_rank_text,
                        testing_for_rank=row.source_testing_for_rank_text,
                        outcome=row.source_outcome_text,
                    )
                    for row in added[:_DIFFERENCES_SHOWN]
                ]
                if changed
                else [],
                removed=[
                    SheetRecord(
                        name=record_.source_name,
                        current_rank=record_.source_current_rank_text,
                        testing_for_rank=record_.source_testing_for_rank_text,
                        outcome=record_.source_outcome_text,
                    )
                    for record_ in removed[:_DIFFERENCES_SHOWN]
                ]
                if changed
                else [],
                added_count=len(added) if changed else 0,
                removed_count=len(removed) if changed else 0,
            ),
        )
    return found


def _rank_unresolved(text: str, resolve: Callable[[str], Rank | None]) -> bool:
    """A rank the workbook writes that no chosen rank answers yet."""
    return bool(text.strip()) and resolve(text) is None


def _legacy_issue_finder(
    configuration: ImportConfiguration,
    checks: dict[str, list[str]],
) -> Callable[[CanonicalLegacyRow], list[str]]:
    """Why a historical record is worth a look before importing. None of it
    stops the import: every record is kept exactly as the workbook has it.
    `checks` is what the workbook itself shows (workbook_checks), by locator."""
    resolve = rank_reader(configuration)
    read_outcome = outcome_reader(configuration)
    ranks = active_rank_lookup()

    def issues(row: CanonicalLegacyRow) -> list[str]:
        found: list[str] = []
        written = (row.source_current_rank_text, row.source_testing_for_rank_text)
        for text in dict.fromkeys(value.strip() for value in written if value.strip()):
            if suggest_rank(text, ranks)[1]:
                found.append(f"The workbook marks rank {text!r} as uncertain.")
            if _rank_unresolved(text, resolve):
                found.append(f"Rank {text!r} is not matched to a KukGrade rank yet.")
        if outcome_unread(row) and read_outcome(row) is None:
            outcome_text = row.source_outcome_text.strip()
            found.append(f"Outcome {outcome_text!r} is not one KukGrade knows.")
        found.extend(checks.get(row.source_locator, []))
        if row.record_kind == LegacyRecordKind.AUXILIARY_NOTE:
            found.append(
                "A note on the sheet, kept with that grading, not as anyone's result.",
            )
        return found

    return issues


def _classify_legacy(locked: ImportBatch) -> None:
    """Store what comes in of a historical import, and why to look at it.

    Each row is left out (the importer's choice), on a sheet not chosen,
    already in KukGrade, or ready. A record is already in KukGrade when a
    record held says the same (legacy_content_key) - wherever its row was - so
    a workbook uploaded again adds nothing twice; a record written twice in
    the workbook is matched twice. Checked against the records as they are
    now: another import may have finished since, or a record been voided.

    Only a ready or left-out row has reasons to look, and the workbook's own
    checks see only the ready rows, so leaving out one of a name written
    twice ends the other's. Only the rows that changed are written.
    """
    stored_rows = list(locked.rows.order_by("row_number"))
    canonical = [CanonicalLegacyRow(**stored.raw) for stored in stored_rows]
    chosen = {
        sheet["name"] for sheet in locked.configuration.sheets if sheet["included"]
    }
    keys = [legacy_content_key(row) for row in canonical]
    held = Counter(
        _held_records()
        .filter(content_key__in=set(keys))
        .values_list("content_key", flat=True),
    )
    outcomes: list[str] = []
    for stored, row, key in zip(stored_rows, canonical, keys, strict=True):
        if stored.excluded:
            outcomes.append(ImportRow.Outcome.EXCLUDED)
        elif row.source_sheet not in chosen:
            outcomes.append(ImportRow.Outcome.SHEET_LEFT_OUT)
        elif held[key] > 0:
            held[key] -= 1
            outcomes.append(ImportRow.Outcome.SKIP_EXISTING)
        else:
            outcomes.append(ImportRow.Outcome.READY)
    issues = _legacy_issue_finder(
        locked.configuration,
        workbook_checks(
            with_outcomes_read(
                (
                    row
                    for row, outcome in zip(canonical, outcomes, strict=True)
                    if outcome == ImportRow.Outcome.READY
                ),
                locked.configuration,
            ),
        ),
    )
    changed: list[ImportRow] = []
    for stored, row, outcome in zip(stored_rows, canonical, outcomes, strict=True):
        found = (
            issues(row)
            if outcome in (ImportRow.Outcome.READY, ImportRow.Outcome.EXCLUDED)
            else []
        )
        if (outcome, found) != (stored.outcome, stored.issues):
            stored.outcome, stored.issues = outcome, found
            changed.append(stored)
    ImportRow.objects.bulk_update(changed, ["outcome", "issues"], batch_size=500)


def _require_legacy(locked: ImportBatch) -> None:
    if locked.kind != ImportBatch.Kind.LEGACY_GRADINGS:
        raise DjangoValidationError(
            {"batch": ["This is not a historical gradings import."]},
        )


def _lock_historical_commits() -> None:
    """Hold, until this transaction ends, the one lock every historical
    commit takes, so each sees the records the one before it added."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            ["historical-import-commit"],
        )


@transaction.atomic
def choose_legacy_sheets(
    batch: ImportBatch,
    *,
    included: Iterable[str],
) -> list[LegacySheet]:
    """Choose which grading sheets of a historical import come in. A sheet
    already imported or changed since may be chosen: only what KukGrade does
    not hold yet comes in from it."""
    locked = _lock_uncommitted(batch, "changed")
    _require_legacy(locked)
    chosen = set(included)
    names = {sheet["name"] for sheet in locked.configuration.sheets}
    unknown = sorted(chosen - names)
    if unknown:
        raise DjangoValidationError(
            {
                "included": [
                    f"This import has no grading sheet named {name!r}."
                    for name in unknown
                ],
            },
        )
    locked.configuration.sheets = [
        {**sheet, "included": sheet["name"] in chosen}
        for sheet in locked.configuration.sheets
    ]
    locked.save(update_fields=["configuration_json", "updated_at"])
    _classify_legacy(locked)
    return legacy_sheets(locked)


def commit_legacy_grading_import(
    batch: ImportBatch,
    *,
    actor: User,
) -> ImportBatch:
    """Save a historical import (_commit_legacy_grading_import).

    Refused because nothing is left to import (another import saved the same
    records since, say), the rows are classified again and that is kept, so
    the import's counts say so and the save is not offered again.
    """
    try:
        return _commit_legacy_grading_import(batch, actor=actor)
    except DjangoValidationError as refusal:
        if NOTHING_TO_IMPORT in getattr(refusal, "message_dict", {}).get("batch", []):
            _reclassify_legacy(batch)
        raise


@transaction.atomic
def _reclassify_legacy(batch: ImportBatch) -> None:
    locked = _lock_uncommitted(batch, "imported again")
    _lock_historical_commits()
    _classify_legacy(locked)


@transaction.atomic
def _commit_legacy_grading_import(
    batch: ImportBatch,
    *,
    actor: User,
) -> ImportBatch:
    """Create a historical record for every row that comes in, all or nothing:
    not left out, on a chosen sheet, and not already in KukGrade.

    The rank choices are the stored ones (the checks' decisions). Each is
    resolved again now against the active ranks, and every row classified
    again against the records held now, so a screen's stale view is never
    trusted. Historical commits run one at a time, so two
    imports of the same sheet at once cannot both add it.
    """
    locked = _lock_uncommitted(batch, "imported again")
    _require_legacy(locked)
    _lock_historical_commits()
    _classify_legacy(locked)
    resolve = rank_reader(locked.configuration)
    read_outcome = outcome_reader(locked.configuration)
    stored_rows = _stored_legacy_rows(locked)
    if not stored_rows:
        raise DjangoValidationError({"batch": [NOTHING_TO_IMPORT]})

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
        # A row's fields are the record's, as the workbook has them, with the
        # ranks its spellings are read as and its outcome as read.
        fields.append(
            asdict(row)
            | {
                "current_rank": current_rank,
                "testing_for_rank": testing_for_rank,
                "outcome": read_outcome(row),
            },
        )
        counts[row.record_kind] = counts.get(row.record_kind, 0) + 1
        if _rank_unresolved(row.source_current_rank_text, resolve):
            unresolved_current += 1
        if _rank_unresolved(row.source_testing_for_rank_text, resolve):
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
            "skip_existing": locked.rows.filter(
                outcome=ImportRow.Outcome.SKIP_EXISTING,
            ).count(),
            "sheet_left_out": locked.rows.filter(
                outcome=ImportRow.Outcome.SHEET_LEFT_OUT,
            ).count(),
        },
        record_count=len(stored_rows),
        what="historical record(s)",
    )


CHECK_GONE = (
    "This is no longer something to check in the import. Look at the list again."
)
CHECK_DECISION_REFUSED = "This can't be sorted that way."
CHOOSE_A_RANK = "Choose one of KukGrade's ranks."
CHOOSE_AN_OUTCOME = "Choose Pass, Fail or Conditional."
CHOOSE_A_ROW = "Choose one of this check's rows still in the import."


@transaction.atomic
def resolve_legacy_check(
    batch: ImportBatch,
    *,
    key: str,
    decision: str,
    rank_code: str | None = None,
    outcome: str | None = None,
    row_number: int | None = None,
) -> LegacyCheck | None:
    """Decide one check of a historical import (data_imports.legacy_checks):
    choose a rank for a spelling, read an outcome, leave a row out, or keep
    what is written. A later decision replaces an earlier one. The check is
    found again against the rows as they are now, so a stale screen's check
    is refused, and the check is served as it stands after: None when
    deciding it ends it (a row brought back that KukGrade already holds)."""
    locked = _lock_uncommitted(batch, "changed")
    _require_legacy(locked)
    _classify_legacy(locked)
    check = next((found for found in legacy_checks(locked) if found.key == key), None)
    if check is None:
        raise DjangoValidationError({"key": [CHECK_GONE]})
    if decision not in DECISIONS[check.kind]:
        raise DjangoValidationError({"decision": [CHECK_DECISION_REFUSED]})
    configuration = locked.configuration
    kept = [other for other in configuration.checks_kept if other != key]
    rank_mappings = dict(configuration.rank_mappings)
    readings = dict(configuration.outcome_readings)
    if check.kind == CheckKind.RANK:
        rank_mappings.pop(check.text.lower(), None)
    if check.kind == CheckKind.OUTCOME:
        readings.pop(check.key.removeprefix(f"{CheckKind.OUTCOME}:"), None)
    if decision == CheckDecision.RANK:
        if not Rank.objects.filter(code=rank_code or "", active=True).exists():
            raise DjangoValidationError({"rank_code": [CHOOSE_A_RANK]})
        rank_mappings[check.text.lower()] = str(rank_code)
    elif decision == CheckDecision.OUTCOME:
        if outcome not in LegacyOutcome.values:
            raise DjangoValidationError({"outcome": [CHOOSE_AN_OUTCOME]})
        readings[check.key.removeprefix(f"{CheckKind.OUTCOME}:")] = str(outcome)
    # The rows this check left out. Keeping as written brings them back, and
    # so does leaving out another once the check is sorted (one decision
    # replacing another); while it is still open, leaving out adds to them.
    # A row left out some other way (the rows list) stays out. A row is the
    # last decision's to undo: leaving it out takes it from any other check.
    left_out = dict(configuration.checks_left_out)
    by_check = left_out.pop(key, [])
    replaced = decision == CheckDecision.KEEP or (
        decision == CheckDecision.LEAVE_OUT
        and check.decision == CheckDecision.LEAVE_OUT
    )
    restored = by_check if replaced else []
    still_out = [] if replaced else by_check
    if decision == CheckDecision.LEAVE_OUT and not (
        row_number in check.rows_to_leave_out or row_number in restored
    ):
        raise DjangoValidationError({"row_number": [CHOOSE_A_ROW]})
    if restored:
        locked.rows.filter(row_number__in=restored, excluded=True).update(
            excluded=False,
            outcome=ImportRow.Outcome.READY,
        )
    if decision == CheckDecision.LEAVE_OUT:
        assert row_number is not None
        locked.rows.filter(row_number=row_number).update(
            excluded=True,
            outcome=ImportRow.Outcome.EXCLUDED,
        )
        left_out = _disowned(left_out, [row_number])
        still_out.append(row_number)
    elif decision == CheckDecision.KEEP:
        kept.append(key)
    if still_out:
        left_out[key] = still_out
    configuration.checks_left_out = left_out
    configuration.checks_kept = kept
    configuration.rank_mappings = rank_mappings
    configuration.outcome_readings = readings
    locked.save(update_fields=["configuration_json", "updated_at"])
    # Every row again: a rank read, an outcome read or a row left out can
    # end a reason to look, or a repeat.
    _classify_legacy(locked)
    # None when the check is gone: a row brought back is already held, say.
    return next((found for found in legacy_checks(locked) if found.key == key), None)


def _disowned(
    left_out: dict[str, list[int]],
    row_numbers: Iterable[int],
) -> dict[str, list[int]]:
    """`left_out` (ImportConfiguration.checks_left_out) with these rows no
    check's to bring back: they were left out, or brought back, since."""
    rows = set(row_numbers)
    return {
        key: kept_out
        for key, by_check in left_out.items()
        if (kept_out := [number for number in by_check if number not in rows])
    }
