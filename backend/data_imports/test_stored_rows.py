"""Stored rows and the batch API.

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
    assert rows[0].values["section"] == ""
    assert rows[0].values["note"] == ""
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


def test_a_mapping_to_an_unknown_field_is_refused() -> None:
    admin = admin_user()
    batch = roster(CLEAN_ROW, admin=admin)

    response = client_for(admin).post(
        f"{BASE}{batch.pk}/mapping/",
        {"column_mapping": {**STANDARD_MAPPING, "colour": "X"}},
        format="json",
    )

    assert response.status_code == 400
    assert "column_mapping" in response.json()["error"]["fields"]


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


def test_finishing_costs_the_same_queries_for_two_rows_as_for_forty() -> None:
    def roster_of(count: int, start: int) -> list[list[object]]:
        return [
            [
                f"206-2-{start + index:03d}",
                "Alex",
                f"Kim{index}",
                "2012-05-01",
                "White",
                "",
            ]
            for index in range(count)
        ]

    admin = admin_user()
    small = mapped(*roster_of(2, 0), admin=admin)
    large = mapped(*roster_of(40, 100), admin=admin)

    with CaptureQueriesContext(connection) as few:
        commit_student_import(small, actor=admin)
    with CaptureQueriesContext(connection) as many:
        commit_student_import(large, actor=admin)

    assert Student.objects.count() == 42
    assert len(many.captured_queries) == len(few.captured_queries)


def test_a_historical_import_finishes_in_the_same_queries_however_many_records() -> (
    None
):
    def workbook(count: int) -> bytes:
        return standard_workbook(
            [
                [f"Person {index}", "White", "Yellow", "Pass", ""]
                for index in range(count)
            ],
        )

    admin = admin_user()
    small = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=workbook(2),
        uploaded_by=admin,
    )
    large = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=workbook(40),
        uploaded_by=admin,
    )

    with CaptureQueriesContext(connection) as few:
        commit_legacy_grading_import(small, actor=admin)
    with CaptureQueriesContext(connection) as many:
        commit_legacy_grading_import(large, actor=admin)

    assert LegacyGradingRecord.objects.count() == 42
    assert len(many.captured_queries) == len(few.captured_queries)
    assert all(row.created_id for row in large.rows.all())


@pytest.mark.parametrize("action", ["preview", "mapping"])
def test_viewing_imports_is_not_enough_to_check_or_change_one(action: str) -> None:
    """A check stores the mapping and fixes it is sent, so it needs the
    permission matching columns does, not only the permission to look."""
    from django.contrib.auth.models import Permission

    batch = roster(CLEAN_ROW)
    viewer = User.objects.create_user(email="import-viewer@example.com")
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="data_imports",
            codename="view_importbatch",
        ),
    )
    client = client_for(viewer)

    assert client.get(f"{BASE}{batch.pk}/rows/").status_code == 200
    response = client.post(
        f"{BASE}{batch.pk}/{action}/",
        {"column_mapping": STANDARD_MAPPING},
        format="json",
    )

    assert response.status_code == 403
    assert (
        "column_mapping" not in ImportBatch.objects.get(pk=batch.pk).configuration_json
    )


# --- what the screens show: the file's own cells, and rows by rank spelling ---


def test_a_roster_row_serves_its_cells_and_each_field_as_the_file_has_it() -> None:
    admin = admin_user()
    batch = mapped(BAD_DATE, admin=admin)
    correct_import_row(batch, row_number=2, changes={"date_of_birth": "2012-05-01"})

    (served,) = results(client_for(admin).get(f"{BASE}{batch.pk}/rows/"))

    assert served["cells"] == dict(
        zip(STANDARD_MAPPING.values(), BAD_DATE, strict=True)
    )
    assert served["file_values"]["date_of_birth"] == "not a date"
    assert served["values"]["date_of_birth"] == "2012-05-01"
    assert served["corrected_fields"] == ["date_of_birth"]


def test_a_historical_import_names_the_grading_sheets_it_read() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook([["A. Example", "White Belt", "Yellow", "Pass", ""]]),
        uploaded_by=admin,
    )

    served = client_for(admin).get(f"{BASE}{batch.pk}/").json()

    assert served["grading_sheets"] == ["06-2025"]
    assert served["warnings"] == []


def test_a_historical_row_serves_no_cells() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook([["A. Example", "White Belt", "Yellow", "Pass", ""]]),
        uploaded_by=admin,
    )

    (served,) = results(client_for(admin).get(f"{BASE}{batch.pk}/rows/"))

    assert served["cells"] == {}
    assert served["file_values"] == {}


def test_historical_rows_can_be_listed_by_a_rank_spelling_held_or_tested_for() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "Brn stripe", "Brown", "Pass", ""],
                ["B. Example", "Red Belt", "brn STRIPE", "Pass", ""],
                ["C. Example", "White Belt", "Yellow", "Pass", ""],
            ],
        ),
        uploaded_by=admin,
    )
    client = client_for(admin)

    served = results(client.get(f"{BASE}{batch.pk}/rows/", {"rank_text": "Brn stripe"}))

    assert [row["values"]["name"] for row in served] == ["A. Example", "B. Example"]
    assert results(client.get(f"{BASE}{batch.pk}/rows/", {"rank_text": "Purple"})) == []


def test_rows_can_be_listed_by_whether_the_importer_fixed_them() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, BAD_DATE, admin=admin)
    correct_import_row(batch, row_number=3, changes={"date_of_birth": "2012-05-01"})
    client = client_for(admin)

    fixed = results(client.get(f"{BASE}{batch.pk}/rows/", {"corrected": "true"}))
    untouched = results(client.get(f"{BASE}{batch.pk}/rows/", {"corrected": "false"}))

    assert [row["row_number"] for row in fixed] == [3]
    assert [row["row_number"] for row in untouched] == [2]
    assert results(client.get(f"{BASE}{batch.pk}/rows/", {"corrected": "x"})) == []


def test_the_import_list_takes_several_statuses() -> None:
    admin = admin_user()
    open_one = roster(CLEAN_ROW, admin=admin)
    finished = mapped(CLEAN_ROW, admin=admin)
    commit_student_import(finished, actor=admin)

    listed = results(
        client_for(admin).get(BASE, {"status": "COMMITTED,CANCELLED,EXPIRED"}),
    )

    assert [batch["id"] for batch in listed] == [finished.pk]
    assert open_one.pk not in [batch["id"] for batch in listed]


# --- what the matching and review screens need --------------------------------


def test_a_roster_import_serves_its_fields_and_suggested_columns() -> None:
    admin = admin_user()
    batch = roster(CLEAN_ROW, admin=admin)

    served = client_for(admin).get(f"{BASE}{batch.pk}/").json()

    assert served["suggested_mapping"] == STANDARD_MAPPING
    assert [field["field"] for field in served["target_fields"]] == list(
        STANDARD_MAPPING
    )
    status = next(
        field for field in served["target_fields"] if field["field"] == "status"
    )
    rank = next(f for f in served["target_fields"] if f["field"] == "current_rank")
    assert status == {
        "field": "status",
        "name": "Status",
        "needed": False,
        "whole_file": True,
    }
    assert rank["needed"] and rank["whole_file"]
    assert served["rank_mappings"] == {}


def test_a_historical_import_serves_the_ranks_chosen_for_its_spellings() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook([["A. Example", "Brn stripe", "Brown", "Pass", ""]]),
        uploaded_by=admin,
    )
    client = client_for(admin)
    client.post(
        f"{BASE}{batch.pk}/preview/",
        {"rank_mappings": {"Brn stripe": "BROWN_STRIPE"}},
        format="json",
    )

    served = client.get(f"{BASE}{batch.pk}/").json()

    assert served["rank_mappings"] == {"brn stripe": "BROWN_STRIPE"}
    assert served["target_fields"] == [] and served["suggested_mapping"] == {}


def test_every_row_needing_attention_can_be_left_out_at_once() -> None:
    admin = admin_user()
    batch = mapped(CLEAN_ROW, BAD_DATE, admin=admin)
    client = client_for(admin)

    served = client.post(f"{BASE}{batch.pk}/rows/leave-out-attention/").json()

    assert served["row_counts"]["review_required"] == 0
    assert served["row_counts"]["excluded"] == 1
    assert outcomes(batch) == {2: "READY", 3: "EXCLUDED"}
    commit_student_import(batch, actor=admin)
    assert Student.objects.count() == 1


def test_leaving_out_the_rest_needs_permission_and_an_open_import() -> None:
    admin = admin_user()
    batch = mapped(BAD_DATE, admin=admin)

    refused = client_for(instructor_user()).post(
        f"{BASE}{batch.pk}/rows/leave-out-attention/",
    )

    assert refused.status_code in {403, 404}
    assert outcomes(batch) == {2: "REVIEW_REQUIRED"}


def test_a_row_names_the_fields_its_issues_are_about() -> None:
    admin = admin_user()
    twin = ["206-2-500", "Alex", "Kim", "2012-05-01", "Purple", "ACTIVE"]
    batch = mapped(CLEAN_ROW, BAD_DATE, twin, admin=admin)

    served = {
        row["row_number"]: row
        for row in results(client_for(admin).get(f"{BASE}{batch.pk}/rows/"))
    }

    assert served[2]["issue_fields"] == []
    assert served[3]["issue_fields"] == ["date_of_birth"]
    assert served[4]["issue_fields"] == ["current_rank", "wksa_id"]


def test_historical_records_worth_a_look_say_why_and_follow_the_rank_choices() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "White Belt", "Yellow Stripe", "Pass", ""],
                ["B. Example", "Red Belt", "Brn stripe", "Pass", ""],
                ["C. Example", "Blue Belt", "Red stripe?", "Maybe", ""],
            ],
        ),
        uploaded_by=admin,
    )
    client = client_for(admin)
    # Before any rank is chosen, every rank written is still to match.
    assert batch.rows.get(row_number=1).issues == [
        "Rank 'White Belt' is not matched to a KukGrade rank yet.",
        "Rank 'Yellow Stripe' is not matched to a KukGrade rank yet.",
    ]

    preview = client.post(
        f"{BASE}{batch.pk}/preview/",
        {
            "rank_mappings": {
                "White Belt": "WHITE",
                "Yellow Stripe": "YELLOW_STRIPE",
                "Red Belt": "RED",
                "Blue Belt": "BLUE",
                "Red stripe?": "RED_STRIPE",
            },
        },
        format="json",
    ).json()

    served = results(client.get(f"{BASE}{batch.pk}/rows/", {"worth_a_look": "true"}))
    assert {row["row_number"]: row["issues"] for row in served} == {
        2: ["Rank 'Brn stripe' is not matched to a KukGrade rank yet."],
        3: [
            "The workbook marks rank 'Red stripe?' as uncertain.",
            "Outcome 'Maybe' is not one KukGrade knows.",
        ],
    }
    assert preview["worth_a_look"] == 2
    # A record left out still shows among them, but is no longer counted.
    set_import_row_excluded(batch, row_number=3, excluded=True)
    again = client.post(f"{BASE}{batch.pk}/preview/", {}, format="json").json()
    assert again["worth_a_look"] == 1
    assert (
        len(results(client.get(f"{BASE}{batch.pk}/rows/", {"worth_a_look": "true"})))
        == 2
    )
    fine = results(client.get(f"{BASE}{batch.pk}/rows/", {"worth_a_look": "false"}))
    assert [row["row_number"] for row in fine] == [1]


def test_historical_rows_can_be_listed_by_kind() -> None:
    admin = admin_user()
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "White Belt", "Yellow Stripe", "Pass", ""],
                ["B. Example", "Red Belt", "", "DNA", ""],
            ],
        ),
        uploaded_by=admin,
    )
    client = client_for(admin)

    def listed(kinds: str) -> list[int]:
        served = results(client.get(f"{BASE}{batch.pk}/rows/", {"record_kind": kinds}))
        return [row["row_number"] for row in served]

    assert listed("GRADING_RESULT") == [1]
    assert listed("DID_NOT_ATTEND,AUXILIARY_NOTE") == [2]
    assert listed("SOMETHING") == []


def test_roster_rows_can_be_listed_by_a_value_kukgrade_gave_them() -> None:
    admin = admin_user()
    no_status = ["206-2-501", "Blair", "Park", "2013-06-02", "", ""]
    no_rank = ["206-2-502", "Casey", "Lee", "2013-06-02", "", "ACTIVE"]
    batch = save_import_mapping(
        roster(CLEAN_ROW, no_status, no_rank, admin=admin),
        column_mapping=STANDARD_MAPPING,
        defaults={"current_rank": "White"},
    )
    client = client_for(admin)

    def filled(field: str) -> list[int]:
        served = results(client.get(f"{BASE}{batch.pk}/rows/", {"filled": field}))
        return [row["row_number"] for row in served]

    assert filled("status") == [3]
    assert filled("current_rank") == [3, 4]
    # A value typed in is the importer's, not KukGrade's.
    correct_import_row(batch, row_number=3, changes={"status": "INACTIVE"})
    assert filled("status") == []
    assert filled("first_name") == []
