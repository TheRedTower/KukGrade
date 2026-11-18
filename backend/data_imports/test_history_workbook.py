"""The synthetic history (data_imports.testing.HISTORY_SHEETS) read end to end.

It has every layout and every kind of slip the real workbook has, with
made-up names; the real workbook never enters this repository.
"""

from __future__ import annotations

import pytest

from data_imports.ksw_adapter import (
    NO_CURRENT_RANK,
    NO_OUTCOME,
    NO_TESTING_FOR_RANK,
    WorkbookParseResult,
    parse_ksw_workbook,
    workbook_checks,
)
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import set_import_row_excluded
from data_imports.testing import HISTORY_SHEETS, history_workbook, legacy_batch
from gradings.legacy_matching import SHEET_NOTE_NAME
from gradings.models import LegacyRecordKind


@pytest.fixture(scope="module")
def history() -> WorkbookParseResult:
    return parse_ksw_workbook(history_workbook())


def test_every_grading_sheet_is_read_and_the_cover_sheet_left_out(
    history: WorkbookParseResult,
) -> None:
    assert history.sheets == ["062025", "122025", "032026", "092026"]
    assert len(history.rows) == 28
    notes = [row for row in history.rows if row.source_name == SHEET_NOTE_NAME]
    assert [row.admin_note for row in notes] == [
        "Grading, June 2025",
        "Ran on: needs more power.",
    ]
    assert history.warnings == [
        "Sheet '062025' has 1 note(s) in no table; each is kept as a note named "
        "'Sheet note'.",
        "Sheet '122025' has 1 note(s) in no table; each is kept as a note named "
        "'Sheet note'.",
        "Sheet '092026' repeats a column of the main table; only the first was read.",
    ]


def test_nothing_written_on_a_grading_sheet_is_lost(
    history: WorkbookParseResult,
) -> None:
    kept: set[str] = set()
    for row in history.rows:
        kept |= {
            row.source_name,
            row.source_current_rank_text,
            row.source_testing_for_rank_text,
            row.source_outcome_text,
            row.comments,
        }
        for line in row.admin_note.split("\n"):
            # A note beside a row says so: "Written beside this row: ...".
            kept |= {line, line.split(": ", 1)[-1]}
    written = {
        str(cell)
        for title, rows in HISTORY_SHEETS.items()
        if title != "Information"
        for row in rows
        if "Name" not in row  # the header row
        for cell in row
        if cell
    }

    assert written - kept == set()


def test_a_note_beside_a_person_or_merged_beside_several_is_on_their_records(
    history: WorkbookParseResult,
) -> None:
    noted = {row.source_name: row.admin_note for row in history.rows if row.admin_note}

    beside = "Written beside this row: Good spirit, talk to parents."
    assert noted["Teo Rowan"] == beside
    merged = "Written beside rows 4 to 6: These three: work on breathing."
    assert [noted["Lena Ash"], noted["Mo Ito"], noted["Ari Lund"]] == [merged] * 3
    # The rest of 092026 is not beside the merged note.
    assert "Theo Rowan" not in noted
    # A side table's own notes stay its record's.
    assert noted["Omar"] == "Away, rang in"
    assert noted["Finn C"] == "Paid?"


def test_the_workbook_checks_name_only_the_exceptions(
    history: WorkbookParseResult,
) -> None:
    checks = workbook_checks(history.rows)

    assert sorted(checks) == sorted(
        [
            "122025!Missing!R2",
            "122025!R3",
            "122025!R4",
            "122025!R5",
            "122025!R6",
            "032026!Did not attend!R2",
            "032026!R3",
            "032026!R4",
            "032026!R5",
            "032026!R6",
            "032026!R7",
        ],
    )
    assert checks["122025!R3"] == [
        NO_CURRENT_RANK,
        "Also listed as missing or not attending on this sheet: “Omar” (row 2). "
        "Check which is right.",
    ]
    assert checks["122025!Missing!R2"] == [
        "Also graded on this sheet: “Omar Haddad” (row 3). Check which is right.",
    ]
    assert checks["122025!R6"] == [NO_CURRENT_RANK, NO_TESTING_FOR_RANK]
    assert checks["032026!R7"] == [
        NO_OUTCOME,
        "Also graded on this sheet: “Kit B” (row 6). If that is the same person "
        "written twice, leave one out.",
    ]
    # One spelling for two people is asked about, never decided.
    assert checks["032026!R4"] == [
        "Also graded on this sheet: “Sam P” (row 5). If that is the same person "
        "written twice, leave one out.",
    ]
    assert checks["032026!Did not attend!R2"] == [
        "Also graded on this sheet: “Fin Cole” (row 3). Check which is right.",
    ]


def test_the_same_name_on_different_sheets_is_not_a_check(
    history: WorkbookParseResult,
) -> None:
    checks = workbook_checks(history.rows)
    ruby = [row for row in history.rows if row.source_name == "Ruby Moss"]

    assert len({row.source_sheet for row in ruby}) == 3
    assert "062025!R8" not in checks
    assert "032026!R9" not in checks


@pytest.mark.django_db
def test_an_upload_keeps_the_checks_as_reasons_to_look() -> None:
    batch = legacy_batch(history_workbook())
    issues = dict(
        ImportRow.objects.filter(batch=batch).values_list("source_locator", "issues"),
    )

    assert NO_CURRENT_RANK in issues["122025!R6"]
    assert NO_OUTCOME in issues["032026!R7"]
    # Kept as written: nothing guessed for the blank outcome.
    row = ImportRow.objects.get(batch=batch, source_locator="032026!R7")
    assert row.raw["outcome"] is None
    assert row.raw["record_kind"] == LegacyRecordKind.GRADING_RESULT


def _issues(batch: ImportBatch, locator: str) -> list[str]:
    return list(ImportRow.objects.get(batch=batch, source_locator=locator).issues)


@pytest.mark.django_db
def test_leaving_out_one_of_a_name_written_twice_ends_the_others_check() -> None:
    batch = legacy_batch(history_workbook())
    rubi = ImportRow.objects.get(batch=batch, source_locator="122025!R5")
    twice = "Also graded on this sheet: “Rubi Moss” (row 5)."

    assert any(issue.startswith(twice) for issue in _issues(batch, "122025!R4"))

    set_import_row_excluded(batch, row_number=rubi.row_number, excluded=True)
    assert not any(issue.startswith(twice) for issue in _issues(batch, "122025!R4"))

    set_import_row_excluded(batch, row_number=rubi.row_number, excluded=False)
    assert any(issue.startswith(twice) for issue in _issues(batch, "122025!R4"))
