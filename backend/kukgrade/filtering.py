"""Query-parameter filters for list endpoints, declared once per view.

A view lists its filters in `query_filters`; `DeclaredQueryFilters` (the
default filter backend) applies them and describes them to the OpenAPI
schema, so the filters a list endpoint accepts and the ones its contract
documents cannot drift apart - and the frontend's parameter types are
generated from the same declaration.

Every filter follows one rule: an absent or blank parameter does not filter,
and a value that cannot possibly match - a non-numeric id, an unknown choice,
a malformed date, a boolean other than `true`/`false` - returns an
empty page rather than a 400 or being silently ignored.

A parameter a list does not declare at all - a misspelling, or a filter that
was removed - is refused with a 400 naming it. Ignoring it returned the
unfiltered list, which looks exactly like a filter that worked.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from django.db.models import Q, QuerySet
from rest_framework.exceptions import ValidationError
from rest_framework.filters import BaseFilterBackend
from rest_framework.request import Request
from rest_framework.views import APIView

type Apply = Callable[[QuerySet[Any], str], QuerySet[Any]]


@dataclass(frozen=True)
class QueryFilter:
    name: str
    apply: Apply
    schema: dict[str, Any] = field(default_factory=lambda: {"type": "string"})
    description: str = ""

    def schema_parameter(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "required": False,
            "in": "query",
            "description": self.description,
            "schema": self.schema,
        }


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def exact(name: str, lookup: str, description: str = "") -> QueryFilter:
    return QueryFilter(
        name,
        lambda queryset, value: queryset.filter(**{lookup: value}),
        description=description,
    )


def by_id(name: str, lookup: str, description: str = "") -> QueryFilter:
    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if not value.isdecimal():
            return queryset.none()
        return queryset.filter(**{lookup: int(value)})

    return QueryFilter(name, apply, {"type": "integer"}, description)


def choice(
    name: str,
    lookup: str,
    choices: Collection[str],
    description: str = "",
) -> QueryFilter:
    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if value not in choices:
            return queryset.none()
        return queryset.filter(**{lookup: value})

    return QueryFilter(
        name, apply, {"type": "string", "enum": sorted(choices)}, description
    )


def choices_in(
    name: str,
    lookup: str,
    choices: Collection[str],
    description: str = "",
) -> QueryFilter:
    """One or more comma-separated choices, matching any of them."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        wanted = value.split(",")
        if not set(wanted) <= set(choices):
            return queryset.none()
        return queryset.filter(**{f"{lookup}__in": wanted})

    return QueryFilter(
        name,
        apply,
        {"type": "string"},
        f"{description} Comma-separated; one of {', '.join(sorted(choices))}.".strip(),
    )


def ordered_by(
    name: str,
    orderings: Mapping[str, Sequence[str]],
    description: str = "",
) -> QueryFilter:
    """Sort by one of the named orderings; any other value matches nothing."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if value not in orderings:
            return queryset.none()
        return queryset.order_by(*orderings[value])

    return QueryFilter(
        name, apply, {"type": "string", "enum": sorted(orderings)}, description
    )


def on_date(name: str, lookup: str, description: str = "") -> QueryFilter:
    """An ISO date. An inverted from/to pair needs no special case: `__gte`
    and `__lte` applied together already match nothing."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        parsed = _parse_date(value)
        if parsed is None:
            return queryset.none()
        return queryset.filter(**{lookup: parsed})

    return QueryFilter(name, apply, {"type": "string", "format": "date"}, description)


def boolean(
    name: str,
    lookup: str,
    *,
    invert: bool = False,
    description: str = "",
) -> QueryFilter:
    """`true` or `false`; `invert` suits a lookup phrased the other way
    round, such as `linked` over `student__isnull`."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if value not in {"true", "false"}:
            return queryset.none()
        return queryset.filter(**{lookup: (value == "true") != invert})

    return QueryFilter(name, apply, {"type": "boolean"}, description)


def search(name: str, fields: Sequence[str], description: str = "") -> QueryFilter:
    """Case-insensitive substring match across `fields`."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        term = value.strip()
        if not term:
            return queryset
        condition = Q()
        for lookup in fields:
            condition |= Q(**{f"{lookup}__icontains": term})
        return queryset.filter(condition)

    return QueryFilter(name, apply, description=description)


# Pagination's own parameters (kukgrade/pagination.py) and DRF's format
# override, which every list answers whatever its filters are.
ACCEPTED_ON_EVERY_LIST = frozenset({"page", "page_size", "format"})


class DeclaredQueryFilters(BaseFilterBackend):
    """Applies and documents a view's `query_filters`."""

    def filter_queryset(
        self,
        request: Request,
        queryset: QuerySet[Any],
        view: APIView,
    ) -> QuerySet[Any]:
        declared = getattr(view, "query_filters", ())
        if getattr(view, "action", None) == "list":
            known = {
                query_filter.name for query_filter in declared
            } | ACCEPTED_ON_EVERY_LIST
            unknown = sorted(set(request.query_params) - known)
            if unknown:
                raise ValidationError(
                    {
                        name: ["This list has no such query parameter."]
                        for name in unknown
                    },
                )
        for query_filter in declared:
            value = request.query_params.get(query_filter.name)
            if value:
                queryset = query_filter.apply(queryset, value)
        return queryset

    def get_schema_operation_parameters(self, view: APIView) -> list[dict[str, Any]]:
        return [f.schema_parameter() for f in getattr(view, "query_filters", ())]
