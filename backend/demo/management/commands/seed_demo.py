from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from demo import seed


class Command(BaseCommand):
    help = (
        "Build the demo club (demo mode only). Does nothing if it is already "
        "built, so it is safe to run on every start."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        seed.assert_safe_to_build()
        if seed.already_built():
            self.stdout.write("The demo club is already built.")
            return
        seed.build()
        self.stdout.write(self.style.SUCCESS("Built the demo club."))
