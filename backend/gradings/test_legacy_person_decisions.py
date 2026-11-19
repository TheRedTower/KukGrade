"""Deciding about the people from the imported history
(gradings.legacy_person_services): link, not a student, later, reopen, split,
merge and confirm many, each refused when it should be, recorded once by WKSA
ID with no names, and undone. Made-up names only."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, models, transaction
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEntity, AuditEvent
from data_imports.services import choose_legacy_sheets, commit_legacy_grading_import
from data_imports.testing import grading_workbook, legacy_batch
from data_imports.tests import admin_user, instructor_user
from gradings.legacy_people import PersonQueue, people_in
from gradings.legacy_person_services import (
    CHANGED_MESSAGE,
    REOPEN_FIRST_MESSAGE,
    confirm_people,
    leave_for_later,
    link_person,
    mark_not_a_student,
    merge_people,
    reopen_person,
    split_person,
)
from gradings.legacy_services import (
    DECIDED_PERSON_MESSAGE,
    link_legacy_record_to_student,
    unlink_legacy_record_from_student,
    void_legacy_record,
)
from gradings.models import (
    LegacyGradingRecord,
    LegacyPerson,
    LegacyPersonState,
)
from gradings.testing import rank, student
from students.models import Student

pytestmark = pytest.mark.django_db

PEOPLE = "/api/gradings/legacy-people/"

# Ada passes to Yellow, then to Blue: one person, sure of it.
ADA = {
    "062025": [["Ada Park", "White", "Yellow", "Pass", "Good stances."]],
    "122025": [["Ada Park", "Yellow", "Blue", "Pass", ""]],
}
NAMES = ("Ada", "Park", "Ben", "Cho", "Dan", "Fox", "Good stances")


def admin() -> User:
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user()
    )


def commit(sheets: dict[str, list[list[str]]], only: list[str] | None = None) -> None:
    batch = legacy_batch(grading_workbook(sheets), uploaded_by=admin())
    if only is not None:
        choose_legacy_sheets(batch, included=only)
        batch.refresh_from_db()
    commit_legacy_grading_import(batch, actor=admin())


def person_of(name: str) -> LegacyPerson:
    [person] = {
        record_.person
        for record_ in LegacyGradingRecord.objects.filter(
            source_name=name,
            is_void=False,
        ).select_related("person")
    }
    assert person is not None
    return person


def fresh(person: LegacyPerson) -> LegacyPerson:
    return LegacyPerson.objects.get(pk=person.pk)


def live(person: LegacyPerson) -> list[LegacyGradingRecord]:
    return list(
        LegacyGradingRecord.objects.filter(person=person, is_void=False).order_by(
            "cycle_year",
            "cycle_month",
        ),
    )


def ada() -> tuple[LegacyPerson, Student]:
    commit(ADA)
    return person_of("Ada Park"), student(
        first_name="Ada",
        last_name="Park",
        current_rank=rank("BLUE"),
    )


def events(action: str) -> list[AuditEvent]:
    return list(AuditEvent.objects.filter(action=action))


def assert_no_names(event: AuditEvent) -> None:
    """The audit log keeps no name, as written or as a student's."""
    text = f"{event.summary} {event.metadata}"
    for name in NAMES:
        assert name not in text, (name, text)


def assert_records_agree() -> None:
    """After every action: each record but a note has one person, and each
    record a decision covers carries it."""
    with connection.cursor() as cursor:
        # The trigger's checks, run now rather than at the commit.
        cursor.execute("SET CONSTRAINTS legacy_person_records_agree IMMEDIATE")
        cursor.execute("SET CONSTRAINTS legacy_person_records_agree DEFERRED")
    for person in LegacyPerson.objects.all():
        for record_ in live(person):
            if not record_.person_confirmed:
                continue
            if person.state == LegacyPersonState.LINKED:
                assert record_.student_id == person.student_id
            elif person.state == LegacyPersonState.NOT_A_STUDENT:
                assert record_.student_id is None
            assert person.state != LegacyPersonState.PROPOSED


# --- link --------------------------------------------------------------------


