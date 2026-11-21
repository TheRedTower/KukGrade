"""When the demo club is next wiped, which the sign-in screen announces."""

from __future__ import annotations

from datetime import datetime, timedelta

from django.conf import settings
from django.utils import timezone


def next_reset_at(now: datetime | None = None) -> datetime:
    """The next reset: the next whole multiple of DEMO_RESET_HOURS since
    midnight, club time. Fixed times rather than "so long after the last one",
    so the web process can announce it without asking the one that resets.
    """
    moment = timezone.localtime(now or timezone.now())
    hours = settings.DEMO_RESET_HOURS
    midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    slots = int((moment - midnight) / timedelta(hours=hours)) + 1
    return midnight + timedelta(hours=hours * slots)
