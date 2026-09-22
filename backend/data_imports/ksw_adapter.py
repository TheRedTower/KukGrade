"""KSW Colchester historical grading workbook -> canonical rows.

Deliberately source-specific (spec section 15): this adapter understands
one workbook's structure and nothing else. Its only job is:

    historical workbook structure -> canonical legacy rows

It never creates domain models itself (that is
`gradings.legacy_services.create_legacy_grading_record`, called once per
row by a data_imports commit service) and it never resolves a rank or
links a student - source text is extracted verbatim and normalised fields
are left unset, because both of those are explicitly admin-review steps
(Decisions 3 and 4), not parser steps.

"V1" in the class name is deliberate (spec section 15) - this is a
best-effort implementation against the spec's written description of the
workbook, built without the real file (which must never enter this
repository - spec sections 38/40). It is expected to need adjustment during
the real-workbook rehearsal the spec calls for before any production import
(section 46), not to be perfectly correct on the first pass.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import openpyxl

from gradings.models import LegacyAttendance, LegacyOutcome, LegacyRecordKind

# Excel worksheet titles cannot contain "/" (openpyxl raises ValueError on
# it - it is one of the characters OOXML itself forbids in a sheet title),
# so despite the spec's own prose consistently writing cycle sheet names as
# "06/2025", the real workbook cannot literally be titled that. The real
# separator is almost certainly "-" or "." (both common stand-ins for "/"
# in a sheet tab); this accepts either, plus "/" itself in case the spec's
# example was accurate after all for some other reason.
_CYCLE_SHEET_PATTERN = re.compile(r"^(0[1-9]|1[0-2])[-./](\d{4})$")
_IGNORED_SHEET_NAMES = {"information"}

# Main-table header cells (order-independent; the header row is found by
# content, not by a hard-coded row number - spec section 15.3).
_MAIN_TABLE_COLUMNS = ("name", "current rank", "testing for", "outcome", "comments")
_MAIN_TABLE_HEADER_MATCH_THRESHOLD = 3

# Normalised (lowercase) -> display text. Sentence case, matching the
# spec's own section 15.4 examples exactly - not Python's str.title(),
# which would wrongly capitalise every word ("Current Belt").
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


def _row_is_blank(cells: tuple[Any, ...]) -> bool:
    return all(_clean(cell) == "" for cell in cells)


def _classify_outcome(source_outcome_text: str) -> tuple[str, str | None, str]:
    """Returns (record_kind, outcome, attendance_status) - spec section 16."""
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
    # than forced into Pass/Fail/Conditional (Decision 5, section 16.4).
    return LegacyRecordKind.GRADING_RESULT, None, LegacyAttendance.ATTENDED


def _find_header_row(
    rows: list[tuple[Any, ...]],
) -> tuple[int, dict[str, int]] | None:
    """Defensive header detection (spec 15.3) - by content, not position."""
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
        if any(not _row_is_blank(row) for row in rows):
            warnings.append(
                f"Sheet '{sheet_name}' has no recognisable main table header "
                "and was not imported.",
            )
        return [], warnings

    header_index, columns = header
    canonical_rows: list[CanonicalLegacyRow] = []
    current_section: str | None = None

    # Do not stop at the first blank row (spec 15.3) - auxiliary sections
    # may follow one further down the same sheet. row_number is the 1-based
    # Excel row number (rows is 0-indexed).
    for row_index in range(header_index + 1, len(rows)):
        row = rows[row_index]
        row_number = row_index + 1
        if _row_is_blank(row):
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


def parse_ksw_colchester_workbook(content: bytes) -> WorkbookParseResult:
    try:
        workbook = openpyxl.load_workbook(
            BytesIO(content),
            data_only=True,
            read_only=True,
        )
    except Exception as exc:
        raise WorkbookStructureError(
            "The file could not be read as a valid Excel workbook.",
        ) from exc

    all_rows: list[CanonicalLegacyRow] = []
    warnings: list[str] = []

    for sheet_name in workbook.sheetnames:
        cleaned_name = sheet_name.strip()
        if cleaned_name.lower() in _IGNORED_SHEET_NAMES:
            continue

        match = _CYCLE_SHEET_PATTERN.match(cleaned_name)
        if match is None:
            worksheet = workbook[sheet_name]
            has_content = any(
                not _row_is_blank(row) for row in worksheet.iter_rows(values_only=True)
            )
            if has_content:
                warnings.append(f"Unknown sheet '{sheet_name}' was not imported.")
            continue

        cycle_month, cycle_year = int(match.group(1)), int(match.group(2))
        worksheet = workbook[sheet_name]
        rows = list(worksheet.iter_rows(values_only=True))
        sheet_rows, sheet_warnings = _parse_cycle_sheet(
            rows,
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
            msg = f"Duplicate source locator: {row.source_locator}"
            raise WorkbookStructureError(msg)
        seen.add(row.source_locator)