def test_linking_a_person_puts_every_record_in_the_students_history() -> None:
    person, ada_park = ada()

    link_person(person.pk, ada_park, version=person.version, actor=admin())

    person = fresh(person)
    assert person.state == LegacyPersonState.LINKED
    assert person.student_id == ada_park.pk
    assert person.decided_by == admin()
    assert person.decided_at is not None
    assert person.version == 2
    assert [(r.student_id, r.person_confirmed) for r in live(person)] == [
        (ada_park.pk, True),
        (ada_park.pk, True),
    ]
    [event] = events(AuditAction.LEGACY_PERSON_LINKED)
    assert event.entity_type == AuditEntity.LEGACY_PERSON
    assert event.entity_id == str(person.pk)
    assert event.summary == (
        f"Historical person {person.pk} linked to student {ada_park.wksa_id}."
    )
    assert event.metadata["student_id"] == ada_park.pk
    assert event.metadata["records"] == 2
    assert_no_names(event)
    assert_records_agree()


def test_linking_again_to_the_same_student_changes_nothing() -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=person.version, actor=admin())

    link_person(person.pk, ada_park, version=2, actor=admin())

    assert fresh(person).version == 2
    assert len(events(AuditAction.LEGACY_PERSON_LINKED)) == 1


def test_linking_again_confirms_the_records_that_joined_since() -> None:
    sheets = {
        **ADA,
        # Holding Blue after passing to it: a strong chain, so it joins.
        "062026": [["Ada Park", "Blue", "Red", "Fail", ""]],
    }
    commit(sheets, only=["062025", "122025"])
    person = person_of("Ada Park")
    ada_park = student(first_name="Ada", last_name="Park", current_rank=rank("BLUE"))
    link_person(person.pk, ada_park, version=person.version, actor=admin())
    commit(sheets, only=["062026"])
    person = fresh(person)
    [view] = people_in(LegacyPerson.objects.filter(pk=person.pk))
    assert view.awaiting_confirmation == 1
    joined = live(person)[-1]
    assert (joined.student_id, joined.person_confirmed) == (None, False)

    link_person(person.pk, ada_park, version=person.version, actor=admin())

    joined.refresh_from_db()
    assert (joined.student_id, joined.person_confirmed) == (ada_park.pk, True)
    second = events(AuditAction.LEGACY_PERSON_LINKED)[0]
    assert second.metadata["newly_confirmed"] == 1
    assert_records_agree()


def test_a_decision_on_a_person_who_changed_since_is_refused() -> None:
    person, ada_park = ada()
    leave_for_later(person.pk, version=person.version, actor=admin())

    with pytest.raises(ValidationError) as refused:
        link_person(person.pk, ada_park, version=1, actor=admin())

    assert refused.value.message_dict == {"version": [CHANGED_MESSAGE]}
    assert fresh(person).state == LegacyPersonState.LATER


def test_a_correction_to_a_record_counts_as_a_change_to_its_person() -> None:
    commit({**ADA, "032026": [["Ada Park", "Blue", "Red", "Pass", ""]]})
    person, ada_park = person_of("Ada Park"), student(first_name="Ada")
    void_legacy_record(live(person)[-1], reason="Entered twice.", actor=admin())

    with pytest.raises(ValidationError) as refused:
        link_person(person.pk, ada_park, version=person.version, actor=admin())

    assert refused.value.message_dict == {"version": [CHANGED_MESSAGE]}


def test_a_linked_person_is_reopened_before_being_linked_elsewhere() -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=1, actor=admin())
    someone_else = student(first_name="Ada", last_name="Parker")

    with pytest.raises(ValidationError) as refused:
        link_person(person.pk, someone_else, version=2, actor=admin())

    assert refused.value.message_dict == {"person": [REOPEN_FIRST_MESSAGE]}
    with pytest.raises(ValidationError):
        mark_not_a_student(person.pk, reason="INSTRUCTOR", version=2, actor=admin())
    with pytest.raises(ValidationError):
        leave_for_later(person.pk, version=2, actor=admin())


def test_a_deleted_student_is_not_linked_to() -> None:
    person, ada_park = ada()
    Student.objects.filter(pk=ada_park.pk).update(deleted_at="2026-11-01T00:00Z")
    ada_park.refresh_from_db()

    with pytest.raises(ValidationError) as refused:
        link_person(person.pk, ada_park, version=1, actor=admin())

    assert "student" in refused.value.message_dict
    assert fresh(person).state == LegacyPersonState.PROPOSED


