"""Query-parameter filters shared across list endpoints.

Every list endpoint follows one rule: an absent or blank parameter does not
filter, and a value that cannot possibly match - a non-numeric id, an unknown
choice, a malformed UUID or date - returns an empty page rather than a 400 or
being silently ignored. Each helper applies that rule to one parameter, so a
`get_queryset` reads as a flat list of the filters it supports.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import date
from typing import Any

from django.db.models import QuerySet


def parse_date_filter(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def filter_exact[QS: QuerySet[Any]](queryset: QS, value: str | None, lookup: str) -> QS:
    if not value:
        return queryset
    return queryset.filter(**{lookup: value})


def filter_id[QS: QuerySet[Any]](queryset: QS, value: str | None, lookup: str) -> QS:
    if not value:
        return queryset
    if not value.isdecimal():
        return queryset.none()
    return queryset.filter(**{lookup: int(value)})


def filter_choice[QS: QuerySet[Any]](
    queryset: QS,
    value: str | None,
    lookup: str,
    choices: Collection[str],
) -> QS:
    if not value:
        return queryset
    if value not in choices:
        return queryset.none()
    return queryset.filter(**{lookup: value})


def filter_uuid[QS: QuerySet[Any]](queryset: QS, value: str | None, lookup: str) -> QS:
    if not value:
        return queryset
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return queryset.none()
    return queryset.filter(**{lookup: parsed})


def filter_date[QS: QuerySet[Any]](queryset: QS, value: str | None, lookup: str) -> QS:
    """Filter on an ISO date. An inverted from/to pair needs no special case:
    `__gte` and `__lte` applied together already match nothing."""
    if not value:
        return queryset
    parsed = parse_date_filter(value)
    if parsed is None:
        return queryset.none()
    return queryset.filter(**{lookup: parsed})
