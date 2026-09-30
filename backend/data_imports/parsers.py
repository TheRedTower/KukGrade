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

MAX_ROWS = 5000
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
        msg = f"The workbook expands to more than {limit} MiB, beyond the limit."
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


def _read(rows: Iterator[Sequence[Any]]) -> TabularData:
    header_cells = next(rows, None)
    if header_cells is None or is_blank(header_cells):
        raise UnsupportedImportFileError("The file has no header row.")
    headers = ["" if cell is None else str(cell).strip() for cell in header_cells]
    while headers and not headers[-1]:
        headers.pop()
    if len(headers) > MAX_COLUMNS:
        msg = f"Too many columns (limit {MAX_COLUMNS})."
        raise UnsupportedImportFileError(msg)

    data: list[tuple[int, dict[str, Any]]] = []
    for row_number, cells in enumerate(rows, start=2):
        if row_number - 1 > MAX_ROWS:
            msg = f"Too many rows (limit {MAX_ROWS}, blank rows included)."
            raise UnsupportedImportFileError(msg)
        # Cells past the last header have nowhere to map to.
        cells = list(cells[: len(headers)])
        if is_blank(cells):
            continue
        cells += [None] * (len(headers) - len(cells))
        data.append((row_number, dict(zip(headers, cells, strict=True))))
    return TabularData(headers=headers, rows=data)


def load_tabular_dataset(*, content: bytes, filename: str) -> TabularData:
    suffix = file_suffix(filename)
    if suffix not in _SUPPORTED_SUFFIXES:
        msg = f"Unsupported file type: .{suffix or '?'}"
        raise UnsupportedImportFileError(msg)
    if suffix == "csv":
        return _read(_csv_rows(content))
    with open_workbook(content) as workbook:
        # One column past the limit is read, so an over-wide header is seen.
        return _read(worksheet_rows(workbook.active, max_col=MAX_COLUMNS + 1))
