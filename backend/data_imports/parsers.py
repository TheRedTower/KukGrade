"""Generic tabular parsing (Tablib), never domain interpretation.

See the Definitive Implementation Spec section 5/21: `django-import-export`
was rejected in favour of Tablib directly (Python 3.14 compatibility - see
docs/decision_log.md), and even Tablib's job stops at "rows of strings" -
every row is still validated and written through the normal
`students.services.create_student` service, never a framework bulk-write
path.
"""

from __future__ import annotations

import tablib

MAX_ROWS = 5000
MAX_COLUMNS = 50

_FORMAT_BY_SUFFIX = {"xlsx": "xlsx", "csv": "csv"}


class UnsupportedImportFileError(Exception):
    """The uploaded file is not a supported, well-formed source file."""


def file_suffix(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def load_tabular_dataset(*, content: bytes, filename: str) -> tablib.Dataset:
    suffix = file_suffix(filename)
    file_format = _FORMAT_BY_SUFFIX.get(suffix)
    if file_format is None:
        msg = f"Unsupported file type: .{suffix or '?'}"
        raise UnsupportedImportFileError(msg)

    dataset = tablib.Dataset()
    try:
        if file_format == "csv":
            # Tablib's CSV reader wants text, not bytes (unlike its xlsx
            # reader, which wants the raw zip bytes) - "utf-8-sig" also
            # transparently strips a BOM, which Excel's own "CSV UTF-8"
            # export adds.
            dataset.load(content.decode("utf-8-sig"), format=file_format)
        else:
            dataset.load(content, format=file_format)
    except Exception as exc:
        kind = "Excel workbook" if file_format == "xlsx" else "CSV file"
        msg = f"The file could not be read as a valid {kind}."
        raise UnsupportedImportFileError(msg) from exc

    if not dataset.headers:
        raise UnsupportedImportFileError("The file has no header row.")
    if len(dataset.headers) > MAX_COLUMNS:
        msg = f"Too many columns (limit {MAX_COLUMNS})."
        raise UnsupportedImportFileError(msg)
    if len(dataset) > MAX_ROWS:
        msg = f"Too many rows (limit {MAX_ROWS})."
        raise UnsupportedImportFileError(msg)

    return dataset
