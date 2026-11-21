"""Builders for import-batch and legacy-record tests.

Every workbook is synthetic and built in memory - the real historical
workbook must never enter this repository. Uploaders and source locators are
numbered, so any test can build as many batches and records as it needs
without colliding on a unique email or locator.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Mapping, Sequence
from io import BytesIO

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl.workbook.workbook import Workbook

from accounts.models import User
from data_imports.models import ImportBatch
from data_imports.services import (
    StudentImportPreview,
    _classify_roster,
    commit_student_import,
    correct_import_row,
    create_import_batch,
    save_import_mapping,
)
from gradings.legacy_services import (
    link_legacy_record_to_student,
)
from gradings.models import (
    SHEET_NOTE_NAME,
    LegacyGradingRecord,
    LegacyPerson,
    LegacyPersonConfidence,
    LegacyRecordKind,
)
from gradings.testing import student
from students.models import Student

MAIN_TABLE_HEADER = ["Name", "Current Rank", "Testing For", "Outcome", "Comments"]

_sequence = itertools.count(1)


def _administrator() -> User:
    return User.objects.create_user(
        email=f"legacy-fixture-admin-{next(_sequence)}@example.com",
        role=User.Role.ADMINISTRATOR,
    )


def workbook_bytes(build: Callable[[Workbook], None]) -> bytes:
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    build(workbook)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def standard_workbook(main_rows: list[list[object]], sheet: str = "06-2025") -> bytes:
    """An "Information" cover sheet plus one cycle sheet, as the real one has."""

    def build(workbook: Workbook) -> None:
        info = workbook.create_sheet("Information")
        info.append(["This workbook contains historical grading records."])
        ws = workbook.create_sheet(sheet)
        ws.append(MAIN_TABLE_HEADER)
        for row in main_rows:
            ws.append(row)

    return workbook_bytes(build)


# A made-up history with every layout the real workbook has (2026-11-18): a
# cover sheet; a title above the table; side tables - "Unaccounted" results,
# "Missing" with a note, "Did not attend" with the current belt and a note;
# catch-up rows after a gap; a run-on comment with no name; a note beside a
# person's row; a second "Name" column; a note merged down three rows. And
# what it holds: one person under three spellings along a rank chain (Theo
# R, Theo Rowan, Teo Rowan), one spelling for two people on one sheet (Sam
# P), a name written twice (Kit B; Ruby and Rubi Moss), people both missing
# and graded (Omar and Omar Haddad; Finn C and Fin Cole), a blank outcome,
# missing ranks, rank spellings no rank reads ("Bown Stripe", "DNB") or that
# the workbook doubts ("Red stripe?"), a DBN testing for DBN, outcomes as
# written ("Pass.", "N/A", "DNA", free text) and a bad entry.
HISTORY_SHEETS: dict[str, list[list[object]]] = {
    "Information": [
        ["Key"],
        ["Conditional", "The school owner decides."],
    ],
    "062025": [
        ["Grading, June 2025"],
        [*MAIN_TABLE_HEADER, None, "Unaccounted", "Outcome", "Comments"],
        [
            "Theo R",
            "White Belt",
            "Yellow Stripe",
            "Pass.",
            "Good stances.",
            None,
            "Priya N",
            "Conditional.",
            "Etiquette.",
        ],
        ["Wren Hale", "DBN", "DBN", "Pass", "Forms 1-3."],
        ["Kit B", "White", "Yellow Stripe", "Pass", ""],
        ["Omar Haddad", "Yellow", "Blue Stripe", "Fail", "Kicks."],
        [],
        ["Ruby Moss", "Blue Stripe", "Blue", "Pass", "Caught up a week later."],
    ],
    "122025": [
        [*MAIN_TABLE_HEADER, None, None, "Missing"],
        [
            "Theo Rowan",
            "Yellow Stripe",
            "Yellow",
            "Pass",
            "",
            None,
            None,
            "Omar",
            "Away, rang in",
        ],
        ["Omar Haddad", None, "Blue Stripe", "Pass", "Second try."],
        ["Ruby Moss", "Blue", "Red Stripe", "Fail", ""],
        ["Rubi Moss", "Blue", "Red Stripe", "Fail", ""],
        ["Test entry", None, None, "System error", ""],
        [None, None, None, None, "Ran on: needs more power."],
    ],
    "032026": [
        [*MAIN_TABLE_HEADER, None, "Did not attend", "Current belt"],
        [
            "Teo Rowan",
            "Yellow",
            "Blue Stripe",
            "Pass",
            "",
            "Good spirit, talk to parents.",
            "Finn C",
            "Red stripe?",
            "Paid?",
        ],
        ["Fin Cole", "Red Stripe", "Red", "Pass", ""],
        ["Sam P", "White", "Yellow Stripe", "Pass", ""],
        ["Sam P", "DBN", "DBN", "Conditional", "Owner to decide."],
        ["Kit B", "Yellow Stripe", "Yellow", "Pass", ""],
        ["Kit B", "Yellow Stripe", "Yellow", None, ""],
        ["Wren Hale", "DBN", "DNB", "N/A", ""],
        ["Ruby Moss", "Bown Stripe", "Red Stripe", "Testing? KSN Example: No", ""],
    ],
    "092026": [
        ["Name", "Name", "Current Rank", "Testing For", "Outcome", "Comments"],
        ["Theo Rowan", "Theo Rowan", "Blue Stripe", "Blue", "Pass", ""],
        ["Fin Cole", "Fin Cole", "Red", "Brown Stripe", "DNA", ""],
        [
            "Lena Ash",
            "Lena Ash",
            "White",
            "Yellow Stripe",
            "Pass",
            "",
            "These three: work on breathing.",
        ],
        ["Mo Ito", "Mo Ito", "White", "Yellow Stripe", "Pass", ""],
        ["Ari Lund", "Ari Lund", "White", "Yellow Stripe", "Fail", ""],
    ],
}
HISTORY_MERGES: dict[str, list[str]] = {"092026": ["G4:G6"]}


def history_workbook() -> bytes:
    """HISTORY_SHEETS as a workbook, with HISTORY_MERGES merged."""

    def build(workbook: Workbook) -> None:
        for title, rows in HISTORY_SHEETS.items():
            ws = workbook.create_sheet(title)
            for row in rows:
                ws.append(row)
            for cells in HISTORY_MERGES.get(title, []):
                ws.merge_cells(cells)

    return workbook_bytes(build)


type GradingSheets = Mapping[str, Sequence[Sequence[object]]]


def grading_workbook(sheets: GradingSheets) -> bytes:
    """A workbook of grading sheets by title, each with the main table's
    header and the rows given."""

    def build(workbook: Workbook) -> None:
        workbook.properties.title = "saved again"
        for title, rows in sheets.items():
            ws = workbook.create_sheet(title)
            ws.append(MAIN_TABLE_HEADER)
            for row in rows:
                ws.append(list(row))

    return workbook_bytes(build)


def unaccounted_workbook(outcome: str) -> bytes:
    """One sheet: Ines graded in the main table, and Inez Varga beside it in
    an Unaccounted table with `outcome`."""

    def build(workbook: Workbook) -> None:
        sheet = workbook.create_sheet("062025")
        sheet.append([*MAIN_TABLE_HEADER, "Unaccounted", "Outcome", "Comments"])
        sheet.append(
            ["Ines", "Yellow Stripe", "Yellow", "Pass", "", "Inez Varga", outcome],
        )

    return workbook_bytes(build)


def check_roster(
    batch: ImportBatch,
    *,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> StudentImportPreview:
    """Match a roster's columns and make its fixes the way the import screens
    do (save_import_mapping, then correct_import_row for each row, keyed by
    row number), and return what checking every row found. Whole-file values
    and kept columns already saved stay as they are."""
    saved = ImportBatch.objects.get(pk=batch.pk).configuration
    save_import_mapping(
        batch,
        column_mapping=column_mapping,
        defaults=saved.defaults,
        extra_columns=saved.extra_columns,
    )
    for row_number, changes in (corrections or {}).items():
        correct_import_row(batch, row_number=int(row_number), changes=dict(changes))
    # The same check every save above has just run and stored on the rows.
    return _classify_roster(ImportBatch.objects.get(pk=batch.pk))


def commit_roster(
    batch: ImportBatch,
    *,
    actor: User,
    column_mapping: dict[str, str],
    corrections: dict[str, dict[str, str]] | None = None,
) -> ImportBatch:
    """check_roster, then finish the import from what it stored."""
    check_roster(batch, column_mapping=column_mapping, corrections=corrections)
    return commit_student_import(batch, actor=actor)


def students_to_link_to() -> None:
    """Past gradings start only once there are students to link them to
    (data_imports.services.why_not_startable): one, named like no one in
    the test workbooks, when there are none yet."""
    if not Student.objects.exists():
        student(first_name="Quorra", last_name="Vantablack", wksa_id="999-9-999")


def legacy_batch(
    content: bytes | None = None,
    uploaded_by: User | None = None,
) -> ImportBatch:
    payload = content or standard_workbook(
        [["A. Example", "Yellow Belt", "Blue Stripe", "Pass", ""]],
    )
    students_to_link_to()
    result = create_import_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        upload=SimpleUploadedFile("workbook.xlsx", payload),
        uploaded_by=uploaded_by or _administrator(),
    )
    return result.batch


def legacy_record(
    *,
    student: Student | None = None,
    **overrides: object,
) -> LegacyGradingRecord:
    """One imported record, its own person unless given one (or a sheet
    note); linked to `student` when one is given."""
    number = next(_sequence)
    data: dict[str, object] = {
        "record_kind": LegacyRecordKind.GRADING_RESULT,
        "source_sheet": "06-2025",
        "source_locator": f"06-2025!R{number}",
        "cycle_year": 2025,
        "cycle_month": 6,
        "source_name": str(student) if student else "A. Example",
    }
    data.update(overrides)
    if "source_batch" not in data:
        data["source_batch"] = legacy_batch()
    if "person" not in data and data["source_name"] != SHEET_NOTE_NAME:
        data["person"] = LegacyPerson.objects.create(
            confidence=LegacyPersonConfidence.HIGH,
        )
    # Saved one at a time, through the model's own full validation.
    record = LegacyGradingRecord.objects.create(**data)
    if student is None:
        return record
    return link_legacy_record_to_student(record, student, actor=_administrator())