def test_records_linked_to_another_student_move_only_when_asked() -> None:
    person, ada_park = ada()
    other = student(first_name="Ada", last_name="Parks")
    # Linked one record at a time on the old screen.
    link_legacy_record_to_student(live(person)[0], other, actor=admin())
    person = fresh(person)

    with pytest.raises(ValidationError) as refused:
        link_person(person.pk, ada_park, version=person.version, actor=admin())
    assert "student" in refused.value.message_dict

    link_person(
        person.pk,
        ada_park,
        version=person.version,
        actor=admin(),
        replace=True,
    )
    assert {r.student_id for r in live(person)} == {ada_park.pk}
    [event] = events(AuditAction.LEGACY_PERSON_LINKED)
    # The other student's history shows the move too.
    assert sorted(event.metadata["student_ids"]) == sorted([ada_park.pk, other.pk])


def test_a_decided_persons_records_are_not_linked_one_by_one() -> None:
    person, ada_park = ada()
    first, second = live(person)
    link_person(person.pk, ada_park, version=1, actor=admin())

    with pytest.raises(ValidationError) as refused:
        unlink_legacy_record_from_student(first, actor=admin())
    assert refused.value.message_dict == {"student": [DECIDED_PERSON_MESSAGE]}
    with pytest.raises(ValidationError):
        link_legacy_record_to_student(
            second,
            student(first_name="Ben"),
            actor=admin(),
            replace=True,
        )


# --- not a student, later, reopen --------------------------------------------


def test_not_a_current_student_keeps_the_records_unlinked() -> None:
    person, ada_park = ada()
    link_legacy_record_to_student(live(person)[0], ada_park, actor=admin())
    person = fresh(person)

    mark_not_a_student(
        person.pk,
        reason="INSTRUCTOR",
        note="Ada Park taught the juniors.",
        version=person.version,
        actor=admin(),
    )

    person = fresh(person)
    assert person.state == LegacyPersonState.NOT_A_STUDENT
    assert (person.not_a_student_reason, person.note) == (
        "INSTRUCTOR",
        "Ada Park taught the juniors.",
    )
    assert [(r.student_id, r.person_confirmed) for r in live(person)] == [
        (None, True),
        (None, True),
    ]
    [event] = events(AuditAction.LEGACY_PERSON_NOT_A_STUDENT)
    assert event.summary.endswith("marked not a current student: An instructor.")
    # Whether there is a note, never what it says.
    assert event.metadata["note_given"] is True
    assert event.metadata["student_ids"] == [ada_park.pk]
    assert_no_names(event)
    assert_records_agree()


def test_other_needs_a_note() -> None:
    person, _ = ada()

    with pytest.raises(ValidationError) as refused:
        mark_not_a_student(person.pk, reason="OTHER", version=1, actor=admin())

    assert "note" in refused.value.message_dict


def test_later_is_shared_and_any_decision_can_follow_it() -> None:
    person, ada_park = ada()

    leave_for_later(person.pk, version=1, actor=admin())
    assert fresh(person).state == LegacyPersonState.LATER
    [event] = events(AuditAction.LEGACY_PERSON_LATER)
    assert_no_names(event)

    link_person(person.pk, ada_park, version=2, actor=admin())
    assert fresh(person).state == LegacyPersonState.LINKED
    assert_records_agree()


def test_reopening_undoes_a_link() -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=1, actor=admin())

    reopen_person(person.pk, version=2, actor=admin())

    person = fresh(person)
    assert person.state == LegacyPersonState.PROPOSED
    assert (person.student_id, person.decided_by_id, person.decided_at) == (
        None,
        None,
        None,
    )
    assert [(r.student_id, r.person_confirmed) for r in live(person)] == [
        (None, False),
        (None, False),
    ]
    [event] = events(AuditAction.LEGACY_PERSON_REOPENED)
    assert event.metadata["previous_state"] == LegacyPersonState.LINKED
    assert event.metadata["student_id"] == ada_park.pk
    assert_no_names(event)
    assert_records_agree()


def test_a_person_not_decided_is_not_reopened() -> None:
    person, _ = ada()

    with pytest.raises(ValidationError):
        reopen_person(person.pk, version=1, actor=admin())


# --- split and merge ---------------------------------------------------------


def test_splitting_moves_the_chosen_records_to_a_new_person() -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=1, actor=admin())
    first, second = live(person)

    new_person = split_person(person.pk, [second.pk], version=2, actor=admin())

    assert [r.pk for r in live(person)] == [first.pk]
    assert [r.pk for r in live(new_person)] == [second.pk]
    assert new_person.state == LegacyPersonState.PROPOSED
    second.refresh_from_db()
    # Not Ada's any more: out of her history, and waiting for a decision.
    assert (second.student_id, second.person_confirmed) == (None, False)
    first.refresh_from_db()
    assert first.student_id == ada_park.pk
    [event] = events(AuditAction.LEGACY_PERSON_SPLIT)
    assert event.metadata["new_person_id"] == new_person.pk
    assert event.metadata["records_moved"] == 1
    assert_no_names(event)
    assert_records_agree()


