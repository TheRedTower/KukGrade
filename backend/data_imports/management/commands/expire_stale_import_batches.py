"""Expire abandoned import batches, remove source files nothing names, and
delete the stored rows of imports finished long enough ago.

No background worker exists in this codebase (see the deviations recorded
in docs/decision_log.md) - run manually or from an external cron, e.g.
`uv run python manage.py expire_stale_import_batches --hours 24`.
"""

from __future__ import annotations

import argparse
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from data_imports.models import ImportBatch
from data_imports.services import (
    expire_import_batch,
    prune_finished_import_rows,
    remove_orphaned_uploads,
)


def _positive_hours(value: str) -> int:
    hours = int(value)
    if hours < 1:
        msg = "must be at least 1 - a batch under review is never stale."
        raise argparse.ArgumentTypeError(msg)
    return hours


class Command(BaseCommand):
    help = (
        "Expire uncommitted import batches older than --hours, delete stored "
        "source files no batch names, and delete the rows of imports finished "
        "more than 30 days ago."
    )

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--hours", type=_positive_hours, default=24)

    def handle(self, *args: Any, **options: Any) -> None:
        max_age = timedelta(hours=options["hours"])
        # Only a selection: each batch is rechecked under its lock, in its
        # own transaction, so one failure neither rolls back nor stops the
        # others.
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
            except Exception as exc:
                failed.append(batch_id)
                self.stderr.write(f"Import batch #{batch_id} not expired: {exc!r}")
        removed = remove_orphaned_uploads(max_age=max_age)
        pruned = prune_finished_import_rows()
        self.stdout.write(
            f"Expired {expired} stale import batch(es); "
            f"removed {removed} orphaned file(s); "
            f"deleted {pruned} row(s) of finished imports.",
        )
        if failed:
            msg = f"{len(failed)} batch(es) could not be expired; run again."
            raise CommandError(msg)
