"""Test helpers for the paginated API.

Every list endpoint returns a page envelope, so tests unwrap through these
helpers rather than indexing the response directly. Keeping it in one place
means a future change to the envelope updates one function, not every test.
"""

from __future__ import annotations

from typing import Any

# Test-client responses are annotated as Any: the object returned by
# APIClient is Django's monkey-patched WSGI response, which gains .json()
# from the test client rather than from DRF's Response, and django-stubs
# exposes no public type for it.


def page(response: Any) -> dict[str, Any]:
    """Return the full page envelope, asserting its shape."""
    payload: dict[str, Any] = response.json()
    assert set(payload) == {"count", "next", "previous", "results"}, payload
    return payload


def results(response: Any) -> list[Any]:
    """Return just the rows from a paginated list response."""
    rows: list[Any] = page(response)["results"]
    return rows