def test_a_split_leaves_a_record_and_moves_only_the_persons_own() -> None:
    person, _ = ada()
    commit({"062026": [["Ben Cho", "White", "Yellow", "Pass", ""]]})
    first, second = live(person)
    bens = live(person_of("Ben Cho"))

    for chosen in ([first.pk, second.pk], [bens[0].pk], []):
        with pytest.raises(ValidationError) as refused:
            split_person(person.pk, chosen, version=1, actor=admin())
        assert "records" in refused.value.message_dict
    assert LegacyPerson.objects.count() == 2


def test_merging_undoes_a_split() -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=1, actor=admin())
    first, second = live(person)
    new_person = split_person(person.pk, [second.pk], version=2, actor=admin())
    person = fresh(person)

    merge_people(
        person.pk,
        new_person.pk,
        version=person.version,
        other_version=new_person.version,
        actor=admin(),
    )

    person = fresh(person)
    assert [r.pk for r in live(person)] == [first.pk, second.pk]
    assert not LegacyPerson.objects.filter(pk=new_person.pk).exists()
    # Linked stays; the record from the other waits for it to be confirmed.
    assert person.state == LegacyPersonState.LINKED
    second.refresh_from_db()
    assert second.person_confirmed is False
    [view] = people_in(LegacyPerson.objects.filter(pk=person.pk))
    assert view.queue == PersonQueue.NEEDS_A_LOOK
    [event] = events(AuditAction.LEGACY_PERSON_MERGED)
    assert event.metadata["merged_person_id"] == new_person.pk
    assert event.metadata["decision_kept"] == LegacyPersonState.LINKED
    assert_no_names(event)
    assert_records_agree()

    link_person(person.pk, ada_park, version=person.version, actor=admin())
    assert {r.student_id for r in live(person)} == {ada_park.pk}


def test_a_merge_keeps_the_firmer_decision() -> None:
    commit({"062025": [["Ben Cho", "White", "Yellow", "Pass", ""]]})
    commit({"122025": [["Benjamin Cho", "Yellow", "Blue", "Pass", ""]]})
    ben, benjamin = person_of("Ben Cho"), person_of("Benjamin Cho")
    if ben.pk == benjamin.pk:
        # Grouped already: split them, to have two.
        benjamin = split_person(
            ben.pk,
            [live(ben)[1].pk],
            version=ben.version,
            actor=admin(),
        )
        ben = fresh(ben)
    mark_not_a_student(
        benjamin.pk,
        reason="NOT_REAL",
        version=benjamin.version,
        actor=admin(),
    )
    benjamin = fresh(benjamin)

    merge_people(
        ben.pk,
        benjamin.pk,
        version=ben.version,
        other_version=benjamin.version,
        actor=admin(),
    )

    ben = fresh(ben)
    assert ben.state == LegacyPersonState.NOT_A_STUDENT
    assert ben.not_a_student_reason == "NOT_REAL"
    assert [r.person_confirmed for r in live(ben)] == [False, True]
    assert_records_agree()


def test_a_merge_is_refused_for_two_results_on_one_sheet_or_two_decisions() -> None:
    commit(
        {
            "062025": [
                ["Ada Park", "White", "Yellow", "Pass", ""],
                ["Ben Cho", "White", "Yellow", "Pass", ""],
            ],
            "122025": [["Dan Fox", "Yellow", "Blue", "Pass", ""]],
        },
    )
    ada_person, ben = person_of("Ada Park"), person_of("Ben Cho")

    with pytest.raises(ValidationError) as refused:
        merge_people(ada_person.pk, ben.pk, version=1, other_version=1, actor=admin())
    assert refused.value.message_dict == {
        "other": ["Two results on one sheet cannot be one person."],
    }

    dan = person_of("Dan Fox")
    link_person(ada_person.pk, student(first_name="Ada"), version=1, actor=admin())
    link_person(dan.pk, student(first_name="Dan"), version=1, actor=admin())
    with pytest.raises(ValidationError) as refused:
        merge_people(ada_person.pk, dan.pk, version=2, other_version=2, actor=admin())
    assert refused.value.message_dict == {
        "other": [
            "These two people have been decided differently. Reopen one of them first.",
        ],
    }
    with pytest.raises(ValidationError):
        merge_people(
            ada_person.pk, ada_person.pk, version=2, other_version=2, actor=admin()
        )


