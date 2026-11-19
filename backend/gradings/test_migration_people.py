"""The migration that gave records already saved their people
(gradings.0004_legacy_people), run on records saved before it."""

from __future__ import annotations

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("gradings", "0003_legacy_record_content_key")]
AFTER = [("gradings", "0004_legacy_people")]


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_records_saved_before_people_are_grouped_into_people() -> None:
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    old = executor.loader.project_state(BEFORE).apps
    batch_model = old.get_model("data_imports", "ImportBatch")
    record_model = old.get_model("gradings", "LegacyGradingRecord")
    rank_model = old.get_model("ranks", "Rank")
    user_model = old.get_model("accounts", "User")
    uploader = user_model.objects.create(email="migration@example.com")
    batch = batch_model.objects.create(
        kind="LEGACY_GRADINGS",
        status="COMMITTED",
        original_filename="history.xlsx",
        sha256="0" * 64,
        file_size=1,
        uploaded_by=uploader,
    )
    ranks = {rank.code: rank for rank in rank_model.objects.all()}
    for number, (sheet, month, name, held, testing) in enumerate(
        [
            ("062025", 6, "Theo R", "WHITE", "YELLOW_STRIPE"),
            ("122025", 12, "Theo Rowan", "YELLOW_STRIPE", "YELLOW"),
            ("122025", 12, "Ada Park", "WHITE", "YELLOW_STRIPE"),
            ("122025", 12, "Sheet note", None, None),
        ],
        start=2,
    ):
        record_model.objects.create(
            source_batch=batch,
            record_kind="GRADING_RESULT",
            source_sheet=sheet,
            source_locator=f"{sheet}!R{number}",
            cycle_year=2025,
            cycle_month=month,
            source_name=name,
            current_rank=ranks[held] if held else None,
            testing_for_rank=ranks[testing] if testing else None,
            outcome="PASS" if held else None,
            content_key=f"{number:064d}",
        )

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(AFTER)
    new = executor.loader.project_state(AFTER).apps
    records = new.get_model("gradings", "LegacyGradingRecord").objects.order_by("pk")
    people = [record_.person_id for record_ in records]

    assert people[0] == people[1]  # Theo R, then Theo Rowan
    assert people[2] not in {people[0], None}
    assert people[3] is None  # a sheet note is no one
    assert new.get_model("gradings", "LegacyPerson").objects.count() == 2

    # Leave the database as every other test expects it.
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes())
