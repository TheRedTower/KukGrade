"""Stored rows and the batch API (import overhaul A1-A2, decision log 2026-10-20).

A file is read once, at upload, into rows; matching columns, fixing a row and
leaving one out work on those rows, can be left and resumed, and survive a
reload. Synthetic workbooks only.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from typing import Any

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.models import COMMITTED_ROWS_KEPT_FOR, ImportBatch, ImportRow
from data_imports.services import (
    cancel_import_batch,
    commit_legacy_grading_import,
    commit_student_import,
    correct_import_row,
    expire_import_batch,
    save_import_mapping,
    set_import_row_excluded,
)
from data_imports.testing import standard_workbook
from data_imports.tests import (
    CLEAN_ROW,
    STANDARD_MAPPING,
    admin_user,
    instructor_user,
    student_workbook,
    upload_batch,
)
from gradings.models import LegacyGradingRecord
from kukgrade.testing import interleave, page, results
from students.models import Student

pytestmark = pytest.mark.django_db

BASE = "/api/data-imports/batches/"
SECOND = ["206-2-501", "Blair", "Park", "2013-06-02", "Yellow", "ACTIVE"]
BAD_DATE = ["206-2-502", "Casey", "Lee", "not a date", "White", "ACTIVE"]


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def roster(*rows: Sequence[object], admin: User | None = None) -> ImportBatch:
    return upload_batch(content=student_workbook(list(rows)), uploaded_by=admin)


def mapped(*rows: Sequence[object], admin: User | None = None) -> ImportBatch:
    batch = roster(*rows, admin=admin)
    return save_import_mapping(batch, column_mapping=STANDARD_MAPPING)


def outcomes(batch: ImportBatch) -> dict[int, str]:
    return dict(batch.rows.values_list("row_number", "outcome"))


# --- rows are stored once, at upload ---------------------------------------


def test_upload_stores_every_row_as_read_with_dates_as_days() -> None:
    from datetime import date

    batch = roster(["206-2-500", "Alex", "Kim", date(2012, 5, 1), "White", ""])

    row = batch.rows.get()
    assert row.row_number == 2
    assert row.source_locator == "R2"
    assert row.raw["Date of Birth"] == "2012-05-01"
    assert row.raw["WKSA ID"] == "206-2-500"
    assert batch.configuration_json["detected_headers"] == list(
        STANDARD_MAPPING.values(),
    )


def test_a_historical_workbook_stores_each_record_as_ready() -> None:
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "White Belt", "Yellow Stripe", "Pass", "Good."],
                ["B. Example", "Yellow Belt", "Blue Stripe", "Fail", ""],
            ],
        ),
    )

    rows = list(batch.rows.order_by("row_number"))
    assert [row.outcome for row in rows] == ["READY", "READY"]
    assert rows[0].values["name"] == "A. Example"
    assert rows[0].values["report"] == "Good."
    assert rows[0].source_locator.endswith("!R2")


# --- the mapping and checking every row --------------------------------------


def test_matching_columns_checks_and_stores_every_row() -> None:
    batch = mapped(CLEAN_ROW, BAD_DATE)

    assert outcomes(batch) == {2: "READY", 3: "REVIEW_REQUIRED"}
    bad = batch.rows.get(row_number=3)
    assert bad.issues == ["Date of birth 'not a date' could not be parsed."]
    assert bad.values["first_name"] == "Casey"
    assert batch.configuration_json["column_mapping"] == STANDARD_MAPPING


def test_a_fix_is_stored_and_a_null_goes_back_to_the_file() -> None:
    batch = mapped(CLEAN_ROW, BAD_DATE)

    fixed = correct_import_row(
        batch,
        row_number=3,
        changes={"date_of_birth": "2014-02-03"},
    )
    assert fixed.outcome == "READY"
    assert fixed.correction == {"date_of_birth": "2014-02-03"}

    reverted = correct_import_row(batch, row_number=3, changes={"date_of_birth": None})
    assert reverted.outcome == "REVIEW_REQUIRED"
    assert reverted.correction == {}


def test_fixing_one_repeated_id_clears_the_other_row_too() -> None:
    repeat = ["206-2-500", "Blair", "Park", "2013-06-02", "Yellow", "ACTIVE"]
    batch = mapped(CLEAN_ROW, repeat)
    assert outcomes(batch) == {2: "READY", 3: "REVIEW_REQUIRED"}

    correct_import_row(batch, row_number=2, changes={"wksa_id": "206-2-599"})

    assert outcomes(batch) == {2: "READY", 3: "READY"}


def test_a_row_left_out_is_not_a_repeat_and_is_not_imported() -> None:
    repeat = ["206-2-500", "Blair", "Park", "2013-06-02", "Yellow", "ACTIVE"]
    batch = mapped(CLEAN_ROW, repeat)

    left_out = set_import_row_excluded(batch, row_number=2, excluded=True)
    assert left_out.outcome == "EXCLUDED"
    assert outcomes(batch) == {2: "EXCLUDED", 3: "READY"}

    committed = commit_student_import(batch, actor=admin_user("finisher@example.com"))

    assert list(Student.objects.values_list("first_name", flat=True)) == ["Blair"]
    assert committed.summary_json["excluded"] == 1
    back = set_import_row_excluded
    with pytest.raises(ValidationError, match="already imported"):
        back(batch, row_number=2, excluded=False)


def test_bringing_a_row_back_checks_it_again() -> None:
    batch = mapped(CLEAN_ROW)
    set_import_row_excluded(batch, row_number=2, excluded=True)

    assert set_import_row_excluded(batch, row_number=2, excluded=False).outcome == (
        "READY"
    )


def test_a_fix_needs_the_columns_matched_first_and_a_real_row() -> None:
    batch = roster(CLEAN_ROW)

    with pytest.raises(ValidationError, match="Match the file's columns"):
        correct_import_row(batch, row_number=2, changes={"first_name": "Al"})
    save_import_mapping(batch, column_mapping=STANDARD_MAPPING)
    with pytest.raises(ValidationError, match="no such row"):
        correct_import_row(batch, row_number=99, changes={"first_name": "Al"})


def test_historical_rows_are_left_out_but_not_fixed_or_mapped() -> None:
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "White Belt", "Yellow Stripe", "Pass", ""],
                ["B. Example", "White Belt", "Yellow Stripe", "Pass", ""],
            ],
        ),
    )
    with pytest.raises(ValidationError, match="Only a student roster"):
        correct_import_row(batch, row_number=1, changes={"first_name": "A"})
    with pytest.raises(ValidationError, match="Only a student roster"):
        save_import_mapping(batch, column_mapping=STANDARD_MAPPING)

    set_import_row_excluded(batch, row_number=2, excluded=True)
    committed = commit_legacy_grading_import(batch, actor=admin_user("h@example.com"))

    assert list(LegacyGradingRecord.objects.values_list("source_name", flat=True)) == [
        "A. Example",
    ]
    assert committed.summary_json["excluded"] == 1
    first = batch.rows.get(row_number=1)
    assert first.created_id == str(LegacyGradingRecord.objects.get().pk)


# --- finishing, cancelling, expiring, keeping ---------------------------------


def test_finishing_with_no_body_uses_what_is_stored_and_notes_what_each_became() -> (
    None
):
    admin = admin_user()
    batch = mapped(CLEAN_ROW, BAD_DATE, admin=admin)
    correct_import_row(batch, row_number=3, changes={"date_of_birth": "2014-02-03"})

    response = client_for(admin).post(f"{BASE}{batch.pk}/commit/", {}, format="json")

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["status"] == "COMMITTED"
    assert body["next_step"] == "CLOSED"
    assert body["summary_json"]["created"] == 2
    created = {row.row_number: row.created_id for row in batch.rows.all()}
    students = dict(Student.objects.values_list("first_name", "pk"))
    assert created == {2: str(students["Alex"]), 3: str(students["Casey"])}


def test_a_check_after_the_import_is_finished_is_refused() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, admin=admin)
    commit_student_import(batch, actor=admin)

    with pytest.raises(ValidationError, match="already imported"):
        save_import_mapping(batch, column_mapping=STANDARD_MAPPING)
    with pytest.raises(ValidationError, match="already imported"):
        correct_import_row(batch, row_number=2, changes={"first_name": "A"})


def test_cancelling_or_expiring_deletes_the_rows() -> None:
    admin = admin_user()
    cancelled = mapped(CLEAN_ROW, admin=admin)
    cancel_import_batch(cancelled, actor=admin)
    expired = roster(SECOND, admin=admin)
    ImportBatch.objects.filter(pk=expired.pk).update(
        uploaded_at=timezone.now() - timedelta(hours=25),
    )

    assert expire_import_batch(expired.pk, max_age=timedelta(hours=24))

    assert not ImportRow.objects.exists()


def test_a_finished_imports_rows_go_after_they_are_kept_for() -> None:
    admin = admin_user()
    old = mapped(CLEAN_ROW, admin=admin)
    commit_student_import(old, actor=admin)
    recent = mapped(SECOND, admin=admin)
    commit_student_import(recent, actor=admin)
    ImportBatch.objects.filter(pk=old.pk).update(
        committed_at=timezone.now() - COMMITTED_ROWS_KEPT_FOR - timedelta(hours=1),
    )

    call_command("expire_stale_import_batches", "--hours", "24")

    assert not old.rows.exists()
    assert recent.rows.count() == 1


# --- the API -------------------------------------------------------------------


def test_the_list_and_detail_say_where_each_import_is_up_to() -> None:
    admin = admin_user()
    unmatched = roster(CLEAN_ROW, admin=admin)
    reviewing = mapped(CLEAN_ROW, BAD_DATE, admin=admin)
    client = client_for(admin)

    listed = {row["id"]: row for row in results(client.get(BASE))}
    assert listed[unmatched.pk]["next_step"] == "MATCH_COLUMNS"
    assert listed[reviewing.pk]["next_step"] == "REVIEW"
    assert listed[reviewing.pk]["row_counts"] == {
        "total": 2,
        "ready": 1,
        "review_required": 1,
        "skip_existing": 0,
        "excluded": 0,
    }
    assert listed[reviewing.pk]["kind_display"] == "Student roster"
    assert listed[reviewing.pk]["status_display"] == "Uploaded"
    assert listed[reviewing.pk]["column_mapping"] == STANDARD_MAPPING
    assert listed[reviewing.pk]["uploaded_by_name"] == admin.email

    detail = client.get(f"{BASE}{unmatched.pk}/").json()
    assert detail["detected_headers"] == list(STANDARD_MAPPING.values())
    assert detail["row_counts"]["total"] == 1


def test_the_list_filters_by_status_and_kind_and_refuses_anything_else() -> None:
    admin = admin_user()
    batch = roster(CLEAN_ROW, admin=admin)
    client = client_for(admin)

    assert [row["id"] for row in results(client.get(BASE, {"status": "UPLOADED"}))] == [
        batch.pk,
    ]
    assert results(client.get(BASE, {"kind": "LEGACY_GRADINGS"})) == []
    assert client.get(BASE, {"colour": "red"}).status_code == 400


def test_the_list_counts_rows_in_one_query_however_many_imports() -> None:
    admin = admin_user()
    client = client_for(admin)
    mapped(CLEAN_ROW, admin=admin)
    client.get(BASE)  # The permission lookups are cached after the first.
    with CaptureQueriesContext(connection) as one:
        client.get(BASE)
    for _ in range(3):
        mapped(SECOND, BAD_DATE, admin=admin)
    with CaptureQueriesContext(connection) as four:
        client.get(BASE)

    assert len(four.captured_queries) == len(one.captured_queries)


def test_the_rows_come_a_page_at_a_time_filtered_and_searched() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, SECOND, BAD_DATE, admin=admin)
    client = client_for(admin)
    url = f"{BASE}{batch.pk}/rows/"

    first = page(client.get(url, {"page_size": 2}))
    assert first["count"] == 3
    assert [row["row_number"] for row in first["results"]] == [2, 3]
    review = results(client.get(url, {"outcome": "REVIEW_REQUIRED"}))
    assert [row["row_number"] for row in review] == [4]
    assert review[0]["issues"] == ["Date of birth 'not a date' could not be parsed."]
    assert review[0]["outcome_display"] == "Needs attention"
    assert [
        row["row_number"] for row in results(client.get(url, {"search": "blair"}))
    ] == [
        3,
    ]
    assert results(client.get(url, {"outcome": "NOPE"})) == []
    assert client.get(url, {"kind": "STUDENT_ROSTER"}).status_code == 400


def test_the_api_matches_columns_fixes_a_row_and_leaves_one_out() -> None:
    admin = admin_user()
    batch = roster(CLEAN_ROW, BAD_DATE, admin=admin)
    client = client_for(admin)

    matched = client.post(
        f"{BASE}{batch.pk}/mapping/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )
    assert matched.status_code == 200
    assert matched.json()["row_counts"]["review_required"] == 1

    fixed = client.patch(
        f"{BASE}{batch.pk}/rows/3/",
        {"date_of_birth": "2014-02-03"},
        format="json",
    )
    assert fixed.status_code == 200
    assert fixed.json()["outcome"] == "READY"
    assert fixed.json()["corrected_fields"] == ["date_of_birth"]

    left_out = client.post(
        f"{BASE}{batch.pk}/rows/2/exclusion/",
        {"excluded": True},
        format="json",
    )
    assert left_out.status_code == 200
    assert left_out.json()["outcome"] == "EXCLUDED"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"column_mapping": {"wksa_id": "WKSA ID"}}, "column_mapping"),
        ({"column_mapping": {**STANDARD_MAPPING, "colour": "X"}}, "column_mapping"),
    ],
)
def test_an_incomplete_or_unknown_mapping_is_refused(
    body: dict[str, Any],
    field: str,
) -> None:
    admin = admin_user()
    batch = roster(CLEAN_ROW, admin=admin)

    response = client_for(admin).post(f"{BASE}{batch.pk}/mapping/", body, format="json")

    assert response.status_code == 400
    assert field in response.json()["error"]["fields"]


def test_an_empty_fix_is_refused() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, admin=admin)

    response = client_for(admin).patch(f"{BASE}{batch.pk}/rows/2/", {}, format="json")

    assert response.status_code == 400


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("get", "", None),
        ("get", "{id}/", None),
        ("get", "{id}/rows/", None),
        ("post", "{id}/mapping/", {"column_mapping": STANDARD_MAPPING}),
        ("patch", "{id}/rows/2/", {"first_name": "Al"}),
        ("post", "{id}/rows/2/exclusion/", {"excluded": True}),
    ],
)
def test_instructors_cannot_reach_any_of_it(
    method: str,
    suffix: str,
    body: dict[str, Any] | None,
) -> None:
    batch = mapped(CLEAN_ROW)
    client = client_for(instructor_user())

    response = getattr(client, method)(
        BASE + suffix.format(id=batch.pk),
        body,
        format="json",
    )

    assert response.status_code == 403


# --- a fix racing the finish -------------------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
def test_a_fix_made_while_the_import_finishes_waits_and_is_refused() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, admin=admin)

    finished, fixed = interleave(
        lambda: commit_student_import(
            ImportBatch.objects.get(pk=batch.pk), actor=admin
        ),
        lambda: correct_import_row(
            ImportBatch.objects.get(pk=batch.pk),
            row_number=2,
            changes={"first_name": "Changed"},
        ),
        pause_first_at="data_imports.services.record",
    )

    assert isinstance(finished, ImportBatch)
    assert isinstance(fixed, ValidationError), fixed
    assert "already imported" in " ".join(fixed.messages)
    assert Student.objects.get().first_name == "Alex"