# --- confirm many ------------------------------------------------------------


def two_ready() -> list[tuple[LegacyPerson, Student]]:
    commit(
        {
            **ADA,
            "032026": [["Ben Cho", "White", "Yellow", "Pass", ""]],
            "092026": [["Ben Cho", "Yellow", "Blue", "Pass", ""]],
        },
    )
    pairs = [
        (
            person_of("Ada Park"),
            student(first_name="Ada", last_name="Park", current_rank=rank("BLUE")),
        ),
        (
            person_of("Ben Cho"),
            student(first_name="Ben", last_name="Cho", current_rank=rank("BLUE")),
        ),
    ]
    views = people_in(LegacyPerson.objects.all(), queue=PersonQueue.READY)
    assert {view.person.pk for view in views} == {p.pk for p, _ in pairs}
    return pairs


def test_confirming_many_links_each_to_the_student_suggested() -> None:
    pairs = two_ready()

    # Ada twice, as a list sent twice over might name her: confirmed once.
    confirm_people(
        [(p.pk, s.pk, p.version) for p, s in [*pairs, pairs[0]]],
        actor=admin(),
    )

    for person, chosen in pairs:
        person = fresh(person)
        assert (person.state, person.student_id) == (
            LegacyPersonState.LINKED,
            chosen.pk,
        )
    linked = events(AuditAction.LEGACY_PERSON_LINKED)
    assert len(linked) == 2
    assert all(event.metadata["confirmed_together"] for event in linked)
    assert_records_agree()


def test_confirming_many_is_all_or_nothing() -> None:
    (ada_person, ada_park), (ben, ben_cho) = two_ready()
    # Another administrator left Ben for later after the list was shown.
    leave_for_later(ben.pk, version=ben.version, actor=admin())

    with pytest.raises(ValidationError) as refused:
        confirm_people(
            [(ada_person.pk, ada_park.pk, 1), (ben.pk, ben_cho.pk, 1)],
            actor=admin(),
        )

    assert set(refused.value.message_dict) == {str(ben.pk)}
    assert fresh(ada_person).state == LegacyPersonState.PROPOSED


def test_only_a_person_still_ready_with_that_student_is_confirmed() -> None:
    (ada_person, _), (ben, ben_cho) = two_ready()

    with pytest.raises(ValidationError) as refused:
        confirm_people([(ada_person.pk, ben_cho.pk, 1)], actor=admin())

    assert refused.value.message_dict == {
        str(ada_person.pk): [
            "This person is no longer ready to confirm with this student.",
        ],
    }


# --- the database's own guard ------------------------------------------------


@pytest.mark.parametrize("state", ["LINKED", "NOT_A_STUDENT", "PROPOSED"])
def test_the_database_refuses_records_that_disagree_with_their_person(
    state: str,
) -> None:
    person, ada_park = ada()
    link_person(person.pk, ada_park, version=1, actor=admin())
    if state == "NOT_A_STUDENT":
        reopen_person(person.pk, version=2, actor=admin())
        mark_not_a_student(person.pk, reason="LEFT", version=3, actor=admin())
    if state == "PROPOSED":
        reopen_person(person.pk, version=2, actor=admin())
    changes: dict[str, dict[str, Any]] = {
        "LINKED": {"student": student(first_name="Ben")},
        "NOT_A_STUDENT": {"student": ada_park},
        "PROPOSED": {"person_confirmed": True},
    }
    change = changes[state]

    with pytest.raises(IntegrityError), transaction.atomic():
        # Past every service, as a hand-written query would go.
        models.QuerySet.update(
            LegacyGradingRecord.objects.filter(pk=live(person)[0].pk),
            **change,
        )
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS legacy_person_records_agree IMMEDIATE")


# --- the API -----------------------------------------------------------------


