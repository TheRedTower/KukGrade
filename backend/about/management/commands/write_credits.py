from __future__ import annotations

from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser

from about.credits import write_credits


class Command(BaseCommand):
    help = (
        "Write the Credits screen's data and the third-party licence notices "
        "from the packages actually installed. Run when an image is built."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--output", type=Path, default=settings.CREDITS_DIR)
        parser.add_argument(
            "--pyproject", type=Path, default=settings.BASE_DIR / "pyproject.toml"
        )
        parser.add_argument(
            "--frontend",
            type=Path,
            default=None,
            help=(
                "The frontend folder (package-lock.json, node_modules). Without it, "
                "the checkout's own frontend is used if there is one."
            ),
        )

    def handle(self, *args: Any, **options: Any) -> None:
        frontend: Path | None = options["frontend"]
        if frontend is not None and not (frontend / "package-lock.json").is_file():
            # Asked for by name, so a missing folder is a mistake, not a checkout.
            msg = f"There is no package-lock.json in {frontend}."
            raise CommandError(msg)
        if frontend is None:
            own = settings.BASE_DIR.parent / "frontend"
            frontend = own if (own / "package-lock.json").is_file() else None
        write_credits(options["output"], options["pyproject"], frontend)
        self.stdout.write(f"Credits written to {options['output']}.")
