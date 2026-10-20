"""Bulk data imports (student rosters, legacy grading history).

`ImportBatch` is the upload: what was uploaded, by whom, and what became of
it. `ImportRow` is each row read from it, stored once at upload with its
classification and any fix the importer made (decision log, 2026-10-20 import
overhaul), so an import can be left and resumed, reviewed page by page, and
seen afterwards row by row. Rows hold personal data: they go when an import
is cancelled or expires, and a finished import's rows go after
`COMMITTED_ROWS_KEPT_FOR` (`expire_stale_import_batches`).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import models

from data_imports.storage import import_upload_path, import_upload_storage


class ImportBatch(models.Model):
    class Kind(models.TextChoices):
        STUDENT_ROSTER = "STUDENT_ROSTER", "Student roster"
        LEGACY_GRADINGS = "LEGACY_GRADINGS", "Historical grading records"

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
    # The file's headers, the column mapping and approved rank mappings -
    # never row content, which lives on ImportRow.
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


# How long a finished import's rows stay for its results page.
COMMITTED_ROWS_KEPT_FOR = timedelta(days=30)


class ImportRow(models.Model):
    """One row read from an import's file, stored once at upload.

    `raw` is the row as read - a roster's cells by header, or a historical
    workbook's parsed record - and is never changed; `values` is what the
    last check made of it. `correction` holds the
    importer's fixes by field, `excluded` their choice to leave the row out,
    and `outcome` and `issues` what the last check found. After the import
    is finished, `created_id` names what the row became.
    """

    class Outcome(models.TextChoices):
        READY = "READY", "Ready"
        REVIEW_REQUIRED = "REVIEW_REQUIRED", "Needs attention"
        SKIP_EXISTING = "SKIP_EXISTING", "Already in KukGrade"
        EXCLUDED = "EXCLUDED", "Left out"

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
                condition=models.Q(
                    outcome__in=[
                        "READY",
                        "REVIEW_REQUIRED",
                        "SKIP_EXISTING",
                        "EXCLUDED",
                    ],
                ),
                name="import_row_outcome_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(excluded=False) | models.Q(outcome="EXCLUDED"),
                name="import_row_excluded_is_left_out",
            ),
        ]
        indexes = [
            models.Index(fields=["batch", "outcome"], name="import_row_outcome_idx"),
        ]

    def __str__(self) -> str:
        return f"Import #{self.batch_id} row {self.row_number} ({self.outcome})"
