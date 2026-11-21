"""Past gradings wait for the students: they are linked to students and never
create one (data_imports.services.why_not_startable)."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.models import ImportBatch
from data_imports.services import STUDENTS_FIRST, create_import_batch
from data_imports.testing import standard_workbook, students_to_link_to
from data_imports.tests import CLEAN_ROW, admin_user, instructor_user, student_workbook

pytestmark = pytest.mark.django_db

STARTS = "/api/data-imports/batches/starts/"


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def workbook() -> SimpleUploadedFile:
    return SimpleUploadedFile(
        "workbook.xlsx",
        standard_workbook([["A. Example", "White", "Yellow", "Pass", ""]]),
    )


def test_past_gradings_are_refused_until_there_are_students() -> None:
    with pytest.raises(ValidationError) as refusal:
        create_import_batch(
            kind=ImportBatch.Kind.LEGACY_GRADINGS,
            upload=workbook(),
            uploaded_by=admin_user(),
        )

    assert refusal.value.message_dict == {"kind": [STUDENTS_FIRST]}
    assert not ImportBatch.objects.exists()


def test_students_can_be_imported_first_and_past_gradings_after() -> None:
    admin = admin_user()
    roster = create_import_batch(
        kind=ImportBatch.Kind.STUDENT_ROSTER,
        upload=SimpleUploadedFile("roster.xlsx", student_workbook([CLEAN_ROW])),
        uploaded_by=admin,
    )
    students_to_link_to()
    past = create_import_batch(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        upload=workbook(),
        uploaded_by=admin,
    )

    assert roster.batch.pk and past.batch.pk


def test_the_api_refuses_past_gradings_under_the_kind() -> None:
    response = client_for(admin_user()).post(
        "/api/data-imports/batches/",
        {"kind": ImportBatch.Kind.LEGACY_GRADINGS, "file": workbook()},
        format="multipart",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["kind"] == [STUDENTS_FIRST]


def test_each_kind_says_whether_it_can_start_and_why_not() -> None:
    client = client_for(admin_user())

    assert client.get(STARTS).json() == [
        {"kind": "STUDENT_ROSTER", "why_not": None},
        {"kind": "LEGACY_GRADINGS", "why_not": STUDENTS_FIRST},
    ]
    students_to_link_to()
    assert client.get(STARTS).json() == [
        {"kind": "STUDENT_ROSTER", "why_not": None},
        {"kind": "LEGACY_GRADINGS", "why_not": None},
    ]


def test_only_someone_who_can_import_is_told() -> None:
    assert client_for(instructor_user()).get(STARTS).status_code == 403
    assert APIClient().get(STARTS).status_code in {401, 403}
