"""KSW Colchester historical grading workbook -> canonical rows.

Deliberately source-specific: this adapter understands one workbook's
structure and nothing else. Its only job is:

    historical workbook structure -> canonical legacy rows

It never creates domain models itself (that is
`gradings.legacy_services.create_legacy_grading_record`, called once per
row by a data_imports commit service) and it never resolves a rank or
links a student - source text is extracted verbatim and normalised fields
are left unset, because both of those are explicitly admin-review steps
(import Decisions 3 and 4), not parser steps.

Built from a written description of the workbook, without the real file
(which must never enter this repository). Expect it to need adjustment
during the real-workbook rehearsal required before any production import.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from data_imports.parsers import (
    MAX_COLUMNS,
    UnsupportedImportFileError,
    is_blank,
    open_workbook,
    worksheet_rows,
)
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


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalise(value: Any) -> str:
    return " ".join(_clean(value).lower().split())


def _classify_outcome(source_outcome_text: str) -> tuple[str, str | None, str]:
    """Returns (record_kind, outcome, attendance_status)."""
    normalised = _normalise(source_outcome_text)
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
    canonical_rows: list[CanonicalLegacyRow] = []
    current_section: str | None = None

    # Do not stop at the first blank row - auxiliary sections
    # may follow one further down the same sheet. row_number is the 1-based
    # Excel row number (rows is 0-indexed).
    for row_index in range(header_index + 1, len(rows)):
        row = rows[row_index]
        row_number = row_index + 1
        if is_blank(row):
            continue

        section = _auxiliary_section_name(row)
        if section is not None:
            current_section = section
            continue

        if current_section is not None:
            parsed = _parse_auxiliary_row(
                row,
                sheet_name=sheet_name,
                section_name=current_section,
                row_number=row_number,
                cycle_year=cycle_year,
                cycle_month=cycle_month,
            )
        else:
            parsed = _parse_main_table_row(
                row,
                columns,
                sheet_name=sheet_name,
                row_number=row_number,
                cycle_year=cycle_year,
                cycle_month=cycle_month,
            )
        if parsed is not None:
            canonical_rows.append(parsed)

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

    _check_locators_unique(all_rows)
    return WorkbookParseResult(rows=all_rows, warnings=warnings)


def _check_locators_unique(rows: list[CanonicalLegacyRow]) -> None:
    seen: set[str] = set()
    for row in rows:
        if row.source_locator in seen:
            msg = f"The workbook lists the same row twice: {row.source_locator}"
            raise WorkbookStructureError(msg)
        seen.add(row.source_locator)
