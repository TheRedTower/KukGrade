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
unfiltered list, which looks exactly like a filter that worked. The same
holds for an action that declares its own (`@action(query_filters=...)`),
and for the parameters an action reads with a serializer (`read_query`).

A declared filter with no `apply` is one the view reads itself - grouping
people, say, which is not a filter on a queryset - but it is declared,
documented and refused the same way.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from django.db.models import Q, QuerySet
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.filters import BaseFilterBackend
from rest_framework.request import Request
from rest_framework.views import APIView

type Apply = Callable[[QuerySet[Any], str], QuerySet[Any]]


@dataclass(frozen=True)
class QueryFilter:
    name: str
    # None: the view reads the value itself (see the module docstring).
    apply: Apply | None
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


def in_year(name: str, date_field: str, description: str = "") -> QueryFilter:
    """A calendar year (`2026`), matching dates on any day of it."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if not (value.isdecimal() and len(value) == 4):
            return queryset.none()
        return queryset.filter(**{f"{date_field}__year": int(value)})

    return QueryFilter(name, apply, {"type": "integer"}, description)


def boolean(name: str, condition: Q, description: str = "") -> QueryFilter:
    """`true` keeps the rows `condition` holds for, `false` the others."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        if value == "true":
            return queryset.filter(condition)
        if value == "false":
            return queryset.exclude(condition)
        return queryset.none()

    return QueryFilter(name, apply, {"type": "boolean"}, description)


def read_by_view(
    name: str,
    schema: dict[str, Any] | None = None,
    description: str = "",
) -> QueryFilter:
    """A declared parameter the view reads itself rather than a queryset
    filter: accepted and documented like the rest, applied by nobody here."""
    return QueryFilter(name, None, schema or {"type": "string"}, description)


# Pagination's own parameters (kukgrade/pagination.py) and DRF's format
# override, which every list answers whatever its filters are.
ACCEPTED_ON_EVERY_LIST = frozenset({"page", "page_size", "format"})

_UNDECLARED = "This list cannot be filtered that way."


def refuse_undeclared(params: Collection[str], declared: Collection[str]) -> None:
    """Refuse, naming each, the parameters nobody declared."""
    unknown = sorted(set(params) - set(declared) - ACCEPTED_ON_EVERY_LIST)
    if unknown:
        raise ValidationError({name: [_UNDECLARED] for name in unknown})


def read_query(
    request: Request,
    serializer_class: type[serializers.Serializer[Any]],
) -> dict[str, Any]:
    """The parameters an action needs, read and checked by a serializer -
    which the schema documents too (`extend_schema(parameters=[...])`) - and
    nothing else: an undeclared one is refused as on every list."""
    serializer = serializer_class(data=request.query_params)
    refuse_undeclared(request.query_params, serializer.fields)
    serializer.is_valid(raise_exception=True)
    validated: dict[str, Any] = serializer.validated_data
    return validated


def declares_its_own(view: APIView) -> bool:
    action = getattr(view, "action", None)
    if action == "list":
        return True
    handler = getattr(view, action, None) if action else None
    return "query_filters" in getattr(handler, "kwargs", {})


class DeclaredQueryFilters(BaseFilterBackend):
    """Applies and documents a view's `query_filters`."""

    def filter_queryset(
        self,
        request: Request,
        queryset: QuerySet[Any],
        view: APIView,
    ) -> QuerySet[Any]:
        declared: Sequence[QueryFilter] = getattr(view, "query_filters", ())
        if declares_its_own(view):
            refuse_undeclared(request.query_params, [f.name for f in declared])
        for query_filter in declared:
            value = request.query_params.get(query_filter.name)
            if value and query_filter.apply is not None:
                queryset = query_filter.apply(queryset, value)
        return queryset

    def get_schema_operation_parameters(self, view: APIView) -> list[dict[str, Any]]:
        return [f.schema_parameter() for f in getattr(view, "query_filters", ())]
