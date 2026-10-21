"""Reading uploaded spreadsheets into rows of values, never interpreting them.

Every budget is enforced while reading, not after (KG-A10): a small file can
describe a huge sheet - a workbook with one cell at row 200,000 makes the
reader produce 200,000 rows - so a row or column limit checked once
everything is loaded bounds nothing. Every row read counts, blank or not.
"""

from __future__ import annotations

import csv
import zipfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from io import BytesIO, StringIO
from typing import Any

import openpyxl
from openpyxl.utils import get_column_letter

# One school's roster is a few hundred students; a file needing more is not
# one school's (owner, 2026-10-20 import overhaul).
MAX_ROWS = 1000
MAX_COLUMNS = 50
# Expanded size of every part of an .xlsx archive together. Sizes are the
# ones the archive declares; Python's zip reader stops at the declared size,
# so an archive cannot expand past it.
MAX_XLSX_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_XLSX_ARCHIVE_MEMBERS = 2000

_SUPPORTED_SUFFIXES = frozenset({"xlsx", "csv"})


class UnsupportedImportFileError(Exception):
    """The uploaded file is not a supported, well-formed source file."""


_UNREADABLE_XLSX = "The file could not be read as a valid Excel workbook."
_UNREADABLE_CSV = "The file could not be read as a valid CSV file."


@dataclass(frozen=True)
class TabularData:
    headers: list[str]
    # (source row number, header -> value); blank rows are left out, so the
    # numbers are the spreadsheet's own row numbers, header being row 1.
    rows: list[tuple[int, dict[str, Any]]]
    # A workbook's sheet that was read, and every sheet it has; blank for a
    # CSV, which has no sheets.
    sheet: str = ""
    sheet_names: tuple[str, ...] = ()


