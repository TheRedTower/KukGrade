"""KSW Colchester historical grading workbook -> canonical rows.

Deliberately source-specific: this adapter understands one workbook's
structure and nothing else. Its only job is:

    historical workbook structure -> canonical legacy rows

It never creates domain models itself (that is
`gradings.legacy_services.create_legacy_grading_records`, called with every
row by a data_imports commit service) and it never resolves a rank or
links a student - source text is extracted verbatim and normalised fields
are left unset, because both of those are explicitly admin-review steps
(import Decisions 3 and 4), not parser steps.

First built from a written description of the workbook; checked against
the owner's real workbook on 2026-10-20 (decision log, import overhaul),
which is read outside this repository and must never enter it. What that
showed is handled here: bare `MMYYYY` sheet titles; side tables written
beside the main table, in the same rows - "Unaccounted" with its own outcome
and comments, "Missing" with a note, "Did not attend" with the current
belt; a second copy of a main column; and notes in no table at all. Nothing
non-blank on a grading sheet is dropped: a cell no table claims is kept as
a sheet note, with a warning saying so.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, replace
from typing import Any, TypedDict

from openpyxl.utils import get_column_letter

from data_imports.parsers import (
    MAX_COLUMNS,
    UnsupportedImportFileError,
    is_blank,
    open_workbook,
    worksheet_rows,
)
from gradings.legacy_matching import SHEET_NOTE_NAME
from gradings.models import LegacyAttendance, LegacyOutcome, LegacyRecordKind

# Budgets for the whole workbook (KG-A10), every sheet counted, known or not.
# Generous for a club's history - a sheet per grading cycle, tens of rows
# each - and far below what exhausts a request.
MAX_SHEETS = 500
MAX_WORKBOOK_ROWS = 50_000

# Excel worksheet titles cannot contain "/" (openpyxl raises ValueError on
# it - it is one of the characters OOXML itself forbids in a sheet title),
# so although cycle sheet names are conventionally written as
# "06/2025", the real workbook cannot literally be titled that. Confirmed
# against a real KSW export: Excel silently drops the "/" rather than
# substituting "-" or ".", leaving a bare "MMYYYY" sheet title (e.g.
# "062025"). This accepts that concatenated form, plus "-", "." and "/"
# themselves in case some other export path preserves a separator.
_CYCLE_SHEET_PATTERN = re.compile(r"^(0[1-9]|1[0-2])[-./]?(\d{4})$")
_IGNORED_SHEET_NAMES = {"information"}

# Main-table header cells (order-independent; the header row is found by
# content, not by a hard-coded row number).
_MAIN_TABLE_COLUMNS = ("name", "current rank", "testing for", "outcome", "comments")
_MAIN_TABLE_HEADER_MATCH_THRESHOLD = 3

# Normalised (lowercase) -> display text. Sentence case, as the workbook
# writes them - not Python's str.title(), which would wrongly capitalise
# every word ("Current Belt").
_AUXILIARY_SECTION_DISPLAY_NAMES = {
    "unaccounted": "Unaccounted",
    "missing": "Missing",
    "did not attend": "Did not attend",
    "current belt": "Current belt",
}

# Side tables beside the main table, by the heading that starts one. Its
# name column is the heading's; the columns after it that it claims are
# named by _SIDE_COLUMNS, and unheaded ones hold its notes.
_SIDE_TABLE_KINDS = {
    "unaccounted": "Unaccounted",
    "missing": "Missing",
    "did not attend": "Did not attend",
}
_SIDE_COLUMNS = {
    "outcome": "outcome",
    "comments": "comments",
    "current belt": "current rank",
    "current rank": "current rank",
}

# A cell no table claims is kept, never dropped, as a note on its sheet,
# named SHEET_NOTE_NAME (shared with the record matching, which skips them).

_DNA_VALUES = {"dna", "did not attend"}
_DETERMINISTIC_OUTCOMES = {
    "pass": LegacyOutcome.PASS,
    "fail": LegacyOutcome.FAIL,
    "conditional": LegacyOutcome.CONDITIONAL,
}


class WorkbookStructureError(Exception):
    """The workbook could not be interpreted at all (not a KSW-shaped file)."""


@dataclass(frozen=True)
class CanonicalLegacyRow:
    source_sheet: str
    source_section: str
    source_locator: str
    cycle_year: int
    cycle_month: int
    record_kind: str
    source_name: str
    source_current_rank_text: str = ""
    source_testing_for_rank_text: str = ""
    source_outcome_text: str = ""
    outcome: str | None = None
    attendance_status: str = LegacyAttendance.UNKNOWN
    comments: str = ""
    admin_note: str = ""


@dataclass(frozen=True)
class WorkbookParseResult:
    rows: list[CanonicalLegacyRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # The grading sheets read, in workbook order.
    sheets: list[str] = field(default_factory=list)


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalise(value: Any) -> str:
    return " ".join(_clean(value).lower().split())


def _classify_outcome(source_outcome_text: str) -> tuple[str, str | None, str]:
    """Returns (record_kind, outcome, attendance_status).

    A full stop or other closing punctuation ("Pass.", as the workbook has
    it) does not hide the word; the source text itself is kept as written.
    """
    normalised = _normalise(source_outcome_text).rstrip(".!")
    if not normalised:
        return LegacyRecordKind.GRADING_RESULT, None, LegacyAttendance.UNKNOWN
    if normalised in _DNA_VALUES:
        return LegacyRecordKind.DID_NOT_ATTEND, None, LegacyAttendance.DID_NOT_ATTEND
    if normalised in _DETERMINISTIC_OUTCOMES:
        return (
            LegacyRecordKind.GRADING_RESULT,
            _DETERMINISTIC_OUTCOMES[normalised],
            LegacyAttendance.ATTENDED,
        )
    # N/A, free-form text ("Testing? JKN Adi: No"), or anything else
    # uncertain - preserved verbatim, left unresolved for review rather
    # than forced into Pass/Fail/Conditional (import Decision 5).
    return LegacyRecordKind.GRADING_RESULT, None, LegacyAttendance.ATTENDED


def _find_header_row(
    rows: list[tuple[Any, ...]],
) -> tuple[int, dict[str, int]] | None:
    """Defensive header detection - by content, not position."""
    for row_index, row in enumerate(rows):
        normalised_cells = [_normalise(cell) for cell in row]
        matches = {
            column: normalised_cells.index(column)
            for column in _MAIN_TABLE_COLUMNS
            if column in normalised_cells
        }
        if len(matches) >= _MAIN_TABLE_HEADER_MATCH_THRESHOLD and "name" in matches:
            return row_index, matches
    return None


def _auxiliary_section_name(cells: tuple[Any, ...]) -> str | None:
    first_cell = _normalise(cells[0]) if cells else ""
    return first_cell if first_cell in _AUXILIARY_SECTION_DISPLAY_NAMES else None


def _parse_main_table_row(
    row: tuple[Any, ...],
    columns: dict[str, int],
    *,
    sheet_name: str,
    row_number: int,
    cycle_year: int,
    cycle_month: int,
) -> CanonicalLegacyRow | None:
    def cell(column: str) -> str:
        index = columns.get(column)
        if index is None or index >= len(row):
            return ""
        return _clean(row[index])

    name = cell("name")
    if not name:
        return None

    outcome_text = cell("outcome")
    record_kind, outcome, attendance_status = _classify_outcome(outcome_text)

    return CanonicalLegacyRow(
        source_sheet=sheet_name,
        source_section="",
        source_locator=f"{sheet_name}!R{row_number}",
        cycle_year=cycle_year,
        cycle_month=cycle_month,
        record_kind=record_kind,
        source_name=name,
        source_current_rank_text=cell("current rank"),
        source_testing_for_rank_text=cell("testing for"),
        source_outcome_text=outcome_text,
        outcome=outcome,
        attendance_status=attendance_status,
        comments=cell("comments"),
    )


def _parse_auxiliary_row(
    row: tuple[Any, ...],
    *,
    sheet_name: str,
    section_name: str,
    row_number: int,
    cycle_year: int,
    cycle_month: int,
) -> CanonicalLegacyRow | None:
    cells = [_clean(cell) for cell in row]
    name = cells[0] if cells else ""
    if not name:
        return None
    note = ", ".join(value for value in cells[1:] if value)

    if section_name == "did not attend":
        return CanonicalLegacyRow(
            source_sheet=sheet_name,
            source_section="Did not attend",
            source_locator=f"{sheet_name}!Did not attend!R{row_number}",
            cycle_year=cycle_year,
            cycle_month=cycle_month,
            record_kind=LegacyRecordKind.DID_NOT_ATTEND,
            source_name=name,
            attendance_status=LegacyAttendance.DID_NOT_ATTEND,
            admin_note=note,
        )

    display_name = _AUXILIARY_SECTION_DISPLAY_NAMES[section_name]
    return CanonicalLegacyRow(
        source_sheet=sheet_name,
        source_section=display_name,
        source_locator=f"{sheet_name}!{display_name}!R{row_number}",
        cycle_year=cycle_year,
        cycle_month=cycle_month,
        record_kind=LegacyRecordKind.AUXILIARY_NOTE,
        source_name=name,
        attendance_status=LegacyAttendance.UNKNOWN,
        admin_note=note,
    )


class _Place(TypedDict):
    """Where a row is: passed on to each row parser."""

    sheet_name: str
    row_number: int
    cycle_year: int
    cycle_month: int


@dataclass
class _SideTable:
    kind: str  # a key of _SIDE_TABLE_KINDS
    name_column: int
    columns: dict[str, int] = field(default_factory=dict)
    note_columns: list[int] = field(default_factory=list)


@dataclass
class _SheetLayout:
    main: dict[str, int]
    # Columns of the main table KukGrade has no field for, by heading: kept on
    # each row's record as extra information.
    extra: dict[int, str]
    # A second copy of a main column ("Name" twice): not read.
    ignored: set[int]
    side_tables: list[_SideTable]
    # Headed columns that are no table's: their cells become sheet notes.
    note_headings: dict[int, str]
    # The header row's text by column, to name where a note was.
    headings: list[str]


def _sheet_layout(header_row: tuple[Any, ...], main: dict[str, int]) -> _SheetLayout:
    """Which column of the header row belongs to what.

    The main table runs to its last recognised column. A heading after that
    starts a side table if it names one; the side table claims the headed
    columns that follow and that it has (outcome, comments, current belt),
    and the unheaded columns after them, which hold its notes. Any other
    heading after the main table is a column of notes.
    """
    headings = [_clean(cell) for cell in header_row]
    main_end = max(main.values())
    extra: dict[int, str] = {}
    ignored: set[int] = set()
    for index in range(main_end + 1):
        if index in main.values():
            continue
        if _normalise(headings[index]) in main:
            ignored.add(index)
        elif headings[index]:
            extra[index] = headings[index]

    side_tables: list[_SideTable] = []
    note_headings: dict[int, str] = {}
    current: _SideTable | None = None
    for index in range(main_end + 1, len(headings)):
        heading = _normalise(headings[index])
        if heading in _SIDE_TABLE_KINDS:
            current = _SideTable(kind=heading, name_column=index)
            side_tables.append(current)
        elif (
            current is not None
            and heading in _SIDE_COLUMNS
            and not current.note_columns
        ):
            current.columns.setdefault(_SIDE_COLUMNS[heading], index)
        elif current is not None and not heading:
            current.note_columns.append(index)
        elif heading:
            current = None
            note_headings[index] = headings[index]
    return _SheetLayout(main, extra, ignored, side_tables, note_headings, headings)


def _parse_side_row(
    row: tuple[Any, ...],
    table: _SideTable,
    *,
    sheet_name: str,
    row_number: int,
    cycle_year: int,
    cycle_month: int,
) -> CanonicalLegacyRow | None:
    def cell(index: int | None) -> str:
        return _clean(row[index]) if index is not None and index < len(row) else ""

    name = cell(table.name_column)
    if not name:
        return None
    display = _SIDE_TABLE_KINDS[table.kind]
    note = ", ".join(value for value in map(cell, table.note_columns) if value)
    outcome_text = cell(table.columns.get("outcome"))
    record_kind: str
    outcome: str | None
    attendance: str
    if table.kind == "did not attend":
        record_kind, outcome, attendance = (
            LegacyRecordKind.DID_NOT_ATTEND,
            None,
            LegacyAttendance.DID_NOT_ATTEND,
        )
    elif "outcome" in table.columns:
        # "Unaccounted": graded, but not in the main table - a result.
        record_kind, outcome, attendance = _classify_outcome(outcome_text)
    else:
        record_kind, outcome, attendance = (
            LegacyRecordKind.AUXILIARY_NOTE,
            None,
            LegacyAttendance.UNKNOWN,
        )
    return CanonicalLegacyRow(
        source_sheet=sheet_name,
        source_section=display,
        source_locator=f"{sheet_name}!{display}!R{row_number}",
        cycle_year=cycle_year,
        cycle_month=cycle_month,
        record_kind=record_kind,
        source_name=name,
        source_current_rank_text=cell(table.columns.get("current rank")),
        source_outcome_text=outcome_text,
        outcome=outcome,
        attendance_status=attendance,
        comments=cell(table.columns.get("comments")),
        admin_note=note,
    )


def _sheet_note(
    text: str,
    *,
    heading: str,
    sheet_name: str,
    column: int,
    row_number: int,
    cycle_year: int,
    cycle_month: int,
) -> CanonicalLegacyRow:
    letter = get_column_letter(column + 1)
    return CanonicalLegacyRow(
        source_sheet=sheet_name,
        source_section=heading or "Beside the table",
        # "Note!" keeps a cell such as R2 apart from the main table's row R2.
        source_locator=f"{sheet_name}!Note!{letter}{row_number}",
        cycle_year=cycle_year,
        cycle_month=cycle_month,
        record_kind=LegacyRecordKind.AUXILIARY_NOTE,
        source_name=SHEET_NOTE_NAME,
        attendance_status=LegacyAttendance.UNKNOWN,
        admin_note=text,
    )


def _with_extra(row: CanonicalLegacyRow, extra: list[str]) -> CanonicalLegacyRow:
    if not extra:
        return row
    note = "\n".join(part for part in [row.admin_note, *extra] if part)
    return replace(row, admin_note=note)


def _parse_cycle_sheet(
    rows: list[tuple[Any, ...]],
    *,
    sheet_name: str,
    cycle_year: int,
    cycle_month: int,
) -> tuple[list[CanonicalLegacyRow], list[str]]:
    warnings: list[str] = []
    header = _find_header_row(rows)
    if header is None:
        if any(not is_blank(row) for row in rows):
            warnings.append(
                f"Sheet '{sheet_name}' has no recognisable main table header "
                "and was not imported.",
            )
        return [], warnings

    header_index, columns = header
    layout = _sheet_layout(rows[header_index], columns)
    if layout.ignored:
        warnings.append(
            f"Sheet '{sheet_name}' repeats a column of the main table; only the "
            "first was read.",
        )
    canonical_rows: list[CanonicalLegacyRow] = []
    current_section: str | None = None
    claimed = (
        set(columns.values())
        | set(layout.extra)
        | layout.ignored
        | {table.name_column for table in layout.side_tables}
        | {index for table in layout.side_tables for index in table.columns.values()}
        | {index for table in layout.side_tables for index in table.note_columns}
    )
    sheet_notes = 0

    def place_of(row_index: int) -> _Place:
        # row_number is the 1-based Excel row number (rows is 0-indexed).
        return {
            "sheet_name": sheet_name,
            "row_number": row_index + 1,
            "cycle_year": cycle_year,
            "cycle_month": cycle_month,
        }

    def notes_for(
        row: tuple[Any, ...],
        indexes: Iterable[int],
        place: _Place,
        heading: str | None = None,
    ) -> list[CanonicalLegacyRow]:
        """A sheet note for each non-blank cell at `indexes`, named by its
        column's heading unless `heading` names them all."""
        return [
            _sheet_note(
                _clean(row[index]),
                heading=layout.headings[index]
                if heading is None and index < len(layout.headings)
                else heading or "",
                column=index,
                **place,
            )
            for index in indexes
            if index < len(row) and _clean(row[index])
        ]

    # Anything written above the table - a title, a date - is kept too.
    for row_index in range(header_index):
        found = notes_for(
            rows[row_index],
            range(len(rows[row_index])),
            place_of(row_index),
            heading="Above the table",
        )
        canonical_rows.extend(found)
        sheet_notes += len(found)

    # Do not stop at the first blank row - auxiliary sections
    # may follow one further down the same sheet.
    for row_index in range(header_index + 1, len(rows)):
        row = rows[row_index]
        place = place_of(row_index)
        if is_blank(row):
            continue

        section = _auxiliary_section_name(row)
        if section is not None:
            current_section = section
            # The section's heading row holds nothing else, or a note.
            found = notes_for(row, range(1, len(row)), place, heading="")
            canonical_rows.extend(found)
            sheet_notes += len(found)
            continue

        if current_section is not None:
            parsed = _parse_auxiliary_row(row, section_name=current_section, **place)
            if parsed is not None:
                canonical_rows.append(parsed)
            continue

        parsed = _parse_main_table_row(row, columns, **place)
        if parsed is not None:
            extra = [
                f"{heading}: {_clean(row[index])}"
                for index, heading in layout.extra.items()
                if index < len(row) and _clean(row[index])
            ]
            canonical_rows.append(_with_extra(parsed, extra))
        else:
            # A main-table row with no name - a comment run on from the row
            # above, say - is nobody's record, but its cells are kept.
            found = notes_for(
                row,
                sorted({*columns.values(), *layout.extra}),
                place,
            )
            canonical_rows.extend(found)
            sheet_notes += len(found)
        for table in layout.side_tables:
            side = _parse_side_row(row, table, **place)
            if side is not None:
                canonical_rows.append(side)
        for index in range(len(row)):
            text = _clean(row[index])
            if not text or index in claimed:
                continue
            canonical_rows.append(
                _sheet_note(
                    text,
                    heading=layout.note_headings.get(index, ""),
                    column=index,
                    **place,
                ),
            )
            sheet_notes += 1

    if sheet_notes:
        warnings.append(
            f"Sheet '{sheet_name}' has {sheet_notes} note(s) in no table; each "
            f"is kept as a note named '{SHEET_NOTE_NAME}'.",
        )
    return canonical_rows, warnings


