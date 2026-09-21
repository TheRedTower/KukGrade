"""Expire abandoned import batches and delete their temp files.

No background worker exists in this codebase (see the deviations recorded
in docs/decision_log.md) - run manually or from an external cron, e.g.
`uv run python manage.py expire_stale_import_batches --hours 24`.
"""

from __future__ import annotations

import argparse
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand
from django.utils import timezone

from audit.models import AuditAction
from audit.recording import record
from data_imports.models import ImportBatch
from data_imports.services import delete_batch_file


class Command(BaseCommand):
    help = "Expire uncommitted import batches older than --hours and delete their file."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--hours", type=int, default=24)

    def handle(self, *args: Any, **options: Any) -> None:
        cutoff = timezone.now() - timedelta(hours=options["hours"])
        stale = ImportBatch.objects.filter(
            status__in=ImportBatch.UNCOMMITTED_STATUSES,
            uploaded_at__lt=cutoff,
        )
        count = 0
        for batch in stale:
            delete_batch_file(batch)
            batch.status = ImportBatch.Status.EXPIRED
            batch.save(update_fields=["status", "source_file", "updated_at"])
            record(
                AuditAction.IMPORT_BATCH_CANCELLED,
                batch,
                f"Import batch #{batch.pk} ({batch.kind}) expired "
                f"after {options['hours']}h.",
                metadata={"batch_id": batch.pk, "kind": batch.kind},
            )
            count += 1
        self.stdout.write(f"Expired {count} stale import batch(es).")
