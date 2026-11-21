"""The people from the imported history, read through the API: the list,
one person, and the counts. Made-up names only."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.models import ImportBatch
from data_imports.services import commit_legacy_grading_import
from data_imports.testing import grading_workbook, history_workbook, legacy_batch
from data_imports.tests import admin_user, instructor_user
from gradings.legacy_services import void_legacy_record
from gradings.models import LegacyGradingRecord, LegacyPerson
from gradings.testing import rank, student

pytestmark = pytest.mark.django_db

PEOPLE = "/api/gradings/legacy-people/"
SUMMARY = "/api/gradings/legacy-people/summary/"


def admin() -> User:
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user()
    )


def client_for(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def commit(content: bytes) -> ImportBatch:
    batch = legacy_batch(content, uploaded_by=admin())
    return commit_legacy_grading_import(batch, actor=admin())


def names(response_data: dict[str, object]) -> list[str]:
    results = response_data["results"]
    assert isinstance(results, list)
    return [person["name"] for person in results]


def test_the_people_list_says_who_each_is_and_where_they_wait() -> None:
    student(first_name="Theo", last_name="Rowan", current_rank=rank("BLUE"))
    commit(history_workbook())

    response = client_for(admin()).get(PEOPLE, {"search": "rowan"})

    assert response.status_code == 200
    [theo] = response.json()["results"]
    assert theo["name"] == "Theo Rowan"
    assert theo["spellings"] == ["Theo R", "Theo Rowan", "Teo Rowan"]
    assert theo["state"] == "PROPOSED"
    assert theo["state_display"] == "Not decided yet"
    assert theo["queue"] == "READY"
    assert theo["queue_display"] == "Ready to confirm"
    assert theo["confidence"] == "HIGH"
    assert theo["record_count"] == 4
    assert (theo["first_period"], theo["last_period"]) == ("2025-06", "2026-09")
    assert theo["suggestion"] == "clear"
    [candidate] = theo["candidates"]
    assert candidate["full_name"] == "Theo Rowan"
    assert theo["reasons"][0] == "Written as “Theo R”, “Theo Rowan”, “Teo Rowan”."


def test_the_people_list_narrows_by_queue_state_and_import() -> None:
    student(first_name="Theo", last_name="Rowan", current_rank=rank("BLUE"))
    history = commit(history_workbook())
    later = commit(
        grading_workbook({"062027": [["Ada Park", "White", "Yellow", "Pass", ""]]}),
    )
    client = client_for(admin())

    assert names(client.get(PEOPLE, {"queue": "READY"}).json()) == ["Theo Rowan"]
    assert names(client.get(PEOPLE, {"batch": later.pk}).json()) == ["Ada Park"]
    assert len(names(client.get(PEOPLE, {"batch": history.pk}).json())) == 15
    assert len(names(client.get(PEOPLE, {"state": "PROPOSED"}).json())) == 16
    # A value no person can have matches none.
    for params in ({"queue": "SOON"}, {"state": "GONE"}, {"batch": "x"}):
        assert names(client.get(PEOPLE, params).json()) == []
    assert client.get(PEOPLE, {"suggestion": "clear"}).status_code == 400


def test_one_person_shows_every_record_oldest_first() -> None:
    commit(history_workbook())
    [wren] = client_for(admin()).get(PEOPLE, {"search": "wren"}).json()["results"]

    response = client_for(admin()).get(f"{PEOPLE}{wren['id']}/")

    assert response.status_code == 200
    records = response.json()["records"]
    assert [(r["cycle_year"], r["cycle_month"]) for r in records] == [
        (2025, 6),
        (2026, 3),
    ]
    assert {r["person"] for r in records} == {wren["id"]}
    assert records[0]["report"] == "Forms 1-3."


def test_a_person_whose_every_record_is_voided_is_not_shown() -> None:
    commit(grading_workbook({"062025": [["Ada Park", "White", "Yellow", "Pass", ""]]}))
    [record_] = LegacyGradingRecord.objects.all()
    void_legacy_record(record_, reason="Entered by mistake.", actor=admin())
    person = LegacyPerson.objects.get()

    client = client_for(admin())
    assert names(client.get(PEOPLE).json()) == []
    assert client.get(f"{PEOPLE}{person.pk}/").status_code == 404
    assert client.get(SUMMARY).json()["people"] == 0


def test_the_summary_counts_people_by_state_and_queue() -> None:
    student(first_name="Theo", last_name="Rowan", current_rank=rank("BLUE"))
    student(first_name="Omar", last_name="Haddad", current_rank=rank("BLUE"))
    history = commit(history_workbook())

    response = client_for(admin()).get(SUMMARY, {"batch": history.pk})

    assert response.status_code == 200
    assert response.json() == {
        "people": 15,
        "sorted": 0,
        "proposed": 15,
        "linked": 0,
        "not_a_student": 0,
        "later": 0,
        # Theo fits clearly; Omar fits, but his records may not be one person.
        "ready": 1,
        "needs_a_look": 1,
        "no_student": 13,
    }


@pytest.mark.parametrize("path", [PEOPLE, SUMMARY, f"{PEOPLE}1/"])
def test_only_those_who_reconcile_history_may_read_people(path: str) -> None:
    commit(grading_workbook({"062025": [["Ada Park", "White", "Yellow", "Pass", ""]]}))
    person = LegacyPerson.objects.get()
    path = path.replace("/1/", f"/{person.pk}/")

    assert client_for(instructor_user()).get(path).status_code == 403
    assert client_for(None).get(path).status_code in {401, 403}
    assert client_for(admin()).get(path).status_code == 200


def test_people_cannot_be_changed_through_the_list() -> None:
    commit(grading_workbook({"062025": [["Ada Park", "White", "Yellow", "Pass", ""]]}))
    person = LegacyPerson.objects.get()
    client = client_for(admin())

    assert client.post(PEOPLE, {}, format="json").status_code == 405
    assert client.patch(f"{PEOPLE}{person.pk}/", {}, format="json").status_code == 405
    assert client.delete(f"{PEOPLE}{person.pk}/").status_code == 405


@pytest.mark.parametrize(
    "path",
    [
        "/api/gradings/legacy-records/people/",
        "/api/gradings/legacy-records/people-summary/",
        "/api/gradings/legacy-records/people/set-aside/",
        "/api/gradings/legacy-records/bulk-link/",
        "/api/gradings/legacy-records/bulk-unlink/",
    ],
)
def test_the_per_name_linking_is_gone(path: str) -> None:
    """People are sorted as people now: linking a name as written, and a list
    of names each administrator put aside, are no longer offered."""
    client = client_for(admin())
    assert client.get(path).status_code in {404, 405}
    assert client.post(path, {}, format="json").status_code in {404, 405}


# --- finding a student for a person ------------------------------------------


def students_for(person: LegacyPerson, **params: str) -> list[dict[str, object]]:
    response = client_for(admin()).get(f"{PEOPLE}{person.pk}/students/", params)
    assert response.status_code == 200, response.json()
    results = response.json()["results"]
    assert isinstance(results, list)
    return results


def test_students_found_for_a_person_say_whether_their_rank_fits() -> None:
    commit(
        grading_workbook(
            {
                "062025": [["Ada Park", "White", "Yellow", "Pass", ""]],
                "122025": [["Ada Park", "Yellow", "Blue", "Pass", ""]],
            },
        ),
    )
    person = LegacyPerson.objects.get()
    student(first_name="Ada", last_name="Park", current_rank=rank("BLUE"))
    student(first_name="Ada", last_name="Lee", current_rank=rank("YELLOW"))
    ben_cho = student(first_name="Ben", last_name="Cho", current_rank=rank("RED"))

    found = students_for(person, search="ada")

    assert [(s["full_name"], s["rank_fits"], s["rank_reason"]) for s in found] == [
        ("Ada Lee", False, "Lower rank now (Yellow) than then (Blue)"),
        ("Ada Park", True, "Rank fits: Blue now, Blue then"),
    ]
    assert found[0]["current_rank_name"] == "Yellow"
    assert found[0]["age_band_display"]
    assert found[0]["status_display"] == "Active"
    # The students' own search: by WKSA ID too.
    [ben] = students_for(person, search=ben_cho.wksa_id)
    assert ben["full_name"] == "Ben Cho"
    assert ben["rank_fits"] is True


def test_a_person_whose_records_give_no_rank_fits_no_rank() -> None:
    commit(grading_workbook({"062025": [["Ada Park", "", "", "Pass", ""]]}))
    person = LegacyPerson.objects.get()
    student(first_name="Ada", last_name="Park")

    [found] = students_for(person, search="ada")

    assert (found["rank_fits"], found["rank_reason"]) == (None, "")


def test_finding_students_for_a_person_refuses_what_it_should() -> None:
    commit(grading_workbook({"062025": [["Ada Park", "White", "Yellow", "Pass", ""]]}))
    person = LegacyPerson.objects.get()
    url = f"{PEOPLE}{person.pk}/students/"

    assert client_for(admin()).get(url, {"serach": "ada"}).status_code == 400
    assert client_for(instructor_user()).get(url).status_code == 403
    assert client_for(None).get(url).status_code in {401, 403}

    [record_] = LegacyGradingRecord.objects.filter(person=person)
    void_legacy_record(record_, reason="A bad entry.", actor=admin())
    assert client_for(admin()).get(url).status_code == 404
