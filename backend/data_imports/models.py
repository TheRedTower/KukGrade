"""Bulk data imports (student rosters, legacy grading history).

`ImportBatch` is the upload: what was uploaded, by whom, and what became of
it. `ImportRow` is each row read from it, stored once at upload with its
classification and any fix the importer made, so an import can be left and
resumed, reviewed page by page, and seen afterwards row by row. Rows hold
personal data: they go when an import is cancelled or expires, and a finished
import's rows go after
`COMMITTED_ROWS_KEPT_FOR` (`expire_stale_import_batches`).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Any, overload

from django.conf import settings
from django.db import models

from data_imports.storage import import_upload_path, import_upload_storage


class _Setting[T]:
    """One key of an import's configuration_json, read with its default."""

    def __init__(self, default: Callable[[], T]) -> None:
        self.default = default

    def __set_name__(self, owner: type, name: str) -> None:
        self.key = name

    @overload
    def __get__(self, configuration: None, owner: type) -> _Setting[T]: ...
    @overload
    def __get__(self, configuration: ImportConfiguration, owner: type) -> T: ...
    def __get__(
        self, configuration: ImportConfiguration | None, owner: type
    ) -> T | _Setting[T]:
        if configuration is None:
            return self
        value: T = configuration.stored.get(self.key, self.default())
        return value

    def __set__(self, configuration: ImportConfiguration, value: T) -> None:
        configuration.stored[self.key] = value

    def __delete__(self, configuration: ImportConfiguration) -> None:
        configuration.stored.pop(self.key, None)


class ImportConfiguration:
    """An import's configuration_json, by name: what the file's reading found
    and the importer's choices - never row content, which lives on ImportRow.
    Reading a setting not stored gives its empty value; setting one writes
    the stored JSON, which the caller saves."""

    # Both kinds: what reading the file found.
    detected_headers = _Setting[list[str]](list)
    warnings = _Setting[list[str]](list)
    # A roster: the workbook sheet read, every sheet, and why the opening
    # one could not be read.
    sheet = _Setting[str](str)
    sheet_names = _Setting[list[str]](list)
    sheet_error = _Setting[str](str)
    # A roster: a column per KukGrade field, whole-file values, and the
    # columns kept as extra information.
    column_mapping = _Setting[dict[str, str]](dict)
    defaults = _Setting[dict[str, str]](dict)
    extra_columns = _Setting[list[str]](list)
    # A historical workbook: its grading sheets, and the chosen rank code for
    # each lower-cased spelling.
    grading_sheets = _Setting[list[str]](list)
    rank_mappings = _Setting[dict[str, str]](dict)

    def __init__(self, stored: dict[str, Any]) -> None:
        self.stored = stored


