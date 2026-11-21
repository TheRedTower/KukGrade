"""Django's createsuperuser, switched off.

Its non-interactive form takes no password policy, and its prompt offers to
bypass the policy. The first administrator is set up from the setup page,
with the one-time code in the server's log (accounts/setup.py), and every
later account comes from the Users screen; a superuser grants superuser
status in the admin site.
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Not used in KukGrade: the first administrator uses the setup page."

    def add_arguments(self, parser: Any) -> None:
        # Accept whatever Django's own form was given, to refuse it clearly.
        parser.add_argument("args", nargs="*")
        parser.add_argument("--noinput", "--no-input", action="store_true")
        parser.add_argument("--email")
        parser.add_argument("--username")
        parser.add_argument("--database")

    def handle(self, *args: Any, **options: Any) -> None:
        msg = (
            "createsuperuser is not used in KukGrade. The first administrator "
            "is set up from the site's setup page, with the setup code in the "
            "server's log. Every later account is added from the Users screen."
        )
        raise CommandError(msg)
