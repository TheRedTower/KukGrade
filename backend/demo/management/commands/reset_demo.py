from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from demo.reset import reset_and_tidy


class Command(BaseCommand):
    help = "Wipe the demo club and build it again (demo mode only)."

    def handle(self, *args: Any, **options: Any) -> None:
        seconds = reset_and_tidy()
        self.stdout.write(self.style.SUCCESS(f"Reset the demo club in {seconds:.1f}s."))
