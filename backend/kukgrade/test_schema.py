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
