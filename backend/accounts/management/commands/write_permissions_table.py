"""Write the "who can do what" table in docs/features.md from the grants."""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandError

from accounts.permissions_table import FEATURES_DOC, with_table


class Command(BaseCommand):
    help = "Rewrite the permissions table in docs/features.md from the code."

    def handle(self, *args: Any, **options: Any) -> None:
        if not FEATURES_DOC.exists():
            # The image ships no docs: this is run from a checkout.
            msg = f"{FEATURES_DOC} is not here; run this from a KukGrade checkout."
            raise CommandError(msg)
        current = FEATURES_DOC.read_text()
        updated = with_table(current)
        if updated == current:
            self.stdout.write("The permissions table is already up to date.")
            return
        FEATURES_DOC.write_text(updated)
        self.stdout.write(f"Rewrote the permissions table in {FEATURES_DOC.name}.")
