"""Expire abandoned import batches, remove source files nothing names, and
delete the stored rows of imports finished long enough ago.

No background worker exists in this codebase. The container runs this each time
it starts and every upload clears the stale batches itself, so a scheduler is
optional; run it by hand or from cron for a stricter limit, e.g.
`uv run python manage.py expire_stale_import_batches --hours 24`.
"""

from __future__ import annotations

import argparse
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from data_imports.models import COMMITTED_ROWS_KEPT_FOR
from data_imports.services import (
    STALE_BATCH_AGE,
    expire_stale_import_batches,
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
        f"more than {COMMITTED_ROWS_KEPT_FOR.days} days ago."
    )

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument(
            "--hours",
            type=_positive_hours,
            default=STALE_BATCH_AGE // timedelta(hours=1),
        )

    def handle(self, *args: Any, **options: Any) -> None:
        max_age = timedelta(hours=options["hours"])
        expired, failed = expire_stale_import_batches(max_age)
        for batch_id in failed:
            self.stderr.write(f"Import batch #{batch_id} not expired.")
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
