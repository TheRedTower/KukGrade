"""Choosing a roster's sheet, and undoing a wrong historical import (A7).

A roster on another tab of a workbook is no longer silently missed; a wrong
workbook imported is voided as a whole, since a record is never deleted
(import Decision 16). Synthetic files only.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl.workbook import Workbook
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.models import ImportBatch
from data_imports.services import (
    choose_import_sheet,
    commit_legacy_grading_import,
    commit_student_import,
    create_import_batch,
    save_import_mapping,
    void_import_records,
)
from data_imports.testing import standard_workbook, workbook_bytes
from data_imports.tests import (
    CLEAN_ROW,
    STANDARD_MAPPING,
    STANDARD_STUDENT_HEADERS,
    admin_user,
    instructor_user,
    student_workbook,
    upload_batch,
)
from gradings.legacy_services import link_legacy_record_to_student, void_legacy_record
from gradings.models import LegacyGradingRecord
from gradings.read_models import unified_student_grading_history
from students.models import Student

pytestmark = pytest.mark.django_db

BASE = "/api/data-imports/batches/"
HEADERS = list(STANDARD_STUDENT_HEADERS.values())


def two_sheet_workbook() -> bytes:
    def build(workbook: Workbook) -> None:
        cover = workbook.create_sheet("Notes", 0)
        cover.append(["This roster is on the next tab."])
        roster = workbook.create_sheet("Roster")
        roster.append(HEADERS)
        roster.append(CLEAN_ROW)
        roster.append(["206-2-501", "Blair", "Park", "2013-06-02", "Yellow", ""])
        workbook.active = 0

    return workbook_bytes(build)


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- choosing the sheet -----------------------------------------------------------


def test_the_sheet_read_and_every_sheets_name_are_shown() -> None:
    admin = admin_user()
    batch = upload_batch(content=two_sheet_workbook(), uploaded_by=admin)

    detail = client_for(admin).get(f"{BASE}{batch.pk}/").json()

    assert detail["sheet"] == "Notes"
    assert "Roster" in detail["sheet_names"]
    assert detail["row_counts"]["total"] == 0


def test_a_sheet_can_be_named_at_upload() -> None:
    admin = admin_user()

    response = client_for(admin).post(
        BASE,
        {
            "kind": "STUDENT_ROSTER",
            "file": SimpleUploadedFile("roster.xlsx", two_sheet_workbook()),
            "sheet": "Roster",
        },
        format="multipart",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["detected_headers"] == HEADERS
    batch = ImportBatch.objects.get(pk=response.json()["id"])
    assert batch.rows.count() == 2


def test_a_sheet_the_workbook_lacks_is_refused_at_upload() -> None:
    with pytest.raises(ValidationError, match="no sheet named 'Elsewhere'"):
        create_import_batch(
            kind=ImportBatch.Kind.STUDENT_ROSTER,
            upload=SimpleUploadedFile("roster.xlsx", two_sheet_workbook()),
            uploaded_by=admin_user(),
            sheet="Elsewhere",
        )
    assert not ImportBatch.objects.exists()


@pytest.mark.parametrize(
    ("kind", "filename", "content"),
    [
        (
            "STUDENT_ROSTER",
            "roster.csv",
            lambda: student_workbook([CLEAN_ROW], file_format="csv"),
        ),
        (
            "LEGACY_GRADINGS",
            "workbook.xlsx",
            lambda: standard_workbook([["A. Example", "White", "Yellow", "Pass", ""]]),
        ),
    ],
)
def test_only_a_roster_workbook_takes_a_sheet_at_upload(
    kind: str,
    filename: str,
    content: Any,
) -> None:
    with pytest.raises(ValidationError, match="Only a roster workbook"):
        create_import_batch(
            kind=kind,
            upload=SimpleUploadedFile(filename, content()),
            uploaded_by=admin_user(),
            sheet="Roster",
        )
    assert not ImportBatch.objects.exists()


def test_choosing_another_sheet_reads_it_and_forgets_the_old_matches() -> None:
    admin = admin_user()
    batch = upload_batch(content=two_sheet_workbook(), uploaded_by=admin)

    response = client_for(admin).post(
        f"{BASE}{batch.pk}/sheet/",
        {"sheet": "Roster"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["sheet"] == "Roster"
    assert body["detected_headers"] == HEADERS
    assert body["column_mapping"] == {}
    assert body["next_step"] == "MATCH_COLUMNS"
    assert body["row_counts"]["total"] == 2
    save_import_mapping(batch, column_mapping=STANDARD_MAPPING)
    commit_student_import(batch, actor=admin)
    assert Student.objects.count() == 2


def test_choosing_a_sheet_needs_one_the_workbook_has_and_an_open_import() -> None:
    admin = admin_user()
    batch = upload_batch(content=two_sheet_workbook(), uploaded_by=admin)
    with pytest.raises(ValidationError, match="no sheet named 'Elsewhere'"):
        choose_import_sheet(batch, sheet="Elsewhere")

    csv = upload_batch(
        content=student_workbook([CLEAN_ROW], file_format="csv"),
        filename="roster.csv",
        uploaded_by=admin,
    )
    with pytest.raises(ValidationError, match="no sheet named 'Roster'"):
        choose_import_sheet(csv, sheet="Roster")

    choose_import_sheet(batch, sheet="Roster")
    save_import_mapping(batch, column_mapping=STANDARD_MAPPING)
    commit_student_import(batch, actor=admin)
    with pytest.raises(ValidationError, match="already imported"):
        choose_import_sheet(batch, sheet="Notes")


# --- voiding a wrong historical import ----------------------------------------------


def finished_workbook(admin: User) -> ImportBatch:
    batch = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook(
            [
                ["A. Example", "White", "Yellow", "Pass", "Good."],
                ["B. Example", "White", "Yellow", "Fail", ""],
                ["C. Example", "White", "Yellow", "Pass", ""],
            ],
        ),
        uploaded_by=admin,
    )
    return commit_legacy_grading_import(batch, actor=admin)


def test_a_wrong_import_is_voided_as_a_whole_each_record_audited() -> None:
    admin = admin_user()
    batch = finished_workbook(admin)

    response = client_for(admin).post(
        f"{BASE}{batch.pk}/void-records/",
        {"reason": "Wrong workbook"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json() == {"voided": 3}
    assert set(LegacyGradingRecord.objects.values_list("is_void", flat=True)) == {True}
    assert set(LegacyGradingRecord.objects.values_list("void_reason", flat=True)) == {
        "Wrong workbook",
    }
    events = AuditEvent.objects.filter(action=AuditAction.LEGACY_GRADING_VOIDED)
    assert events.count() == 3
    assert {event.metadata["whole_import"] for event in events} == {True}


def test_a_voided_import_leaves_its_students_history() -> None:
    from datetime import date

    from ranks.models import Rank

    admin = admin_user()
    batch = finished_workbook(admin)
    alex = Student.objects.create(
        wksa_id="206-2-777",
        first_name="Alex",
        last_name="Example",
        date_of_birth=date(2012, 5, 1),
        current_rank=Rank.objects.get(code="YELLOW"),
    )
    record = LegacyGradingRecord.objects.get(source_name="A. Example")
    link_legacy_record_to_student(record, alex, actor=admin)
    assert len(unified_student_grading_history(alex)["items"]) == 1

    void_import_records(batch, reason="Wrong workbook", actor=admin)

    assert unified_student_grading_history(alex)["items"] == []


def test_records_voided_already_are_left_and_a_second_void_refused() -> None:
    admin = admin_user()
    batch = finished_workbook(admin)
    one = LegacyGradingRecord.objects.get(source_name="A. Example")
    void_legacy_record(one, reason="Entered twice", actor=admin)

    assert void_import_records(batch, reason="Wrong workbook", actor=admin) == 2
    one.refresh_from_db()
    assert one.void_reason == "Entered twice"
    with pytest.raises(ValidationError, match="already voided"):
        void_import_records(batch, reason="Again", actor=admin)


def test_only_a_finished_historical_import_can_be_voided() -> None:
    admin = admin_user()
    roster = upload_batch(content=student_workbook([CLEAN_ROW]), uploaded_by=admin)
    open_workbook = upload_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        content=standard_workbook([["A. Example", "White", "Yellow", "Pass", ""]]),
        uploaded_by=admin,
    )

    for batch in (roster, open_workbook):
        with pytest.raises(ValidationError, match="Only a finished historical"):
            void_import_records(batch, reason="Wrong file", actor=admin)


def test_voiding_needs_a_reason_and_a_reconciler() -> None:
    admin = admin_user()
    batch = finished_workbook(admin)

    blank = client_for(admin).post(
        f"{BASE}{batch.pk}/void-records/",
        {"reason": ""},
        format="json",
    )
    refused = client_for(instructor_user()).post(
        f"{BASE}{batch.pk}/void-records/",
        {"reason": "Wrong workbook"},
        format="json",
    )

    assert blank.status_code == 400
    assert refused.status_code == 403
    assert not LegacyGradingRecord.objects.filter(is_void=True).exists()
