"""The OpenAPI schema the frontend generates its types from must stay clean.

A view or serializer drf-spectacular cannot introspect is silently dropped
from the generated schema rather than failing loudly - exactly the kind of
drift the 2026-09-14 decision (generate frontend types, never hand-write
them) exists to prevent. This fails the build the moment that happens,
mirroring `manage.py spectacular --fail-on-warn --validate`.
"""

from __future__ import annotations

import pytest
from drf_spectacular.drainage import GENERATOR_STATS, reset_generator_stats
from drf_spectacular.settings import spectacular_settings
from drf_spectacular.validation import validate_schema

pytestmark = pytest.mark.django_db


def test_openapi_schema_generates_without_warnings_or_errors() -> None:
    reset_generator_stats()
    generator = spectacular_settings.DEFAULT_GENERATOR_CLASS()

    schema = generator.get_schema(request=None, public=True)

    assert not GENERATOR_STATS, (
        "drf-spectacular emitted warnings or errors during schema "
        "generation - run `manage.py spectacular --fail-on-warn` locally "
        "to see them, then fix the view/serializer or add an "
        "ENUM_NAME_OVERRIDES entry."
    )
    validate_schema(schema)  # type: ignore[no-untyped-call]


def test_every_declared_list_filter_is_in_the_schema() -> None:
    # The frontend's filter parameter types are generated from these, so a
    # filter a view applies but the schema omits is one the client cannot use.
    from django.urls import get_resolver

    schema = spectacular_settings.DEFAULT_GENERATOR_CLASS().get_schema(
        request=None,
        public=True,
    )
    documented = {
        operation["operationId"]: {p["name"] for p in operation.get("parameters", [])}
        for path in schema["paths"].values()
        for operation in path.values()
    }

    checked = 0
    for pattern in get_resolver().url_patterns:
        for resolved in getattr(pattern, "url_patterns", []):
            view = getattr(resolved.callback, "cls", None)
            filters = getattr(view, "query_filters", ())
            actions = getattr(resolved.callback, "actions", {}) or {}
            if view is None or not filters or actions.get("get") != "list":
                continue
            names = {f.name for f in filters}
            listed = [ids for op, ids in documented.items() if names <= ids]
            assert listed, f"{view.__name__} filters {sorted(names)} not in the schema"
            checked += 1

    assert checked >= 9
