"""A history workbook is imported sheet by sheet, and nothing comes in twice.

The workbook grows a sheet each grading, so the whole of it is uploaded
again: each sheet is compared with what KukGrade already holds for its month,
only new sheets are chosen, and a record already held - wherever its row now
is - is never added again. Synthetic workbooks only.
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.ksw_adapter import CanonicalLegacyRow, parse_ksw_workbook
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    NOTHING_TO_IMPORT,
    SheetState,
    choose_legacy_sheets,
    commit_legacy_grading_import,
    legacy_sheets,
    row_counts,
    set_import_row_excluded,
)
from data_imports.testing import GradingSheets, grading_workbook, legacy_batch
from data_imports.tests import admin_user, instructor_user, student_workbook
from gradings.legacy_services import void_legacy_record
from gradings.models import (
    LegacyGradingRecord,
    LegacyRecordKind,
    legacy_content_key,
)

pytestmark = pytest.mark.django_db

BASE = "/api/data-imports/batches/"

JUNE = [
    ["A. Example", "White", "Yellow Stripe", "Pass", "Good."],
    ["B. Second", "White", "Yellow Stripe", "Fail", ""],
]
SEPTEMBER = [["A. Example", "Yellow Stripe", "Yellow", "Pass", ""]]


def admin() -> User:
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user("import-admin@example.com")
    )


def imported(sheets: GradingSheets) -> ImportBatch:
    batch = legacy_batch(grading_workbook(sheets), uploaded_by=admin())
    return commit_legacy_grading_import(batch, actor=admin())


def states(batch: ImportBatch) -> dict[str, tuple[str, bool]]:
    return {sheet.name: (sheet.state, sheet.included) for sheet in legacy_sheets(batch)}


def outcomes(batch: ImportBatch) -> dict[str, str]:
    return dict(
        ImportRow.objects.filter(batch=batch).values_list("source_locator", "outcome"),
    )


def test_a_first_upload_chooses_every_sheet_and_brings_in_every_record() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE, "092025": SEPTEMBER}))

    assert states(batch) == {
        "062025": (SheetState.NEW, True),
        "092025": (SheetState.NEW, True),
    }
    assert set(outcomes(batch).values()) == {ImportRow.Outcome.READY}
    commit_legacy_grading_import(batch, actor=admin())
    assert LegacyGradingRecord.objects.count() == 3


def test_the_same_workbook_again_adds_nothing() -> None:
    first = imported({"062025": JUNE, "092025": SEPTEMBER})
    again = legacy_batch(grading_workbook({"062025": JUNE, "092025": SEPTEMBER}))

    assert states(again) == {
        "062025": (SheetState.IMPORTED, False),
        "092025": (SheetState.IMPORTED, False),
    }
    assert [sheet.held_by for sheet in legacy_sheets(again)] == [[first.pk]] * 2
    with pytest.raises(ValidationError, match="Nothing to import"):
        commit_legacy_grading_import(again, actor=admin())

    # Chosen anyway, every record is already held.
    choose_legacy_sheets(again, included=["062025", "092025"])
    assert set(outcomes(again).values()) == {ImportRow.Outcome.SKIP_EXISTING}
    with pytest.raises(ValidationError, match="Nothing to import"):
        commit_legacy_grading_import(again, actor=admin())
    assert LegacyGradingRecord.objects.count() == 3


def test_a_copy_with_one_more_sheet_brings_in_only_that_sheet() -> None:
    imported({"062025": JUNE})
    december = [["B. Second", "White", "Yellow Stripe", "Pass", "Second try."]]
    grown = legacy_batch(grading_workbook({"062025": JUNE, "122025": december}))

    assert states(grown) == {
        "062025": (SheetState.IMPORTED, False),
        "122025": (SheetState.NEW, True),
    }
    committed = commit_legacy_grading_import(grown, actor=admin())

    assert list(
        LegacyGradingRecord.objects.filter(source_batch=committed).values_list(
            "source_sheet",
            "source_name",
        ),
    ) == [("122025", "B. Second")]
    assert committed.summary_json["sheet_left_out"] == 2
    assert committed.summary_json["total"] == 1


def test_a_row_inserted_in_an_old_sheet_marks_it_changed_and_adds_nothing() -> None:
    imported({"062025": JUNE})
    inserted = [["C. Late", "White", "Yellow Stripe", "Pass", ""], *JUNE]
    copy = legacy_batch(grading_workbook({"062025": inserted, "092025": SEPTEMBER}))

    [june, september] = legacy_sheets(copy)
    assert (june.state, june.included) == (SheetState.CHANGED, False)
    assert (june.added_count, june.removed_count) == (1, 0)
    assert [(record.name, record.outcome) for record in june.added] == [
        ("C. Late", "Pass"),
    ]
    committed = commit_legacy_grading_import(copy, actor=admin())

    assert LegacyGradingRecord.objects.filter(source_batch=committed).count() == 1
    assert september.state == SheetState.NEW


def test_choosing_a_changed_sheet_brings_in_only_what_is_new() -> None:
    imported({"062025": JUNE})
    # The new row moves every other row down: they are known by what they say.
    copy = legacy_batch(
        grading_workbook(
            {"062025": [["C. Late", "White", "Yellow", "Pass", ""], *JUNE]},
        ),
    )

    choose_legacy_sheets(copy, included=["062025"])
    committed = commit_legacy_grading_import(copy, actor=admin())

    assert list(
        LegacyGradingRecord.objects.filter(source_batch=committed).values_list(
            "source_name",
            flat=True,
        ),
    ) == ["C. Late"]
    assert committed.summary_json["skip_existing"] == 2
    # Now KukGrade holds exactly that sheet.
    assert states(legacy_batch(grading_workbook({"062025": [JUNE[0]]}))) == {
        "062025": (SheetState.CHANGED, False),
    }


def test_a_record_changed_in_an_old_sheet_shows_what_it_was_and_what_it_is() -> None:
    imported({"062025": JUNE})
    corrected = [JUNE[0], ["B. Second", "White", "Yellow Stripe", "Pass", ""]]

    [june] = legacy_sheets(legacy_batch(grading_workbook({"062025": corrected})))

    assert june.state == SheetState.CHANGED
    assert [(r.name, r.outcome) for r in june.added] == [("B. Second", "Pass")]
    assert [(r.name, r.outcome) for r in june.removed] == [("B. Second", "Fail")]


def test_rows_that_only_moved_and_a_note_added_beside_one_are_not_a_change() -> None:
    imported({"062025": JUNE})
    moved = [JUNE[1], [], [*JUNE[0], "Written later."]]

    assert states(legacy_batch(grading_workbook({"062025": moved}))) == {
        "062025": (SheetState.IMPORTED, False),
    }


def test_a_record_written_twice_is_held_twice() -> None:
    twice = [JUNE[1], JUNE[1]]
    imported({"062025": twice})
    thrice = legacy_batch(grading_workbook({"062025": [*twice, JUNE[1]]}))

    assert states(thrice) == {"062025": (SheetState.CHANGED, False)}
    choose_legacy_sheets(thrice, included=["062025"])
    assert sorted(outcomes(thrice).values()) == [
        ImportRow.Outcome.READY,
        ImportRow.Outcome.SKIP_EXISTING,
        ImportRow.Outcome.SKIP_EXISTING,
    ]


def test_voided_records_are_not_held_so_their_sheet_is_new_again() -> None:
    imported({"062025": JUNE})
    for record in LegacyGradingRecord.objects.all():
        void_legacy_record(record, reason="Wrong file.", actor=admin())

    again = legacy_batch(grading_workbook({"062025": JUNE}))

    assert states(again) == {"062025": (SheetState.NEW, True)}
    commit_legacy_grading_import(again, actor=admin())
    assert LegacyGradingRecord.objects.filter(is_void=False).count() == 2


def test_an_import_finished_after_another_was_uploaded_is_caught_at_commit() -> None:
    first = legacy_batch(grading_workbook({"062025": JUNE}), uploaded_by=admin())
    second = legacy_batch(grading_workbook({"062025": JUNE}))
    assert states(second) == {"062025": (SheetState.NEW, True)}

    commit_legacy_grading_import(first, actor=admin())

    # Still chosen, but every record is now held: nothing comes in twice.
    assert states(second) == {"062025": (SheetState.IMPORTED, True)}
    with pytest.raises(ValidationError, match="Nothing to import"):
        commit_legacy_grading_import(second, actor=admin())
    # The refusal keeps what it found, so the import's counts say nothing is
    # left to save and the save is not offered again.
    assert outcomes(second) == {
        "062025!R2": ImportRow.Outcome.SKIP_EXISTING,
        "062025!R3": ImportRow.Outcome.SKIP_EXISTING,
    }
    # Any later change checks every row again against what KukGrade holds.
    choose_legacy_sheets(second, included=["062025"])
    assert outcomes(second) == {
        "062025!R2": ImportRow.Outcome.SKIP_EXISTING,
        "062025!R3": ImportRow.Outcome.SKIP_EXISTING,
    }


def test_the_rows_count_what_comes_in_and_what_is_left_out() -> None:
    imported({"062025": JUNE})
    copy = legacy_batch(
        grading_workbook(
            {
                "062025": [*JUNE, ["C. Late", "White", "Yellow", "Pass", ""]],
                "092025": SEPTEMBER,
            },
        ),
    )

    # The changed sheet is not chosen: only September comes in.
    counts = row_counts(copy.rows.all())
    assert (counts["ready"], counts["sheet_left_out"]) == (1, 3)
    choose_legacy_sheets(copy, included=["062025", "092025"])
    counts = row_counts(copy.rows.all())
    # Chosen, the changed sheet brings in only what KukGrade does not hold.
    assert (counts["ready"], counts["skip_existing"]) == (2, 2)


def test_a_row_left_out_stays_out_and_one_on_a_sheet_not_chosen_stays_with_it() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE, "092025": SEPTEMBER}))
    rows = {
        row.source_locator: row.row_number
        for row in ImportRow.objects.filter(batch=batch)
    }
    set_import_row_excluded(batch, row_number=rows["062025!R2"], excluded=True)
    choose_legacy_sheets(batch, included=["062025"])

    assert outcomes(batch) == {
        "062025!R2": ImportRow.Outcome.EXCLUDED,
        "062025!R3": ImportRow.Outcome.READY,
        "092025!R2": ImportRow.Outcome.SHEET_LEFT_OUT,
    }
    set_import_row_excluded(batch, row_number=rows["092025!R2"], excluded=True)
    set_import_row_excluded(batch, row_number=rows["092025!R2"], excluded=False)
    assert outcomes(batch)["092025!R2"] == ImportRow.Outcome.SHEET_LEFT_OUT


def test_choosing_no_sheet_leaves_nothing_to_import() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE}))

    choose_legacy_sheets(batch, included=[])

    with pytest.raises(ValidationError) as refusal:
        commit_legacy_grading_import(batch, actor=admin())
    assert refusal.value.message_dict == {"batch": [NOTHING_TO_IMPORT]}


def test_a_sheet_the_import_does_not_have_cannot_be_chosen() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE}))

    with pytest.raises(ValidationError) as refusal:
        choose_legacy_sheets(batch, included=["062025", "Notes"])

    assert refusal.value.message_dict == {
        "included": ["This import has no grading sheet named 'Notes'."],
    }
    assert states(batch) == {"062025": (SheetState.NEW, True)}


def test_a_roster_has_no_grading_sheets_to_choose() -> None:
    from data_imports.tests import CLEAN_ROW, upload_batch

    roster = upload_batch(content=student_workbook([CLEAN_ROW]))

    assert legacy_sheets(roster) == []
    with pytest.raises(ValidationError, match="not a historical gradings import"):
        choose_legacy_sheets(roster, included=[])


def test_two_sheets_for_one_month_are_refused() -> None:
    with pytest.raises(ValidationError, match="are both for 06/2025"):
        legacy_batch(grading_workbook({"062025": JUNE, "06-2025": SEPTEMBER}))


def test_a_record_is_known_by_what_it_says_not_where_it_is() -> None:
    [row] = parse_ksw_workbook(grading_workbook({"062025": [JUNE[0]]})).rows
    moved = CanonicalLegacyRow(**{**vars(row), "source_locator": "062025!R9"})
    noted = CanonicalLegacyRow(**{**vars(row), "admin_note": "Written beside."})
    other = CanonicalLegacyRow(**{**vars(row), "comments": "Fine."})

    assert legacy_content_key(moved) == legacy_content_key(row)
    assert legacy_content_key(noted) == legacy_content_key(row)
    assert legacy_content_key(other) != legacy_content_key(row)
    imported({"062025": [JUNE[0]]})
    assert LegacyGradingRecord.objects.get().content_key == legacy_content_key(row)


def test_a_note_is_known_by_what_it_says() -> None:
    def note(text: str) -> CanonicalLegacyRow:
        return CanonicalLegacyRow(
            source_sheet="062025",
            source_section="Above the table",
            source_locator="062025!Note!A1",
            cycle_year=2025,
            cycle_month=6,
            record_kind=LegacyRecordKind.AUXILIARY_NOTE,
            source_name="Sheet note",
            admin_note=text,
        )

    assert legacy_content_key(note("One")) != legacy_content_key(note("Two"))


# --- through the API ---------------------------------------------------------


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_an_administrator_reads_and_chooses_the_sheets() -> None:
    imported({"062025": JUNE})
    batch = legacy_batch(grading_workbook({"062025": JUNE, "092025": SEPTEMBER}))
    client = client_for(admin())

    listed = client.get(f"{BASE}{batch.pk}/sheets/")
    chosen = client.patch(
        f"{BASE}{batch.pk}/sheets/",
        {"included": ["062025", "092025"]},
        format="json",
    )

    assert listed.status_code == 200
    assert [
        (sheet["name"], sheet["state"], sheet["state_display"], sheet["included"])
        for sheet in listed.json()
    ] == [
        ("062025", "IMPORTED", "Already imported", False),
        ("092025", "NEW", "New", True),
    ]
    assert listed.json()[1] | {"held_by": []} == {
        "name": "092025",
        "cycle_year": 2025,
        "cycle_month": 9,
        "records": 1,
        "included": True,
        "state": "NEW",
        "state_display": "New",
        "held_by": [],
        "added": [],
        "removed": [],
        "added_count": 0,
        "removed_count": 0,
    }
    assert chosen.status_code == 200
    assert [sheet["included"] for sheet in chosen.json()] == [True, True]
    served = client.get(f"{BASE}{batch.pk}/").json()
    assert served["row_counts"]["skip_existing"] == 2
    assert served["grading_sheets"] == ["062025", "092025"]


def test_choosing_sheets_needs_the_list_of_names() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE}))

    response = client_for(admin()).patch(
        f"{BASE}{batch.pk}/sheets/",
        {"included": "062025"},
        format="json",
    )

    assert response.status_code == 400


def test_an_instructor_can_neither_read_nor_choose_the_sheets() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE}))
    client = client_for(instructor_user())

    assert client.get(f"{BASE}{batch.pk}/sheets/").status_code == 403
    assert (
        client.patch(
            f"{BASE}{batch.pk}/sheets/",
            {"included": []},
            format="json",
        ).status_code
        == 403
    )
    assert APIClient().get(f"{BASE}{batch.pk}/sheets/").status_code in (401, 403)


def test_viewing_imports_reads_the_sheets_but_cannot_choose_them() -> None:
    batch = legacy_batch(grading_workbook({"062025": JUNE}))
    viewer = User.objects.create_user(email="import-viewer@example.com")
    viewer.user_permissions.add(
        Permission.objects.get(
            codename="view_importbatch",
            content_type__app_label="data_imports",
        ),
    )
    client = client_for(viewer)

    assert client.get(f"{BASE}{batch.pk}/sheets/").status_code == 200
    refused = client.patch(
        f"{BASE}{batch.pk}/sheets/",
        {"included": []},
        format="json",
    )
    assert refused.status_code == 403
    assert states(batch) == {"062025": (SheetState.NEW, True)}