class _RowBudget:
    """Rows left to read across the whole workbook."""

    def __init__(self) -> None:
        self.remaining = MAX_WORKBOOK_ROWS

    def rows(self, worksheet: Any) -> Iterator[tuple[Any, ...]]:
        for row in worksheet_rows(worksheet, max_col=MAX_COLUMNS):
            self.remaining -= 1
            if self.remaining < 0:
                raise WorkbookStructureError(
                    "The workbook has more than "
                    f"{MAX_WORKBOOK_ROWS:,} rows across its sheets, blank rows "
                    "included - beyond what this importer reads.",
                )
            yield row


def parse_ksw_colchester_workbook(content: bytes) -> WorkbookParseResult:
    try:
        with open_workbook(content) as workbook:
            return _parse_workbook(workbook)
    except UnsupportedImportFileError as exc:
        raise WorkbookStructureError(str(exc)) from exc


def _parse_workbook(workbook: Any) -> WorkbookParseResult:
    if len(workbook.sheetnames) > MAX_SHEETS:
        msg = f"The workbook has more than {MAX_SHEETS} sheets."
        raise WorkbookStructureError(msg)

    budget = _RowBudget()
    all_rows: list[CanonicalLegacyRow] = []
    warnings: list[str] = []
    sheets: list[str] = []

    for sheet_name in workbook.sheetnames:
        cleaned_name = sheet_name.strip()
        if cleaned_name.lower() in _IGNORED_SHEET_NAMES:
            continue

        match = _CYCLE_SHEET_PATTERN.match(cleaned_name)
        if match is None:
            has_content = any(
                not is_blank(row) for row in budget.rows(workbook[sheet_name])
            )
            if has_content:
                warnings.append(f"Unknown sheet '{sheet_name}' was not imported.")
            continue

        cycle_month, cycle_year = int(match.group(1)), int(match.group(2))
        sheet_rows, sheet_warnings = _parse_cycle_sheet(
            list(budget.rows(workbook[sheet_name])),
            sheet_name=cleaned_name,
            cycle_year=cycle_year,
            cycle_month=cycle_month,
        )
        all_rows.extend(sheet_rows)
        warnings.extend(sheet_warnings)
        sheets.append(cleaned_name)

    _check_locators_unique(all_rows)
    return WorkbookParseResult(rows=all_rows, warnings=warnings, sheets=sheets)


def _check_locators_unique(rows: list[CanonicalLegacyRow]) -> None:
    seen: set[str] = set()
    for row in rows:
        if row.source_locator in seen:
            msg = f"The workbook lists the same row twice: {row.source_locator}"
            raise WorkbookStructureError(msg)
        seen.add(row.source_locator)