def file_suffix(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def is_blank(cells: Sequence[Any]) -> bool:
    return all(cell is None or str(cell).strip() == "" for cell in cells)


def _check_xlsx_archive(content: bytes) -> None:
    """Refuse an .xlsx whose archive would expand past the budget."""
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            members = archive.infolist()
    except zipfile.BadZipFile as exc:
        raise UnsupportedImportFileError(_UNREADABLE_XLSX) from exc
    if len(members) > MAX_XLSX_ARCHIVE_MEMBERS:
        msg = f"The workbook has more than {MAX_XLSX_ARCHIVE_MEMBERS} parts."
        raise UnsupportedImportFileError(msg)
    if sum(member.file_size for member in members) > MAX_XLSX_EXPANDED_BYTES:
        limit = MAX_XLSX_EXPANDED_BYTES // (1024 * 1024)
        msg = f"The workbook is too large once opened (more than {limit} MB)."
        raise UnsupportedImportFileError(msg)


@contextmanager
def open_workbook(content: bytes) -> Iterator[Any]:
    """A read-only workbook, closed afterwards - read-only mode holds the
    archive open until then."""
    _check_xlsx_archive(content)
    try:
        workbook = openpyxl.load_workbook(
            BytesIO(content),
            read_only=True,
            data_only=True,
        )
    except Exception as exc:
        raise UnsupportedImportFileError(_UNREADABLE_XLSX) from exc
    try:
        yield workbook
    finally:
        workbook.close()


def _csv_rows(content: bytes) -> Iterator[Sequence[Any]]:
    try:
        # "utf-8-sig" strips the BOM Excel's own "CSV UTF-8" export adds.
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise UnsupportedImportFileError(_UNREADABLE_CSV) from exc
    try:
        yield from csv.reader(StringIO(text))
    except csv.Error as exc:
        raise UnsupportedImportFileError(_UNREADABLE_CSV) from exc


def worksheet_rows(worksheet: Any, *, max_col: int) -> Iterator[tuple[Any, ...]]:
    """A worksheet's rows as values. Read-only mode parses the sheet lazily,
    so a malformed sheet fails here, while iterating, not when opened."""
    try:
        yield from worksheet.iter_rows(values_only=True, max_col=max_col)
    except Exception as exc:
        raise UnsupportedImportFileError(_UNREADABLE_XLSX) from exc


def _last_filled(cells: Sequence[Any]) -> int:
    """How many cells reach the last non-blank one."""
    for index in range(len(cells) - 1, -1, -1):
        if cells[index] is not None and str(cells[index]).strip():
            return index + 1
    return 0


def _read(rows: Iterator[Sequence[Any]]) -> TabularData:
    """A table: the first row's headings, and every non-blank row after it.

    A column with no heading that holds something is named after its letter
    ("Column F"), so it can still be matched or kept rather than silently
    lost; a heading used twice is refused, as either column's cells would
    hide the other's.
    """
    header_cells = next(rows, None)
    if header_cells is None or is_blank(header_cells):
        raise UnsupportedImportFileError("The file has no header row.")
    raw_rows: list[tuple[int, list[Any]]] = []
    width = _last_filled(header_cells)
    for row_number, cells in enumerate(rows, start=2):
        if row_number - 1 > MAX_ROWS:
            msg = f"Too many rows (limit {MAX_ROWS}, blank rows included)."
            raise UnsupportedImportFileError(msg)
        if is_blank(cells):
            continue
        raw_rows.append((row_number, list(cells)))
        width = max(width, _last_filled(cells))
    if width > MAX_COLUMNS:
        msg = f"Too many columns (limit {MAX_COLUMNS})."
        raise UnsupportedImportFileError(msg)

    headers = [
        ""
        if index >= len(header_cells) or header_cells[index] is None
        else str(header_cells[index]).strip()
        for index in range(width)
    ]
    headers = [
        heading or f"Column {get_column_letter(index + 1)}"
        for index, heading in enumerate(headers)
    ]
    repeated = sorted({heading for heading in headers if headers.count(heading) > 1})
    if repeated:
        msg = (
            f"The column heading {', '.join(map(repr, repeated))} appears more "
            "than once. Give each column its own heading."
        )
        raise UnsupportedImportFileError(msg)

    data = [
        (
            row_number,
            dict(
                zip(
                    headers,
                    [*cells[:width], *[None] * (width - len(cells))],
                    strict=True,
                )
            ),
        )
        for row_number, cells in raw_rows
    ]
    return TabularData(headers=headers, rows=data)


def load_tabular_dataset(
    *,
    content: bytes,
    filename: str,
    sheet: str | None = None,
) -> TabularData:
    """A file's rows. A workbook's `sheet` is read - the one it opens on when
    none is named - so a roster on another tab is never silently missed: the
    sheet read and every sheet's name come back with the rows."""
    suffix = file_suffix(filename)
    if suffix not in _SUPPORTED_SUFFIXES:
        msg = f"Unsupported file type: .{suffix or '?'}"
        raise UnsupportedImportFileError(msg)
    if suffix == "csv":
        return _read(_csv_rows(content))
    with open_workbook(content) as workbook:
        names = tuple(workbook.sheetnames)
        if sheet is None:
            worksheet = workbook.active
        elif sheet in names:
            worksheet = workbook[sheet]
        else:
            msg = f"The workbook has no sheet named {sheet!r}."
            raise UnsupportedImportFileError(msg)
        # One column past the limit is read, so an over-wide header is seen.
        data = _read(worksheet_rows(worksheet, max_col=MAX_COLUMNS + 1))
        return TabularData(
            headers=data.headers,
            rows=data.rows,
            sheet=worksheet.title,
            sheet_names=names,
        )


def inspect_workbook_sheets(content: bytes) -> tuple[str, tuple[str, ...]]:
    """Read sheet names without requiring the opening sheet to be a table."""
    with open_workbook(content) as workbook:
        return workbook.active.title, tuple(workbook.sheetnames)