class ImportBatch(models.Model):
    class Kind(models.TextChoices):
        STUDENT_ROSTER = "STUDENT_ROSTER", "Students"
        LEGACY_GRADINGS = "LEGACY_GRADINGS", "Past gradings"

    class Status(models.TextChoices):
        # The one open state; the other three are final.
        UPLOADED = "UPLOADED", "Uploaded"
        COMMITTED = "COMMITTED", "Imported"
        CANCELLED = "CANCELLED", "Cancelled"
        EXPIRED = "EXPIRED", "Expired"

    kind = models.CharField(max_length=32, choices=Kind.choices)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.UPLOADED,
    )
    # A callable resolving the "import_uploads" STORAGES alias
    # (settings.py), not a concrete FileSystemStorage(location=...) instance
    # constructed here - the latter would serialize this machine's absolute
    # IMPORT_UPLOAD_ROOT path into the migration file, which would then
    # disagree with `manage.py makemigrations --check` on every other
    # machine/deployment. Django resolves a FileField's storage callable
    # once and keeps a reference to it for `deconstruct()`, so the migration
    # records the stable dotted path to the callable instead.
    source_file = models.FileField(
        storage=import_upload_storage,
        upload_to=import_upload_path,
        max_length=255,
        blank=True,
    )
    original_filename = models.CharField(max_length=255)
    sha256 = models.CharField(max_length=64)
    file_size = models.PositiveIntegerField()

    # PROTECT throughout, matching the codebase's blanket attribution rule
    # (see audit/models.py) - deleting a user must never erase who ran an
    # import.
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="import_batches_uploaded",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    committed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="import_batches_committed",
    )
    committed_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="import_batches_cancelled",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)

    # Safe summary counts only - never raw row content, DOBs or comments.
    summary_json = models.JSONField(default=dict, blank=True)
    # Read and written through `configuration` (ImportConfiguration).
    configuration_json = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-uploaded_at", "-pk"]
        indexes = [
            models.Index(
                fields=["kind", "status"], name="import_batch_kind_status_idx"
            ),
            models.Index(fields=["sha256"], name="import_batch_sha256_idx"),
            models.Index(fields=["-uploaded_at"], name="import_batch_uploaded_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(original_filename=""),
                name="import_batch_filename_not_blank",
            ),
            models.CheckConstraint(
                condition=~models.Q(sha256=""),
                name="import_batch_sha256_not_blank",
            ),
        ]
        permissions = [
            ("can_commit_import", "Can commit a data import batch"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} batch #{self.pk} ({self.status})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def configuration(self) -> ImportConfiguration:
        return ImportConfiguration(self.configuration_json)


# The states an import ends in: every one but the one open state. The one
# statement, for a filter and for the choices a screen offers.
FINISHED_IMPORT_STATUSES: tuple[str, ...] = tuple(
    status for status in ImportBatch.Status if status != ImportBatch.Status.UPLOADED
)

# How long a finished import's rows stay for its results page.
COMMITTED_ROWS_KEPT_FOR = timedelta(days=30)


class ImportRowOutcome(models.TextChoices):
    READY = "READY", "Ready"
    REVIEW_REQUIRED = "REVIEW_REQUIRED", "Needs attention"
    SKIP_EXISTING = "SKIP_EXISTING", "Already in KukGrade"
    EXCLUDED = "EXCLUDED", "Left out"


class ImportRow(models.Model):
    """One row read from an import's file, stored once at upload.

    `raw` is the row as read - a roster's cells by header, or a historical
    workbook's parsed record - and is never changed; `values` is what the
    last check made of it. `correction` holds the
    importer's fixes by field, `excluded` their choice to leave the row out,
    and `outcome` and `issues` what the last check found. After the import
    is finished, `created_id` names what the row became.
    """

    Outcome = ImportRowOutcome

    batch = models.ForeignKey(
        ImportBatch,
        on_delete=models.CASCADE,
        related_name="rows",
    )
    # A roster's own spreadsheet row number (the header is row 1); a
    # historical workbook's rows in the order read.
    row_number = models.PositiveIntegerField()
    # Where in the file: "R14" for a roster, "06-2025!R14" for a workbook.
    source_locator = models.CharField(max_length=255)
    raw = models.JSONField(default=dict)
    correction = models.JSONField(default=dict, blank=True)
    excluded = models.BooleanField(default=False)
    outcome = models.CharField(
        max_length=16,
        choices=Outcome.choices,
        default=Outcome.REVIEW_REQUIRED,
    )
    issues = models.JSONField(default=list, blank=True)
    # The KukGrade fields the issues are about, so a screen can mark them.
    issue_fields = models.JSONField(default=list, blank=True)
    # The row's values as the last check read them, by KukGrade field, for
    # the review table; and the same, lower-cased, for search.
    values = models.JSONField(default=dict, blank=True)
    search_text = models.TextField(blank=True)
    created_id = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["batch", "row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "row_number"],
                name="import_row_unique_number",
            ),
            models.CheckConstraint(
                condition=models.Q(outcome__in=ImportRowOutcome.values),
                name="import_row_outcome_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(excluded=False)
                | models.Q(outcome=ImportRowOutcome.EXCLUDED),
                name="import_row_excluded_is_left_out",
            ),
        ]
        indexes = [
            models.Index(fields=["batch", "outcome"], name="import_row_outcome_idx"),
        ]

    def __str__(self) -> str:
        return f"Import #{self.batch_id} row {self.row_number} ({self.outcome})"
