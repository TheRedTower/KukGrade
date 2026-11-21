"""The KSW workbook adapter - synthetic fixtures only.

Never the real historical workbook - every workbook
here is built in-memory from made-up names and values.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest
from openpyxl.workbook import Workbook

from data_imports.ksw_adapter import (
    MAX_INFORMATION_LINES,
    MAX_NOTE_ROWS,
    NO_CURRENT_RANK,
    NO_OUTCOME,
    NO_TESTING_FOR_RANK,
    CanonicalLegacyRow,
    WorkbookStructureError,
    names_not_checked,
    parse_ksw_workbook,
    workbook_checks,
)
from data_imports.testing import MAIN_TABLE_HEADER, standard_workbook, workbook_bytes
from gradings.models import LegacyAttendance, LegacyOutcome, LegacyRecordKind


def test_the_information_sheet_holds_no_records_and_is_kept_as_the_key() -> None:
    content = standard_workbook([["A. Example", "White", "Yellow Stripe", "Pass", ""]])
    result = parse_ksw_workbook(content)

    assert all(row.source_sheet != "Information" for row in result.rows)
    assert not any("Information" in warning for warning in result.warnings)
    assert result.information == [
        ["This workbook contains historical grading records."],
    ]


def test_the_key_keeps_each_line_with_text_and_its_cells_as_written() -> None:
    def build(workbook: Workbook) -> None:
        info = workbook.create_sheet(" Information ")
        info.append(["Key"])
        info.append([])
        info.append(["Conditional", None, "  The school owner decides. "])
        workbook.create_sheet("062025").append(MAIN_TABLE_HEADER)

    result = parse_ksw_workbook(workbook_bytes(build))

    assert result.information == [
        ["Key"],
        ["Conditional", "The school owner decides."],
    ]


def test_a_cover_sheet_too_long_to_be_a_key_is_not_kept() -> None:
    def build(workbook: Workbook) -> None:
        info = workbook.create_sheet("Information")
        for line in range(MAX_INFORMATION_LINES + 1):
            info.append([f"Line {line}"])
        workbook.create_sheet("062025").append(MAIN_TABLE_HEADER)

    result = parse_ksw_workbook(workbook_bytes(build))

    assert result.information == []
    assert result.warnings == [
        "The Information sheet is longer than a cover sheet, so it is not kept "
        "as the workbook's key.",
    ]


def test_valid_cycle_sheet_derives_year_and_month() -> None:
    content = standard_workbook(
        [["A. Example", "White", "Yellow Stripe", "Pass", ""]],
        sheet="03-2026",
    )
    result = parse_ksw_workbook(content)

    assert len(result.rows) == 1
    assert result.rows[0].cycle_year == 2026
    assert result.rows[0].cycle_month == 3
    assert result.rows[0].source_sheet == "03-2026"


def test_standard_main_table_parses_all_five_columns() -> None:
    content = standard_workbook(
        [["A. Example", "Yellow Belt", "Blue Stripe", "Pass", "Good form"]],
    )
    result = parse_ksw_workbook(content)

    row = result.rows[0]
    assert row.source_name == "A. Example"
    assert row.source_current_rank_text == "Yellow Belt"
    assert row.source_testing_for_rank_text == "Blue Stripe"
    assert row.source_outcome_text == "Pass"
    assert row.outcome == LegacyOutcome.PASS
    assert row.comments == "Good form"
    assert row.record_kind == LegacyRecordKind.GRADING_RESULT
    assert row.attendance_status == LegacyAttendance.ATTENDED
    assert row.source_locator.startswith("06-2025!R")


def test_blank_rows_within_the_main_table_do_not_stop_parsing() -> None:
    content = standard_workbook(
        [
            ["A. Example", "White", "Yellow Stripe", "Pass", ""],
            [None, None, None, None, None],
            ["B. Second", "White", "Yellow Stripe", "Fail", ""],
        ],
    )
    result = parse_ksw_workbook(content)

    names = [row.source_name for row in result.rows]
    assert names == ["A. Example", "B. Second"]


def test_auxiliary_section_after_the_main_table_is_captured() -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(MAIN_TABLE_HEADER)
        ws.append(["A. Example", "White", "Yellow Stripe", "Pass", ""])
        ws.append([None])
        ws.append(["Missing"])
        ws.append(["C. Third", "Left message with parent"])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    grading_kind = LegacyRecordKind.GRADING_RESULT
    aux_kind = LegacyRecordKind.AUXILIARY_NOTE
    main_rows = [r for r in result.rows if r.record_kind == grading_kind]
    aux_rows = [r for r in result.rows if r.record_kind == aux_kind]
    assert len(main_rows) == 1
    assert len(aux_rows) == 1
    assert aux_rows[0].source_name == "C. Third"
    assert aux_rows[0].source_section == "Missing"
    assert aux_rows[0].admin_note == "Left message with parent"


@pytest.mark.parametrize("section_name", ["Unaccounted", "Missing", "Current belt"])
def test_each_known_auxiliary_section_is_recognised(section_name: str) -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(MAIN_TABLE_HEADER)
        ws.append([section_name])
        ws.append(["D. Fourth", "some note"])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    assert len(result.rows) == 1
    assert result.rows[0].record_kind == LegacyRecordKind.AUXILIARY_NOTE
    assert result.rows[0].source_section == section_name


def test_did_not_attend_section_produces_did_not_attend_record_kind() -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(MAIN_TABLE_HEADER)
        ws.append(["Did not attend"])
        ws.append(["E. Fifth"])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.record_kind == LegacyRecordKind.DID_NOT_ATTEND
    assert row.attendance_status == LegacyAttendance.DID_NOT_ATTEND
    assert row.outcome is None


def test_dna_in_the_main_outcome_column_is_did_not_attend_not_fail() -> None:
    content = standard_workbook([["F. Sixth", "White", "Yellow Stripe", "DNA", ""]])
    result = parse_ksw_workbook(content)

    row = result.rows[0]
    assert row.record_kind == LegacyRecordKind.DID_NOT_ATTEND
    assert row.attendance_status == LegacyAttendance.DID_NOT_ATTEND
    assert row.outcome is None
    assert row.outcome != LegacyOutcome.FAIL


def test_unknown_non_empty_sheet_produces_a_warning() -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("Notes")
        ws.append(["Something unrelated"])
        main = workbook.create_sheet("06-2025")
        main.append(MAIN_TABLE_HEADER)
        main.append(["A. Example", "White", "Yellow Stripe", "Pass", ""])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    assert any("Notes" in warning for warning in result.warnings)
    assert all(row.source_sheet != "Notes" for row in result.rows)


def test_unknown_empty_sheet_produces_no_warning() -> None:
    def build(workbook: Workbook) -> None:
        workbook.create_sheet("Blank Sheet")
        main = workbook.create_sheet("06-2025")
        main.append(MAIN_TABLE_HEADER)
        main.append(["A. Example", "White", "Yellow Stripe", "Pass", ""])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    assert not any("Blank Sheet" in warning for warning in result.warnings)


def test_duplicate_source_locator_is_rejected() -> None:
    # Two cycle sheets sharing the same title would produce identical
    # locators for their first data row - openpyxl silently renames a
    # duplicate sheet title, so simulate the collision directly instead.
    from data_imports.ksw_adapter import CanonicalLegacyRow, _check_locators_unique

    rows = [
        CanonicalLegacyRow(
            source_sheet="06-2025",
            source_section="",
            source_locator="06-2025!R2",
            cycle_year=2025,
            cycle_month=6,
            record_kind=LegacyRecordKind.GRADING_RESULT,
            source_name="A",
        ),
        CanonicalLegacyRow(
            source_sheet="06-2025",
            source_section="",
            source_locator="06-2025!R2",
            cycle_year=2025,
            cycle_month=6,
            record_kind=LegacyRecordKind.GRADING_RESULT,
            source_name="B",
        ),
    ]
    with pytest.raises(WorkbookStructureError, match="lists the same row twice"):
        _check_locators_unique(rows)


def test_comments_with_line_breaks_are_preserved() -> None:
    content = standard_workbook(
        [["A. Example", "White", "Yellow Stripe", "Pass", "Line one\nLine two"]],
    )
    result = parse_ksw_workbook(content)

    assert result.rows[0].comments == "Line one\nLine two"


def test_empty_comments_are_an_empty_string_not_none() -> None:
    row: list[object] = ["A. Example", "White", "Yellow Stripe", "Pass", None]
    content = standard_workbook([row])
    result = parse_ksw_workbook(content)

    assert result.rows[0].comments == ""


def test_free_form_outcome_is_preserved_unresolved() -> None:
    content = standard_workbook(
        [["A. Example", "White", "Yellow Stripe", "Testing? JKN Example: No", ""]],
    )
    result = parse_ksw_workbook(content)

    row = result.rows[0]
    assert row.source_outcome_text == "Testing? JKN Example: No"
    assert row.outcome is None
    assert row.record_kind == LegacyRecordKind.GRADING_RESULT


def test_na_outcome_is_preserved_unresolved_not_an_outcome() -> None:
    content = standard_workbook([["A. Example", "White", "Yellow Stripe", "N/A", ""]])
    result = parse_ksw_workbook(content)

    row = result.rows[0]
    assert row.source_outcome_text == "N/A"
    assert row.outcome is None


def test_uncertain_rank_with_question_mark_is_preserved_verbatim_unresolved() -> None:
    content = standard_workbook(
        [["A. Example", "White", "Blue Stripe?", "Pass", ""]],
    )
    result = parse_ksw_workbook(content)

    row = result.rows[0]
    assert row.source_testing_for_rank_text == "Blue Stripe?"
    # The adapter never resolves ranks - that is an explicit admin review
    # step (rank review workflow), not a parser step.


def test_typo_like_rank_text_is_preserved_verbatim() -> None:
    content = standard_workbook([["A. Example", "White", "DNB", "Pass", ""]])
    result = parse_ksw_workbook(content)

    assert result.rows[0].source_testing_for_rank_text == "DNB"


def test_abbreviated_and_duplicate_names_are_preserved_as_separate_rows() -> None:
    content = standard_workbook(
        [
            ["Kai P", "White", "Yellow Stripe", "Pass", ""],
            ["Kai P", "Yellow", "Yellow Stripe", "Pass", ""],
        ],
    )
    result = parse_ksw_workbook(content)

    assert len(result.rows) == 2
    assert result.rows[0].source_name == result.rows[1].source_name == "Kai P"
    # Distinct locators even for identical names/ranks.
    assert result.rows[0].source_locator != result.rows[1].source_locator


def test_sheet_with_no_recognisable_header_produces_a_warning_and_no_rows() -> None:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("06-2025")
        ws.append(["Just some unrelated text"])

    content = workbook_bytes(build)
    result = parse_ksw_workbook(content)

    assert result.rows == []
    assert any(
        "no recognisable main table header" in warning for warning in result.warnings
    )


def test_malformed_file_raises_workbook_structure_error() -> None:
    with pytest.raises(WorkbookStructureError):
        parse_ksw_workbook(b"not a real workbook")


# --- the real workbook's layouts (2026-10-20), rebuilt from made-up values ----


def sheet(*rows: Sequence[object], title: str = "062025") -> bytes:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet(title)
        for row in rows:
            ws.append(row)

    return workbook_bytes(build)


def by_section(content: bytes) -> dict[str, list[CanonicalLegacyRow]]:
    grouped: dict[str, list[CanonicalLegacyRow]] = {}
    for row in parse_ksw_workbook(content).rows:
        grouped.setdefault(row.source_section, []).append(row)
    return grouped


def test_an_unaccounted_table_beside_the_main_one_is_read_as_results() -> None:
    content = sheet(
        [*MAIN_TABLE_HEADER, "Unaccounted", "Outcome", "Comments"],
        [
            "A. Example",
            "White Belt",
            "Yellow Stripe",
            "Pass",
            "Good.",
            "Q. Side",
            "Conditional.",
            "Etiquette.",
        ],
        [
            "B. Example",
            "White Belt",
            "Yellow Stripe",
            "Fail",
            "",
            "R. Side",
            "N/A",
            "Not grading.",
        ],
    )

    result = parse_ksw_workbook(content)
    side = [row for row in result.rows if row.source_section == "Unaccounted"]

    assert [row.source_name for row in side] == ["Q. Side", "R. Side"]
    assert side[0].record_kind == LegacyRecordKind.GRADING_RESULT
    assert side[0].outcome == LegacyOutcome.CONDITIONAL
    assert side[0].source_outcome_text == "Conditional."
    assert side[0].comments == "Etiquette."
    assert side[1].outcome is None
    assert side[0].source_locator == "062025!Unaccounted!R2"
    main = [row for row in result.rows if row.source_section == ""]
    assert [row.source_name for row in main] == ["A. Example", "B. Example"]
    assert main[0].comments == "Good."
    assert result.warnings == []


def test_a_missing_table_keeps_its_unheaded_notes() -> None:
    content = sheet(
        [*MAIN_TABLE_HEADER, None, None, None, "Missing"],
        [
            "A. Example",
            "White",
            "Yellow",
            "Pass",
            "",
            None,
            None,
            None,
            "C. Gone",
            "Did not take part",
        ],
    )

    [missing] = by_section(content)["Missing"]

    assert missing.record_kind == LegacyRecordKind.AUXILIARY_NOTE
    assert missing.source_name == "C. Gone"
    assert missing.admin_note == "Did not take part"


def test_a_did_not_attend_table_keeps_the_current_belt_and_its_note() -> None:
    content = sheet(
        [*MAIN_TABLE_HEADER, None, "Did not attend", "Current belt"],
        [
            "A. Example",
            "White",
            "Yellow",
            "Pass",
            "",
            None,
            "D. Away",
            "Red stripe?",
            "Paid?",
        ],
    )

    [away] = by_section(content)["Did not attend"]

    assert away.record_kind == LegacyRecordKind.DID_NOT_ATTEND
    assert away.attendance_status == LegacyAttendance.DID_NOT_ATTEND
    assert away.source_current_rank_text == "Red stripe?"
    assert away.admin_note == "Paid?"


def test_a_repeated_main_column_is_read_once_with_a_warning() -> None:
    content = sheet(
        ["Name", "Name", "Current Rank", "Testing For", "Outcome", "Comments"],
        ["A. Example", "A. Example", "White", "Yellow", "Pass", "Fine."],
        title="092026",
    )

    result = parse_ksw_workbook(content)

    [row] = result.rows
    assert (row.source_name, row.source_current_rank_text, row.comments) == (
        "A. Example",
        "White",
        "Fine.",
    )
    assert result.warnings == [
        "Sheet '092026' repeats a column of the main table; only the first was read.",
    ]


def test_a_note_beside_a_person_is_kept_on_their_record() -> None:
    content = sheet(
        [*MAIN_TABLE_HEADER, None, "General Comments - juniors"],
        ["A. Example", "White", "Yellow", "Pass", "", None, "Low stances."],
        ["B. Example", "White", "Yellow", "Pass", "", "These two need more.", None],
        title="062026",
    )

    result = parse_ksw_workbook(content)

    assert [(row.source_name, row.admin_note) for row in result.rows] == [
        (
            "A. Example",
            "Written beside this row, under General Comments - juniors: Low stances.",
        ),
        ("B. Example", "Written beside this row: These two need more."),
    ]
    assert result.warnings == []


def test_a_note_beside_a_row_with_no_name_is_a_sheet_note() -> None:
    content = sheet(
        [*MAIN_TABLE_HEADER, None, "General Comments - juniors"],
        ["A. Example", "White", "Yellow", "Pass", ""],
        [None, None, None, None, None, None, "Low stances."],
        title="062026",
    )

    result = parse_ksw_workbook(content)
    notes = [row for row in result.rows if row.source_name == "Sheet note"]

    assert [
        (row.source_section, row.admin_note, row.source_locator) for row in notes
    ] == [("General Comments - juniors", "Low stances.", "062026!Note!G3")]
    assert result.rows[0].admin_note == ""
    assert result.warnings == [
        "Sheet '062026' has 1 note(s) in no table; each is kept as a note named "
        "'Sheet note'.",
    ]


def test_a_row_with_no_name_and_anything_above_the_table_are_kept_as_notes() -> None:
    content = sheet(
        ["Grading, June 2025"],
        ["Name", "Current Rank", "Testing For", "Outcome", "Examiner", "Comments"],
        ["A. Example", "White", "Yellow", "Pass", "KSN Lee", "Good forms,"],
        [None, None, None, None, "KSN Kim", "and good kicks."],
    )

    result = parse_ksw_workbook(content)
    notes = [row for row in result.rows if row.source_name == "Sheet note"]

    assert [
        (row.source_section, row.admin_note, row.source_locator) for row in notes
    ] == [
        ("Above the table", "Grading, June 2025", "062025!Note!A1"),
        ("Examiner", "KSN Kim", "062025!Note!E4"),
        ("Comments", "and good kicks.", "062025!Note!F4"),
    ]
    assert result.warnings == [
        "Sheet '062025' has 3 note(s) in no table; each is kept as a note named "
        "'Sheet note'.",
    ]


def test_a_row_with_no_name_under_a_side_section_is_kept_as_a_note() -> None:
    """Its other cells are kept, not dropped with the missing name."""
    content = sheet(
        ["Name", "Current Rank", "Testing For", "Outcome", "Comments"],
        ["Alex Example", "White", "Yellow Stripe", "Pass", ""],
        ["Missing"],
        ["Sam Example", "away"],
        [None, "Ran on from the row above: rang to say ill"],
    )

    result = parse_ksw_workbook(content)
    notes = [row for row in result.rows if row.source_name == "Sheet note"]

    assert [(row.admin_note, row.source_locator) for row in notes] == [
        ("Ran on from the row above: rang to say ill", "062025!Note!B5"),
    ]
    assert "1 note(s) in no table" in result.warnings[0]


def test_a_note_far_to_the_right_cannot_be_mistaken_for_a_main_row() -> None:
    # Column R row 3 is "R3" - the main table's own row 3 is "062025!R3".
    far: list[object] = [None] * 17 + ["far note"]
    content = sheet(
        MAIN_TABLE_HEADER,
        ["A. Example", "White", "Yellow", "Pass", ""],
        far,
    )

    locators = [r.source_locator for r in parse_ksw_workbook(content).rows]

    assert locators == ["062025!R2", "062025!Note!R3"]


def test_a_main_table_column_kukgrade_has_no_field_for_is_kept_on_the_record() -> None:
    content = sheet(
        ["Name", "Current Rank", "Testing For", "Outcome", "Examiner", "Comments"],
        ["A. Example", "White", "Yellow", "Pass", "KSN Lee", "Fine."],
        ["B. Example", "White", "Yellow", "Pass", "", ""],
    )

    first, second = parse_ksw_workbook(content).rows

    assert first.admin_note == "Examiner: KSN Lee"
    assert first.comments == "Fine."
    assert second.admin_note == ""


def test_every_non_blank_cell_of_a_grading_sheet_is_kept_somewhere() -> None:
    rows: list[list[object]] = [
        [
            *MAIN_TABLE_HEADER,
            "Unaccounted",
            "Outcome",
            "Comments",
            None,
            "Missing",
            None,
            "Did not attend",
            "Current belt",
            None,
            "Notes",
        ],
        [
            "A",
            "White",
            "Yellow",
            "Pass",
            "c1",
            "Q",
            "Pass.",
            "c2",
            "loose",
            "M",
            "m-note",
            "D",
            "Red",
            "d-note",
            "n1",
        ],
        [
            "B",
            "White",
            "Yellow",
            "Fail",
            "c3",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ],
    ]
    content = sheet(*rows)

    result = parse_ksw_workbook(content)
    kept = set()
    for row in result.rows:
        for value in (
            row.source_name,
            row.source_current_rank_text,
            row.source_testing_for_rank_text,
            row.source_outcome_text,
            row.comments,
            *row.admin_note.split("\n"),
        ):
            kept.add(value)
            # A note says where it was written: "Written beside ...: n1".
            kept.add(value.split(": ", 1)[-1])
    data_cells = {str(cell) for row in rows[1:] for cell in row if cell}

    assert data_cells - kept == set()


# --- notes merged down several rows -------------------------------------------


def merged_sheet(rows: Sequence[Sequence[object]], *merges: str) -> bytes:
    def build(workbook: Workbook) -> None:
        ws = workbook.create_sheet("062025")
        for row in rows:
            ws.append(row)
        for cells in merges:
            ws.merge_cells(cells)

    return workbook_bytes(build)


def test_a_merged_note_is_on_each_person_it_spans_and_on_no_one_else() -> None:
    content = merged_sheet(
        [
            MAIN_TABLE_HEADER,
            ["A. Example", "White", "Yellow", "Pass", "", "Both need focus."],
            [None, None, None, None, "run on"],
            ["B. Example", "White", "Yellow", "Pass", ""],
            ["C. Example", "White", "Yellow", "Pass", ""],
        ],
        "F2:G4",
    )

    result = parse_ksw_workbook(content)
    notes = {row.source_name: row.admin_note for row in result.rows}

    assert (
        notes["A. Example"]
        == notes["B. Example"]
        == ("Written beside rows 2 to 4: Both need focus.")
    )
    assert notes["C. Example"] == ""
    # The run-on comment is in the main table's own column: a sheet note.
    assert notes["Sheet note"] == "run on"


def test_a_merged_note_beside_no_one_is_a_sheet_note() -> None:
    content = merged_sheet(
        [
            MAIN_TABLE_HEADER,
            ["A. Example", "White", "Yellow", "Pass", ""],
            [],
            [None, None, None, None, None, "For next time."],
        ],
        "F4:F5",
    )

    result = parse_ksw_workbook(content)

    assert [(row.source_name, row.admin_note) for row in result.rows] == [
        ("A. Example", ""),
        ("Sheet note", "For next time."),
    ]


def test_a_note_merged_down_most_of_the_sheet_is_about_no_one_in_particular() -> None:
    people = [
        [f"Person {index}", "White", "Yellow", "Pass", ""]
        for index in range(MAX_NOTE_ROWS + 1)
    ]
    people[0].append("The whole class: more spirit.")
    content = merged_sheet(
        [MAIN_TABLE_HEADER, *people],
        f"F2:F{MAX_NOTE_ROWS + 2}",
    )

    result = parse_ksw_workbook(content)

    people_notes = [r.admin_note for r in result.rows if r.source_name != "Sheet note"]
    [note] = [r for r in result.rows if r.source_name == "Sheet note"]
    assert people_notes == [""] * (MAX_NOTE_ROWS + 1)
    # In its place, after the row it was written on.
    assert result.rows[1] == note
    assert (note.admin_note, note.source_locator) == (
        "The whole class: more spirit.",
        "062025!Note!F2",
    )


def test_a_merge_inside_the_main_table_changes_no_record() -> None:
    content = merged_sheet(
        [
            MAIN_TABLE_HEADER,
            ["A. Example", "White", "Yellow", "Pass", "Shared comment."],
            ["B. Example", "White", "Yellow", "Pass", None],
        ],
        "E2:E3",
    )

    first, second = parse_ksw_workbook(content).rows

    assert (first.comments, second.comments) == ("Shared comment.", "")
    assert first.admin_note == second.admin_note == ""


# --- what the workbook itself shows is worth a look ---------------------------


def row(
    name: str,
    *,
    sheet: str = "062025",
    section: str = "",
    kind: str = LegacyRecordKind.GRADING_RESULT,
    number: int = 2,
    current: str = "White",
    testing: str = "Yellow",
    outcome: str = "Pass",
) -> CanonicalLegacyRow:
    prefix = f"{sheet}!{section}!" if section else f"{sheet}!"
    return CanonicalLegacyRow(
        source_sheet=sheet,
        source_section=section,
        source_locator=f"{prefix}R{number}",
        cycle_year=2025,
        cycle_month=6,
        record_kind=kind,
        source_name=name,
        source_current_rank_text=current,
        source_testing_for_rank_text=testing,
        source_outcome_text=outcome,
    )


def test_a_blank_outcome_is_checked_on_results_only() -> None:
    checks = workbook_checks(
        [
            row("A. Example", outcome=""),
            row("B. Side", section="Unaccounted", current="", testing="", outcome=""),
            row(
                "C. Away",
                kind=LegacyRecordKind.DID_NOT_ATTEND,
                number=3,
                outcome="",
                testing="",
            ),
        ],
    )

    # Unaccounted for with no outcome is someone not graded that day.
    assert checks == {"062025!R2": [NO_OUTCOME]}


def test_a_missing_rank_is_checked_in_the_main_table() -> None:
    checks = workbook_checks(
        [
            row("A. Example", current=""),
            row("B. Example", number=3, testing=""),
            row(
                "C. Away",
                kind=LegacyRecordKind.DID_NOT_ATTEND,
                number=4,
                current="",
                testing="",
                outcome="DNA",
            ),
        ],
    )

    assert checks == {
        "062025!R2": [NO_CURRENT_RANK],
        "062025!R3": [NO_TESTING_FOR_RANK],
        # Not attending, nothing was tested: only the rank held is missing.
        "062025!R4": [NO_CURRENT_RANK],
    }


def test_names_that_cannot_be_one_person_or_are_on_other_sheets_are_not_checked() -> (
    None
):
    checks = workbook_checks(
        [
            row("Cara P"),
            row("Cara K", number=3),
            row("Cara P", sheet="092025"),
            row(
                "Cara K",
                sheet="092025",
                section="Missing",
                kind=LegacyRecordKind.AUXILIARY_NOTE,
                number=3,
            ),
        ],
    )

    assert checks == {}


def test_a_sheet_naming_too_many_people_is_not_checked_for_names_with_a_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("data_imports.ksw_adapter.MAX_CHECKED_NAMES", 2)
    content = standard_workbook(
        [
            ["Kit B", "White", "Yellow", "Pass", ""],
            ["Kit B", "White", "Yellow", "Pass", ""],
            ["Sam P", "White", "Yellow", "Pass", ""],
        ],
    )

    result = parse_ksw_workbook(content)

    assert workbook_checks(result.rows) == {}
    assert names_not_checked(result.rows) == [
        "Sheet '06-2025' names more than 2 people, so it was not checked for "
        "anyone written twice.",
    ]
    # Two of the three are compared, and nothing says they were not.
    assert workbook_checks(result.rows[:2]) != {}
    assert names_not_checked(result.rows[:2]) == []
