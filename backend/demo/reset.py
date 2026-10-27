"""Put the demo club back as it was built.

Run on a timer by `manage.py run_demo_resets`, so whatever visitors typed -
good or silly - does not last. The accounts, their sessions, the rank
catalogue and the syllabus are left alone: a visitor who is signed in stays
signed in, and sees the fresh data on the next page they open.
"""

from __future__ import annotations

import time
from graphlib import TopologicalSorter

from django.apps import apps
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.db.models import Model

from demo import seed

# The apps whose tables hold the club's own records. Accounts (people and
# permissions), ranks and syllabus (the catalogue) are deliberately absent.
CLUB_APPS = ("students", "gradings", "audit", "data_imports")


def club_models() -> list[type[Model]]:
    return [
        model
        for label in CLUB_APPS
        for model in apps.get_app_config(label).get_models(include_auto_created=True)
    ]


def club_tables() -> list[str]:
    return [model._meta.db_table for model in club_models()]


def deletion_order() -> list[str]:
    """The club's tables, those that point at others first.

    Some foreign keys are checked at once rather than at the commit (a
    candidate's outcome must match its assessment), so a table is emptied
    only after everything that refers to it. Worked out from the models, so a
    new table cannot be left out of order.
    """
    models = club_models()
    tables = {model: model._meta.db_table for model in models}
    needs: dict[str, set[str]] = {name: set() for name in tables.values()}
    for model in models:
        for field in model._meta.get_fields():
            target = getattr(field, "related_model", None)
            if (
                (
                    getattr(field, "many_to_one", False)
                    or getattr(field, "one_to_one", False)
                )
                and field.concrete
                and target in tables
                and target is not model
            ):
                needs[tables[target]].add(tables[model])
    return list(TopologicalSorter(needs).static_order())


@transaction.atomic
def reset() -> None:
    """Empty the club's tables and build them again, in one transaction.

    Rows are deleted, not truncated: TRUNCATE takes an exclusive lock on every
    table, and a visitor's page that had read one table and was about to read
    the next deadlocked with it (found by loading a running demo, and answered
    with a 500 for them). Deleting takes row locks only, which readers never
    wait on, and the database's foreign keys are checked at the commit, so the
    order of the tables does not matter. Anyone using the demo meanwhile sees
    the old club until the commit and the new one after - never half of it.

    A visitor saving something in the same instant can make this fail (their
    row points at one just removed); the whole reset then rolls back and
    `reset_and_tidy` tries again.
    """
    seed.assert_safe_to_build()
    with connection.cursor() as cursor:
        # The application's own lock order (docs/architecture.md): every
        # grading session first, then students by id. Anyone saving work in
        # the middle of a reset then waits for it instead of deadlocking with
        # it - which is what deleting the assessments first did.
        cursor.execute("SELECT id FROM gradings_gradingsession ORDER BY id FOR UPDATE")
        cursor.execute("SELECT id FROM students_student ORDER BY id FOR UPDATE")
        for table in deletion_order():
            name = connection.ops.quote_name(table)
            cursor.execute(f"DELETE FROM {name}")  # noqa: S608 - our own table names
            # So numbering starts at 1 again, as on a fresh start. Not part of
            # the transaction, which is harmless: a rolled-back reset restarts
            # a counter whose rows are all gone anyway.
            cursor.execute(
                "SELECT setval(pg_get_serial_sequence(%s, 'id'), 1, false) "
                "WHERE pg_get_serial_sequence(%s, 'id') IS NOT NULL",
                [table, table],
            )
    seed.build()


def reset_and_tidy(*, attempts: int = 4) -> float:
    """Reset (trying again if a visitor's save collided with it), then forget
    expired sign-ins. Returns the seconds it took.
    """
    started = time.monotonic()
    for attempt in range(1, attempts + 1):
        try:
            reset()
            break
        except DatabaseError:
            if attempt == attempts:
                raise
            time.sleep(attempt)
    call_command("clearsessions")
    return time.monotonic() - started
