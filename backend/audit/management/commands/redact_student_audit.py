"""Erase one student's name and date of birth from older audit events.

    manage.py redact_student_audit --wksa-id 123-4-001 \\
        --first-name Alex --last-name Kim [--dry-run]

See docs/privacy.md for when and how to use it.
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from audit.redaction import redact_student_details


class Command(BaseCommand):
    help = (
        "Erase a student's name and date of birth from audit events written "
        "before the log stopped recording them."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--wksa-id", required=True)
        parser.add_argument("--first-name", required=True)
        parser.add_argument("--last-name", required=True)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Say how many events would change, and change nothing.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            changed = redact_student_details(
                wksa_id=options["wksa_id"],
                first_name=options["first_name"],
                last_name=options["last_name"],
                dry_run=options["dry_run"],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        verb = "would change" if options["dry_run"] else "changed"
        self.stdout.write(f"{verb} {changed} audit event(s).")
