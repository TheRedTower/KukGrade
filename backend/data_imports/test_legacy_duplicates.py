"""A workbook saved again imports the same history twice unless warned.

The same-file warning goes by the file's bytes; a re-saved workbook has other
bytes and the same records. The check is by what the records are: sheet,
position, name and month. It warns and marks the rows; it never blocks.
"""

from __future__ import annotations

import pytest
from openpyxl.workbook import Workbook

from accounts.models import User
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    DUPLICATE_OF_EARLIER_IMPORT,
    commit_legacy_grading_import,
    preview_legacy_grading_import,
    set_import_row_excluded,
)
from data_imports.testing import (
    MAIN_TABLE_HEADER,
    legacy_batch,
    standard_workbook,
    workbook_bytes,
)
from data_imports.tests import admin_user
from gradings.legacy_services import void_legacy_record
from gradings.models import LegacyGradingRecord

pytestmark = pytest.mark.django_db

ROWS: list[list[object]] = [
    ["A. Example", "Yellow Belt", "Blue Stripe", "Pass", ""],
    ["B. Second", "White", "Yellow Stripe", "Fail", ""],
]


def resaved(rows: list[list[object]], sheet: str = "06-2025") -> bytes:
    """The same history in a file with other bytes, as saving it again does."""

    def build(workbook: Workbook) -> None:
        workbook.properties.title = "saved again"
        info = workbook.create_sheet("Information")
        info.append(["This workbook contains historical grading records."])
        ws = workbook.create_sheet(sheet)
        ws.append(MAIN_TABLE_HEADER)
        for row in rows:
            ws.append(row)

    return workbook_bytes(build)


def commit_first(rows: list[list[object]] = ROWS) -> ImportBatch:
    batch = legacy_batch(standard_workbook(rows), uploaded_by=import_admin())
    commit_legacy_grading_import(batch, actor=import_admin())
    return batch


def import_admin() -> User:
    """The one administrator every step of a test acts as."""
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user("import-admin@example.com")
    )


def issues_by_name(batch: ImportBatch) -> dict[str, list[str]]:
    return {
        row.values["name"]: row.issues for row in ImportRow.objects.filter(batch=batch)
    }


def test_a_saved_again_workbook_is_warned_about_and_its_rows_marked() -> None:
    commit_first()
    second = legacy_batch(resaved(ROWS))

    preview = preview_legacy_grading_import(second)

    assert any("2 records in this workbook match" in w for w in preview.warnings)
    assert all(
        DUPLICATE_OF_EARLIER_IMPORT in issues
        for issues in issues_by_name(second).values()
    )
    assert preview.worth_a_look == 2


def test_the_warning_is_the_only_effect_and_importing_again_is_still_allowed() -> None:
    commit_first()
    second = legacy_batch(resaved(ROWS))

    preview_legacy_grading_import(second)
    commit_legacy_grading_import(second, actor=import_admin())

    assert LegacyGradingRecord.objects.count() == 4


def test_only_the_rows_an_earlier_import_holds_are_marked() -> None:
    commit_first()
    second = legacy_batch(
        resaved([ROWS[0], ["C. Newcomer", "White", "Yellow Stripe", "Pass", ""]]),
    )

    preview = preview_legacy_grading_import(second)

    marked = issues_by_name(second)
    assert DUPLICATE_OF_EARLIER_IMPORT in marked["A. Example"]
    assert DUPLICATE_OF_EARLIER_IMPORT not in marked["C. Newcomer"]
    assert any("1 record in this workbook matches" in w for w in preview.warnings)


def test_another_month_or_another_name_is_not_a_repeat() -> None:
    commit_first()
    other_month = legacy_batch(resaved(ROWS, sheet="07-2025"))

    preview = preview_legacy_grading_import(other_month)

    assert not any("earlier import" in w for w in preview.warnings)
    assert all(
        DUPLICATE_OF_EARLIER_IMPORT not in issues
        for issues in issues_by_name(other_month).values()
    )


def test_a_voided_earlier_record_is_not_a_repeat() -> None:
    commit_first()
    for record in LegacyGradingRecord.objects.all():
        void_legacy_record(record, reason="Set aside.", actor=import_admin())
    second = legacy_batch(resaved(ROWS))

    preview = preview_legacy_grading_import(second)

    assert not any("earlier import" in w for w in preview.warnings)


def test_rows_left_out_are_not_counted_in_the_warning() -> None:
    commit_first()
    second = legacy_batch(resaved(ROWS))
    left_out = ImportRow.objects.get(batch=second, values__name="B. Second")
    set_import_row_excluded(second, row_number=left_out.row_number, excluded=True)

    preview = preview_legacy_grading_import(second)

    assert any("1 record in this workbook matches" in w for w in preview.warnings)


def test_the_first_upload_of_a_history_has_no_warning() -> None:
    first = legacy_batch(standard_workbook(ROWS))

    preview = preview_legacy_grading_import(first)

    assert not any("earlier import" in w for w in preview.warnings)


def test_the_marking_survives_a_change_of_rank_choices() -> None:
    commit_first()
    second = legacy_batch(resaved(ROWS))

    preview_legacy_grading_import(second, rank_mappings={"Yellow Belt": "YELLOW"})

    assert all(
        DUPLICATE_OF_EARLIER_IMPORT in issues
        for issues in issues_by_name(second).values()
    )
