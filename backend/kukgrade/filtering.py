"""Query-parameter parsing shared across list endpoints."""

from __future__ import annotations

from datetime import date


def parse_date_filter(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None