def client_for(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def test_a_person_is_linked_through_the_api() -> None:
    person, ada_park = ada()
    client = client_for(admin())

    response = client.post(
        f"{PEOPLE}{person.pk}/link/",
        {"student": ada_park.pk, "version": 1},
        format="json",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["state"] == "LINKED"
    assert body["student"] == ada_park.pk
    assert body["version"] == 2
    assert body["decided_by_name"]
    assert {r["student"] for r in body["records"]} == {ada_park.pk}

    stale = client.post(
        f"{PEOPLE}{person.pk}/reopen/",
        {"version": 1},
        format="json",
    )
    assert stale.status_code == 400
    assert stale.json()["error"]["fields"] == {"version": [CHANGED_MESSAGE]}


def test_each_decision_is_made_through_the_api() -> None:
    person, ada_park = ada()
    client = client_for(admin())
    first, second = live(person)

    def post(path: str, data: dict[str, Any]) -> dict[str, Any]:
        response = client.post(f"{PEOPLE}{path}", data, format="json")
        assert response.status_code in {200, 201}, response.json()
        body: dict[str, Any] = response.json()
        return body

    assert post(f"{person.pk}/later/", {"version": 1})["state"] == "LATER"
    assert post(f"{person.pk}/reopen/", {"version": 2})["state"] == "PROPOSED"
    marked = post(
        f"{person.pk}/not-a-student/",
        {"version": 3, "reason": "OTHER", "note": "A visitor."},
    )
    assert marked["not_a_student_reason_display"] == "Other"
    assert marked["note"] == "A visitor."
    post(f"{person.pk}/reopen/", {"version": 4})
    split = client.post(
        f"{PEOPLE}{person.pk}/split/",
        {"version": 5, "records": [second.pk]},
        format="json",
    )
    assert split.status_code == 201
    new_person = split.json()
    assert [r["id"] for r in new_person["records"]] == [second.pk]
    merged = post(
        f"{person.pk}/merge/",
        {"version": 6, "other": new_person["id"], "other_version": 1},
    )
    assert [r["id"] for r in merged["records"]] == [first.pk, second.pk]
    confirmed = client.post(
        f"{PEOPLE}confirm/",
        {
            "confirmations": [
                {"person": person.pk, "student": ada_park.pk, "version": 7},
            ],
        },
        format="json",
    )
    assert confirmed.status_code == 200, confirmed.json()
    assert [p["state"] for p in confirmed.json()] == ["LINKED"]


def test_confirming_too_many_at_once_is_refused() -> None:
    response = client_for(admin()).post(
        f"{PEOPLE}confirm/",
        {
            "confirmations": [
                {"person": n, "student": n, "version": 1} for n in range(1, 502)
            ],
        },
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {
        "confirmations": ["Confirm at most 500 people at a time."],
    }


@pytest.mark.parametrize(
    ("path", "data"),
    [
        ("{id}/link/", {"student": 0, "version": 1}),
        ("{id}/not-a-student/", {"reason": "LEFT", "version": 1}),
        ("{id}/later/", {"version": 1}),
        ("{id}/reopen/", {"version": 1}),
        ("{id}/split/", {"records": [1], "version": 1}),
        ("{id}/merge/", {"other": 1, "version": 1, "other_version": 1}),
        ("confirm/", {"confirmations": [{"person": 1, "student": 1, "version": 1}]}),
    ],
)
def test_only_those_who_reconcile_history_may_decide(
    path: str,
    data: dict[str, Any],
) -> None:
    person, ada_park = ada()
    if "student" in data:
        data = {**data, "student": ada_park.pk}
    url = f"{PEOPLE}{path.format(id=person.pk)}"

    for user in (instructor_user(), None):
        response = client_for(user).post(url, data, format="json")
        assert response.status_code in {401, 403}, (user, response.status_code)

    assert fresh(person).version == 1
    assert not AuditEvent.objects.filter(entity_type=AuditEntity.LEGACY_PERSON).exists()
    # An administrator gets past the permission, to the decision itself.
    allowed = client_for(admin()).post(url, data, format="json")
    assert allowed.status_code not in {401, 403}


def test_an_unknown_person_is_not_found() -> None:
    response = client_for(admin()).post(
        f"{PEOPLE}999999/later/",
        {"version": 1},
        format="json",
    )

    assert response.status_code == 404


def test_an_import_counts_as_a_change_to_the_people_it_adds_to() -> None:
    sheets = {**ADA, "062026": [["Ada Park", "Blue", "Red", "Fail", ""]]}
    commit(sheets, only=["062025", "122025"])
    person = person_of("Ada Park")
    commit(sheets, only=["062026"])

    assert fresh(person).version == person.version + 1
