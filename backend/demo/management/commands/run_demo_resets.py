from __future__ import annotations

import time
from typing import Any

from django.core.management.base import BaseCommand
from django.utils import timezone

from demo.reset import reset_and_tidy
from demo.schedule import next_reset_at


class Command(BaseCommand):
    help = (
        "Reset the demo club every KUKGRADE_DEMO_RESET_HOURS, until stopped. "
        "Run by the container beside the application."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        while True:
            time.sleep(max((next_reset_at() - timezone.now()).total_seconds(), 1))
            try:
                seconds = reset_and_tidy()
                self.stdout.write(f"Reset the demo club in {seconds:.1f}s.")
            except Exception as error:  # the next round tries again
                self.stderr.write(f"The demo reset failed: {error}")
