"""Test helpers shared across apps.

Every list endpoint returns a page envelope, so tests unwrap through `page`
and `results` rather than indexing the response directly. Keeping it in one
place means a future change to the envelope updates one function, not every
test. `interleave` forces the schedule a cross-operation race test needs.
"""

from __future__ import annotations

import pkgutil
import threading
import time
from collections.abc import Callable
from typing import Any
from unittest.mock import patch

from django.db import connection

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


def _waiting_on_lock(backend_pid: int | None) -> bool:
    if backend_pid is None:
        return False
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s",
            [backend_pid],
        )
        row = cursor.fetchone()
    return row is not None and row[0] == "Lock"


def interleave(
    first: Callable[[], object],
    second: Callable[[], object],
    *,
    pause_first_at: str,
) -> tuple[object | BaseException, object | BaseException]:
    """Force the one schedule a cross-operation race needs.

    `first` runs until it calls `pause_first_at` - the audit `record()` its
    service calls after taking its locks, reading what it validates and
    writing its change, but before it commits - and is held there. `second`
    then starts. `first` is released once `second` has either finished or is
    seen waiting on a lock in pg_stat_activity.

    Under the lock protocol `second` has to wait, and then runs against what
    `first` committed. Without it, `second` runs straight through against
    the state `first` is about to change - the interleaving each test below
    asserts can no longer happen. The hold is an Event and the poll only
    observes whether `second` is blocked yet: no sleep decides the order.
    """
    real = pkgutil.resolve_name(pause_first_at)
    reached = threading.Event()
    release = threading.Event()
    results: list[object | BaseException] = [None, None]
    second_backend: list[int] = []
    threads: list[threading.Thread] = []

    def pausing(*args: object, **kwargs: object) -> object:
        if threading.current_thread() is threads[0] and not reached.is_set():
            reached.set()
            if not release.wait(timeout=15):
                raise TimeoutError(f"{pause_first_at} was never released")
        return real(*args, **kwargs)

    def run(index: int, target: Callable[[], object]) -> None:
        try:
            if index == 1:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    row = cursor.fetchone()
                    assert row is not None
                    second_backend.append(row[0])
            results[index] = target()
        except BaseException as exc:
            results[index] = exc
        finally:
            connection.close()

    threads.append(threading.Thread(target=run, args=(0, first)))
    threads.append(threading.Thread(target=run, args=(1, second)))
    with patch(pause_first_at, side_effect=pausing):
        threads[0].start()
        while not reached.wait(timeout=0.01):
            if not threads[0].is_alive():
                break
        assert reached.is_set(), f"never reached {pause_first_at}: {results[0]!r}"
        threads[1].start()
        deadline = time.monotonic() + 15
        while (
            threads[1].is_alive()
            and not _waiting_on_lock(second_backend[0] if second_backend else None)
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        release.set()
        for thread in threads:
            thread.join(timeout=20)
    assert not any(thread.is_alive() for thread in threads), "a thread never finished"
    return results[0], results[1]


def render_admin_pages(settings: Any) -> None:
    """Let admin pages render in a test, and serve them: the network app does
    not mount the admin (kukgrade.urls_admin does), and the pages' templates
    resolve hashed static files, which need collectstatic. Call with pytest's
    `settings` fixture."""
    settings.ROOT_URLCONF = "kukgrade.urls_admin"
    settings.STORAGES = {
        **settings.STORAGES,
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        },
    }
