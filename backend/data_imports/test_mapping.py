"""A roster maps onto KukGrade's own fields (import overhaul A4).

Whatever matches a field is imported there; a field the file lacks can be
given once for the whole file; a column KukGrade has no field for can be kept
as the student's extra information. Synthetic files only.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.models import ImportBatch
from data_imports.services import commit_student_import, save_import_mapping
from data_imports.tests import admin_user, student_workbook, upload_batch
from kukgrade.testing import results
from students.models import Student, StudentExtraInfo
from students.services import create_student, delete_student

pytestmark = pytest.mark.django_db

BASE = "/api/data-imports/batches/"
HEADERS = ["ID", "First", "Last", "Born", "Belt", "Parent phone", "Notes"]
MAPPING = {
    "wksa_id": "ID",
    "first_name": "First",
    "last_name": "Last",
    "date_of_birth": "Born",
}


def club_file(*rows: list[object], admin: User | None = None) -> ImportBatch:
    return upload_batch(
        content=student_workbook(list(rows), headers=HEADERS),
        uploaded_by=admin,
    )


def row(wksa_id: str, belt: str = "", phone: str = "", notes: str = "") -> list[object]:
    return [wksa_id, "Alex", f"Kim {wksa_id}", "2012-05-01", belt, phone, notes]


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- whole-file values ---------------------------------------------------------


def test_a_whole_file_rank_fills_a_missing_column() -> None:
    batch = club_file(row("206-2-001"), row("206-2-002"))

    save_import_mapping(
        batch, column_mapping=MAPPING, defaults={"current_rank": "White"}
    )

    assert set(batch.rows.values_list("outcome", flat=True)) == {"READY"}
    commit_student_import(batch, actor=admin_user("whole-file@example.com"))
    assert set(Student.objects.values_list("current_rank__code", flat=True)) == {
        "WHITE"
    }


def test_a_whole_file_value_fills_only_blank_cells() -> None:
    batch = club_file(row("206-2-001", belt="Yellow"), row("206-2-002"))

    save_import_mapping(
        batch,
        column_mapping={**MAPPING, "current_rank": "Belt"},
        defaults={"current_rank": "White", "status": "inactive"},
    )
    commit_student_import(batch, actor=admin_user("blank-cells@example.com"))

    assert dict(Student.objects.values_list("wksa_id", "current_rank__code")) == {
        "206-2-001": "YELLOW",
        "206-2-002": "WHITE",
    }
    assert set(Student.objects.values_list("status", flat=True)) == {"INACTIVE"}


def test_without_a_column_or_a_whole_file_value_a_required_field_is_refused() -> None:
    admin = admin_user()
    batch = club_file(row("206-2-001"), admin=admin)

    response = client_for(admin).post(
        f"{BASE}{batch.pk}/mapping/",
        {"column_mapping": MAPPING},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["column_mapping"] == [
        "Choose a column for: current_rank.",
    ]


@pytest.mark.parametrize(
    ("defaults", "message"),
    [
        ({"wksa_id": "206-2-001"}, "Only current rank and status"),
        ({"date_of_birth": "2012-01-01"}, "Only current rank and status"),
        (
            {"current_rank": "White", "status": "GONE"},
            "Status 'GONE' is not recognised.",
        ),
    ],
)
def test_only_rank_and_status_can_be_given_for_everyone(
    defaults: dict[str, str],
    message: str,
) -> None:
    admin = admin_user()
    batch = club_file(row("206-2-001"), admin=admin)

    response = client_for(admin).post(
        f"{BASE}{batch.pk}/mapping/",
        {"column_mapping": {**MAPPING, "current_rank": "Belt"}, "defaults": defaults},
        format="json",
    )

    assert response.status_code == 400
    assert message in str(response.json()["error"]["fields"]["defaults"])


def test_a_whole_file_rank_must_be_a_rank_kukgrade_knows() -> None:
    batch = club_file(row("206-2-001"))

    with pytest.raises(ValidationError) as refused:
        save_import_mapping(
            batch, column_mapping=MAPPING, defaults={"current_rank": "Purple"}
        )

    assert refused.value.message_dict["defaults"] == [
        "'Purple' is not a rank KukGrade recognises.",
    ]


# --- columns named must be the file's own ----------------------------------------


@pytest.mark.parametrize(
    ("mapping", "extra", "field", "message"),
    [
        (
            {**MAPPING, "current_rank": "Rank"},
            [],
            "column_mapping",
            "no column named 'Rank'",
        ),
        ({**MAPPING, "current_rank": "Belt"}, ["Email"], "extra_columns", "'Email'"),
        (
            {**MAPPING, "current_rank": "Belt"},
            ["Belt"],
            "extra_columns",
            "cannot also be kept",
        ),
    ],
)
def test_a_column_named_must_be_in_the_file_and_used_once(
    mapping: dict[str, str],
    extra: list[str],
    field: str,
    message: str,
) -> None:
    batch = club_file(row("206-2-001", belt="White"))

    with pytest.raises(ValidationError) as refused:
        save_import_mapping(batch, column_mapping=mapping, extra_columns=extra)

    assert message in " ".join(refused.value.message_dict[field])


def test_a_kept_columns_heading_must_fit_a_label() -> None:
    long_heading = "Parent " * 30
    batch = upload_batch(
        content=student_workbook(
            [["206-2-001", "Alex", "Kim", "2012-05-01", "White", "x"]],
            headers=["ID", "First", "Last", "Born", "Belt", long_heading.strip()],
        ),
    )

    with pytest.raises(ValidationError, match="at most 150 characters"):
        save_import_mapping(
            batch,
            column_mapping={**MAPPING, "current_rank": "Belt"},
            extra_columns=[long_heading.strip()],
        )


# --- extra information -------------------------------------------------------------


def test_kept_columns_become_each_new_students_extra_information() -> None:
    admin = admin_user()
    batch = club_file(
        row("206-2-001", "White", phone="07700 900001", notes="Asthma inhaler"),
        row("206-2-002", "White", phone="", notes="Left-handed"),
        admin=admin,
    )
    save_import_mapping(
        batch,
        column_mapping={**MAPPING, "current_rank": "Belt"},
        extra_columns=["Parent phone", "Notes"],
    )
    client = client_for(admin)

    shown = results(client.get(f"{BASE}{batch.pk}/rows/"))
    assert shown[0]["extra"] == {
        "Parent phone": "07700 900001",
        "Notes": "Asthma inhaler",
    }
    assert shown[1]["extra"] == {"Notes": "Left-handed"}
    assert client.get(f"{BASE}{batch.pk}/").json()["extra_columns"] == [
        "Parent phone",
        "Notes",
    ]

    commit_student_import(batch, actor=admin)

    first = Student.objects.get(wksa_id="206-2-001")
    kept = {info.label: info for info in first.extra_information.all()}
    assert {label: info.value for label, info in kept.items()} == {
        "Notes": "Asthma inhaler",
        "Parent phone": "07700 900001",
    }
    assert {info.source_import for info in kept.values()} == {batch.pk}
    second = Student.objects.get(wksa_id="206-2-002")
    assert list(second.extra_information.values_list("label", flat=True)) == ["Notes"]

    detail = client.get(f"/api/students/{first.pk}/").json()
    assert detail["extra_information"] == [
        {"label": "Notes", "value": "Asthma inhaler"},
        {"label": "Parent phone", "value": "07700 900001"},
    ]


def test_an_existing_student_is_skipped_and_their_extra_information_left_alone() -> (
    None
):
    from datetime import date

    from ranks.models import Rank

    admin = admin_user()
    create_student(
        wksa_id="206-2-001",
        first_name="Already",
        last_name="Here",
        date_of_birth=date(2012, 5, 1),
        current_rank=Rank.objects.get(code="WHITE"),
        actor=admin,
    )
    batch = club_file(row("206-2-001", "White", notes="From the file"), admin=admin)
    save_import_mapping(
        batch,
        column_mapping={**MAPPING, "current_rank": "Belt"},
        extra_columns=["Notes"],
    )

    commit_student_import(batch, actor=admin)

    assert not StudentExtraInfo.objects.exists()


def test_extra_information_goes_with_the_student() -> None:
    admin = admin_user()
    batch = club_file(row("206-2-001", "White", notes="A note"), admin=admin)
    save_import_mapping(
        batch,
        column_mapping={**MAPPING, "current_rank": "Belt"},
        extra_columns=["Notes"],
    )
    commit_student_import(batch, actor=admin)

    delete_student(Student.objects.get(), admin)

    assert not StudentExtraInfo.objects.exists()


def test_the_current_screens_check_keeps_the_whole_file_values() -> None:
    from data_imports.services import preview_student_import

    batch = club_file(row("206-2-001"))
    save_import_mapping(
        batch, column_mapping=MAPPING, defaults={"current_rank": "White"}
    )

    preview: Any = preview_student_import(batch, column_mapping=MAPPING)

    assert preview.ready == 1


@pytest.mark.parametrize(
    ("written", "code", "issue"),
    [
        ("White Belt", "WHITE", ""),
        ("yellow belt", "YELLOW", ""),
        ("DBN", "DAHN_BO", ""),
        (
            "Red stripe?",
            None,
            "Rank 'Red stripe?' is marked as uncertain in the file: confirm it.",
        ),
        ("Bown Stripe", None, "Rank 'Bown Stripe' is not a rank KukGrade recognises."),
    ],
)
def test_a_roster_takes_the_clubs_own_rank_spellings_but_never_a_doubt_or_a_slip(
    written: str,
    code: str | None,
    issue: str,
) -> None:
    admin = admin_user()
    batch = club_file(row("206-2-001", belt=written), admin=admin)

    save_import_mapping(batch, column_mapping={**MAPPING, "current_rank": "Belt"})

    stored = batch.rows.get()
    if code is None:
        assert stored.outcome == "REVIEW_REQUIRED"
        assert issue in stored.issues
    else:
        assert stored.outcome == "READY"
        commit_student_import(batch, actor=admin)
        assert Student.objects.get().current_rank.code == code


def test_a_whole_file_rank_may_be_written_the_clubs_way() -> None:
    batch = club_file(row("206-2-001"))

    save_import_mapping(
        batch, column_mapping=MAPPING, defaults={"current_rank": "White Belt"}
    )

    assert batch.rows.get().outcome == "READY"
