"""Provenance for bulk data imports (student rosters, legacy grading history).

Deliberately lightweight: no permanent per-row staging table (see the
Definitive Implementation Spec, section 10) - a preview is recomputed from
`source_file` + `configuration_json` on every request rather than persisted,
so this model only has to track the batch itself: what was uploaded, by
whom, and what became of it.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.db import models

from data_imports.storage import import_upload_path, import_upload_storage


class ImportBatch(models.Model):
    class Kind(models.TextChoices):
        STUDENT_ROSTER = "STUDENT_ROSTER", "Student roster"
        LEGACY_GRADINGS = "LEGACY_GRADINGS", "Legacy grading records"

    class Status(models.TextChoices):
        UPLOADED = "UPLOADED", "Uploaded"
        NEEDS_REVIEW = "NEEDS_REVIEW", "Needs review"
        READY = "READY", "Ready"
        COMMITTED = "COMMITTED", "Committed"
        # Reserved for a future partial-commit design (see the deviations
        # recorded in docs/decision_log.md) - never produced today.
        PARTIAL = "PARTIAL", "Partially committed"
        CANCELLED = "CANCELLED", "Cancelled"
        FAILED = "FAILED", "Failed"
        EXPIRED = "EXPIRED", "Expired"

    UNCOMMITTED_STATUSES: tuple[str, ...] = (
        Status.UPLOADED,
        Status.NEEDS_REVIEW,
        Status.READY,
    )

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
    # Column mapping / approved rank mappings only - never raw row content.
    configuration_json = models.JSONField(default=dict, blank=True)
    error_summary = models.TextField(blank=True)

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
