"""Write a one-time setup code to the log, while KukGrade has no administrator.

Run by the container's entrypoint at every start (accounts/setup.py), so the
code is in the server's own log, which only the host's owner reads. Prints
nothing once an administrator exists. In development, run it by hand to set
up a fresh database: `uv run python manage.py issue_setup_code`.
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from accounts.setup import SETUP_CODE_LIFETIME, issue_setup_code


class Command(BaseCommand):
    help = "Issue the one-time setup code while no administrator exists."

    def handle(self, *args: Any, **options: Any) -> None:
        code = issue_setup_code()
        if code is None:
            return
        hours = int(SETUP_CODE_LIFETIME.total_seconds() // 3600)
        self.stdout.write(
            self.style.WARNING(
                f"KukGrade needs its first administrator. Open the site and "
                f"enter this setup code: {code} (it works once, for {hours} "
                "hours; restart for a new one).",
            ),
        )
