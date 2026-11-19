"""Records grouped into the people they are about (gradings.legacy_people).

Each rule has a test that fails if the rule breaks, on the synthetic history
(data_imports.testing.HISTORY_SHEETS) or a small workbook of made-up names.
Real data never enters this repository.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.db import IntegrityError, models, transaction

from accounts.models import User
from data_imports.models import ImportBatch
from data_imports.services import choose_legacy_sheets, commit_legacy_grading_import
from data_imports.testing import (
    grading_workbook,
    history_workbook,
    legacy_batch,
    legacy_record,
)
from data_imports.tests import admin_user
from gradings.legacy_matching import Suggestion, score_student, suggestion_for
from gradings.legacy_people import (
    TOO_MANY_TO_COMPARE,
    Chain,
    PersonQueue,
    PersonView,
    chain,
    entry_for,
    group_entries,
    people_in,
    suggest_students,
)
from gradings.legacy_services import create_legacy_grading_records
from gradings.models import (
    SHEET_NOTE_NAME,
    LegacyGradingRecord,
    LegacyPerson,
    LegacyPersonConfidence,
    LegacyPersonState,
    LegacyRecordKind,
)
from gradings.testing import rank, student
from ranks.matching import active_rank_lookup

pytestmark = pytest.mark.django_db


def admin() -> User:
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user()
    )


def commit(content: bytes, *, sheets: list[str] | None = None) -> ImportBatch:
    batch = legacy_batch(content, uploaded_by=admin())
    if sheets is not None:
        choose_legacy_sheets(batch, included=sheets)
    return commit_legacy_grading_import(batch, actor=admin())


def people() -> list[PersonView]:
    views = people_in(LegacyPerson.objects.all())
    suggest_students(views)
    return views


def grouped() -> list[list[tuple[str, str]]]:
    """Each person as their records' (sheet, name as written), oldest first."""
    return [
        [(record_.source_sheet, record_.source_name) for record_ in view.records]
        for view in people()
    ]


def person_named(name: str) -> PersonView:
    [view] = [view for view in people() if view.name == name]
    return view


def person_writing(spelling: str) -> PersonView:
    """The one person with a record written so."""
    [view] = [view for view in people() if spelling in view.spellings]
    return view


# --- the synthetic history -------------------------------------------------------


def test_the_history_is_grouped_into_the_people_it_is_about() -> None:
    commit(history_workbook())

    assert grouped() == [
        [("092026", "Ari Lund")],
        [("032026", "Finn C"), ("032026", "Fin Cole"), ("092026", "Fin Cole")],
        [("062025", "Kit B"), ("032026", "Kit B")],
        [("032026", "Kit B")],
        [("092026", "Lena Ash")],
        [("092026", "Mo Ito")],
        [("062025", "Omar Haddad"), ("122025", "Omar"), ("122025", "Omar Haddad")],
        [("062025", "Priya N")],
        [("122025", "Rubi Moss")],
        [("062025", "Ruby Moss"), ("122025", "Ruby Moss"), ("032026", "Ruby Moss")],
        [("032026", "Sam P")],
        [("032026", "Sam P")],
        [("122025", "Test entry")],
        [
            ("062025", "Theo R"),
            ("122025", "Theo Rowan"),
            ("032026", "Teo Rowan"),
            ("092026", "Theo Rowan"),
        ],
        [("062025", "Wren Hale"), ("032026", "Wren Hale")],
    ]


def test_every_record_but_a_sheet_note_has_one_person() -> None:
    commit(history_workbook())

    records = LegacyGradingRecord.objects.all()
    assert not records.filter(person__isnull=True).exclude(source_name=SHEET_NOTE_NAME)
    assert not records.filter(source_name=SHEET_NOTE_NAME, person__isnull=False)
    assert records.filter(source_name=SHEET_NOTE_NAME).count() == 2


def test_a_person_says_how_sure_the_grouping_is_and_why() -> None:
    commit(history_workbook())

    theo = person_named("Theo Rowan")
    assert theo.person.confidence == LegacyPersonConfidence.HIGH
    assert theo.spellings == ["Theo R", "Theo Rowan", "Teo Rowan"]
    assert theo.person.reasons == [
        "Written as “Theo R”, “Theo Rowan”, “Teo Rowan”.",
        "Passed to Yellow Stripe in 06/2025, then held Yellow Stripe in 12/2025.",
        "Passed to Yellow in 12/2025, then held Yellow in 03/2026.",
        "Passed to Blue Stripe in 03/2026, then held Blue Stripe in 09/2026.",
    ]
    fin = person_named("Fin Cole")
    assert fin.person.confidence == LegacyPersonConfidence.MEDIUM
    assert "Listed as missing or not attending and graded in 03/2026." in (
        fin.person.reasons
    )
    # Two spellings and no ranks to compare: the least sure.
    omar = person_named("Omar Haddad")
    assert omar.person.confidence == LegacyPersonConfidence.LOW
    assert "No ranks to compare between 06/2025 and 12/2025." in omar.person.reasons


def test_grouping_is_repeatable() -> None:
    commit(history_workbook())
    ranks = active_rank_lookup()
    records = list(
        LegacyGradingRecord.objects.exclude(source_name=SHEET_NOTE_NAME)
        .select_related("current_rank", "testing_for_rank")
        .order_by("pk"),
    )
    entries = [entry_for(record_, ranks) for record_ in records]

    first = group_entries(entries, [])
    assert group_entries(entries, []) == first
    # And it is what the save gave, person for person, in the same order.
    saved = [
        [records.index(record_) for record_ in view.records]
        for view in sorted(people(), key=lambda view: view.person.pk)
    ]
    assert [sorted(indices) for indices in saved] == first.new_people


# --- the hard rules --------------------------------------------------------------


def test_two_results_on_one_sheet_are_never_one_person() -> None:
    commit(history_workbook())

    for view in people():
        sheets = [
            record_.source_sheet
            for record_ in view.records
            if record_.record_kind == LegacyRecordKind.GRADING_RESULT
        ]
        assert len(sheets) == len(set(sheets)), view.name


def test_a_rank_chain_never_goes_down() -> None:
    commit(
        grading_workbook(
            {
                "062025": [["Ada Park", "White", "Yellow", "Pass", ""]],
                "122025": [["Ada Park", "White", "Yellow Stripe", "Pass", ""]],
            },
        ),
    )

    assert grouped() == [[("062025", "Ada Park")], [("122025", "Ada Park")]]


def test_names_that_cannot_be_one_person_are_not_joined_through_a_third() -> None:
    commit(
        grading_workbook(
            {
                "062025": [["Omar Haddad", "White", "Yellow", "Pass", ""]],
                "122025": [["Omar", "Yellow", "Blue", "Pass", ""]],
                "032026": [["Omar Smith", "Blue", "Red", "Pass", ""]],
            },
        ),
    )

    # "Omar" could be either - the nearer sheet wins - but Haddad and
    # Smith are never one person.
    assert grouped() == [
        [("062025", "Omar Haddad")],
        [("122025", "Omar"), ("032026", "Omar Smith")],
    ]


def test_a_sheet_naming_too_many_to_compare_groups_no_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("gradings.legacy_people.MAX_COMPARED_PAIRS", 1)
    commit(
        grading_workbook(
            {
                "062025": [["Ada Park", "White", "Yellow", "Pass", ""]],
                "122025": [["Ada Park", "Yellow", "Blue", "Pass", ""]],
            },
        ),
    )

    assert len(people()) == 2
    assert {tuple(view.person.reasons) for view in people()} == {
        (TOO_MANY_TO_COMPARE,),
    }


def test_the_chain_between_two_records() -> None:
    ranks = active_rank_lookup()

    def entry(**fields: Any) -> Any:
        data: dict[str, Any] = {
            "source_name": "Ada Park",
            "cycle_year": 2025,
            "cycle_month": 6,
            "record_kind": LegacyRecordKind.GRADING_RESULT,
            "source_section": "",
            "outcome": "PASS",
            **fields,
        }
        return entry_for(LegacyGradingRecord(**data), ranks)

    june_pass = entry(current_rank=rank("WHITE"), testing_for_rank=rank("YELLOW"))
    june_fail = entry(
        current_rank=rank("WHITE"),
        testing_for_rank=rank("YELLOW"),
        outcome="FAIL",
    )
    later = {
        code: entry(current_rank=rank(code), cycle_month=12)
        for code in ("WHITE", "YELLOW", "BLUE")
    }

    assert chain(june_pass, later["YELLOW"]) == Chain.STRONG
    assert chain(later["YELLOW"], june_pass) == Chain.STRONG
    assert chain(june_pass, later["BLUE"]) == Chain.FORWARD
    assert chain(june_pass, later["WHITE"]) == Chain.RULED_OUT
    assert chain(june_fail, later["WHITE"]) == Chain.STRONG
    assert chain(june_pass, entry(cycle_month=12)) == Chain.UNKNOWN
    assert chain(june_pass, june_fail) == Chain.RULED_OUT


# --- saving ----------------------------------------------------------------------


def test_saving_is_all_or_nothing_people_included() -> None:
    batch = legacy_batch()
    row = {
        "record_kind": LegacyRecordKind.GRADING_RESULT,
        "source_sheet": "06-2025",
        "cycle_year": 2025,
        "cycle_month": 6,
    }

    with pytest.raises(IntegrityError), transaction.atomic():
        create_legacy_grading_records(
            batch,
            [
                {**row, "source_locator": "06-2025!R2", "source_name": "Ada Park"},
                # The last repeats a locator: the database refuses it.
                {**row, "source_locator": "06-2025!R2", "source_name": "Kit B"},
            ],
        )

    assert not LegacyGradingRecord.objects.exists()
    assert not LegacyPerson.objects.exists()


def test_the_database_refuses_a_record_with_no_person() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        LegacyGradingRecord.objects.bulk_create(
            [
                LegacyGradingRecord(
                    source_batch=legacy_batch(),
                    record_kind=LegacyRecordKind.GRADING_RESULT,
                    source_sheet="06-2025",
                    source_locator="06-2025!R2",
                    cycle_year=2025,
                    cycle_month=6,
                    source_name="Ada Park",
                ),
            ],
        )


def test_the_database_refuses_a_linked_person_with_no_student() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        LegacyPerson.objects.create(
            state=LegacyPersonState.LINKED,
            confidence=LegacyPersonConfidence.HIGH,
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        LegacyPerson.objects.create(
            student=student(),
            confidence=LegacyPersonConfidence.HIGH,
        )


# --- the next import -------------------------------------------------------------


HISTORY_BUT_THE_LAST = ["062025", "122025", "032026"]


def test_a_later_sheet_joins_the_people_already_there() -> None:
    commit(history_workbook(), sheets=HISTORY_BUT_THE_LAST)
    before = {view.person.pk: view.name for view in people()}

    commit(history_workbook())

    theo = person_named("Theo Rowan")
    assert theo.person.pk in before
    assert [record_.source_sheet for record_ in theo.records][-1] == "092026"
    # New people for the new names; nobody already there is changed.
    assert {view.name for view in people() if view.person.pk not in before} == {
        "Ari Lund",
        "Lena Ash",
        "Mo Ito",
    }


def decide(view: PersonView, state: str, **fields: Any) -> None:
    """A decision, as B4's services will make one: the person's state, and
    every record of theirs covered."""
    LegacyPerson.objects.filter(pk=view.person.pk).update(state=state, **fields)
    # Past the guard on ordinary record updates (kukgrade.kept), as a test may.
    models.QuerySet.update(
        LegacyGradingRecord.objects.filter(person=view.person),
        person_confirmed=True,
    )


def test_a_new_record_joins_a_decided_person_only_on_a_strong_chain() -> None:
    commit(history_workbook(), sheets=HISTORY_BUT_THE_LAST)
    theo_student = student(
        first_name="Theo", last_name="Rowan", current_rank=rank("BLUE")
    )
    decide(
        person_writing("Theo Rowan"),
        LegacyPersonState.LINKED,
        student=theo_student,
    )
    decide(person_writing("Fin Cole"), LegacyPersonState.LATER)

    commit(history_workbook())

    theo = person_writing("Theo Rowan")
    # Joined, waiting for the decision to be confirmed for it: not linked.
    assert theo.awaiting_confirmation == 1
    assert theo.queue == PersonQueue.NEEDS_A_LOOK
    assert not theo.sorted
    [joined] = [r for r in theo.records if r.source_sheet == "092026"]
    assert joined.person_confirmed is False
    assert joined.student_id is None
    # Passed to Red, then missed the next grading at Red: a strong chain.
    fin = person_writing("Fin Cole")
    assert fin.awaiting_confirmation == 1
    assert fin.person.state == LegacyPersonState.LATER


def test_a_new_record_with_only_a_weak_chain_does_not_join_a_decided_person() -> None:
    commit(grading_workbook({"062025": [["Ada Park", "White", "Yellow", "Pass", ""]]}))
    decide(person_named("Ada Park"), LegacyPersonState.NOT_A_STUDENT)

    # Blue after passing to Yellow: forward, but not the next rank.
    commit(grading_workbook({"122025": [["Ada Park", "Blue", "Red", "Pass", ""]]}))

    assert grouped() == [[("062025", "Ada Park")], [("122025", "Ada Park")]]
    decided, new = sorted(people(), key=lambda view: view.person.pk)
    assert decided.sorted
    assert new.person.state == LegacyPersonState.PROPOSED


def test_a_new_record_never_joins_two_people_already_there() -> None:
    # One person's records kept as two people, as a split leaves them.
    for year, month, current, testing in (
        (2025, 6, "WHITE", "YELLOW"),
        (2025, 12, "YELLOW", "BLUE"),
    ):
        legacy_record(
            source_name="Ada Park",
            source_sheet=f"{month:02d}{year}",
            source_locator=f"{month:02d}{year}!R2",
            cycle_year=year,
            cycle_month=month,
            current_rank=rank(current),
            testing_for_rank=rank(testing),
            outcome="PASS",
        )
    before = {view.person.pk for view in people()}

    # Fits both: Blue, after passing to Blue, after passing to Yellow.
    commit(grading_workbook({"032026": [["Ada Park", "Blue", "Red", "Pass", ""]]}))

    assert {view.person.pk for view in people()} == before
    # It joined the later one, on the strong chain, and only that one.
    assert sorted(
        [record_.source_sheet for record_ in view.records] for view in people()
    ) == [["062025"], ["122025", "032026"]]


# --- who they may be -------------------------------------------------------------


def one_record(
    name: str,
    current: str,
    testing: str,
    sheet: str = "062025",
) -> PersonView:
    commit(grading_workbook({sheet: [[name, current, testing, "Pass", ""]]}))
    return person_named(name)


def test_ready_to_confirm_needs_one_student_whose_rank_fits() -> None:
    student(first_name="Ada", last_name="Park", current_rank=rank("YELLOW"))

    ada = one_record("Ada Park", "White", "Yellow")

    assert ada.suggestion == Suggestion.CLEAR
    assert ada.queue == PersonQueue.READY


def test_a_student_ranked_lower_now_than_then_is_never_ready_to_confirm() -> None:
    student(first_name="Ada", last_name="Park", current_rank=rank("WHITE"))

    ada = one_record("Ada Park", "White", "Yellow")

    [only] = ada.candidates
    assert only.rank_fits is False
    assert ada.suggestion == Suggestion.CHOOSE
    assert ada.queue == PersonQueue.NEEDS_A_LOOK


def test_a_suggestion_that_contradicts_itself_is_never_clear_by_spelling_either() -> (
    None
):
    lower = student(first_name="Ada", last_name="Park", current_rank=rank("WHITE"))
    candidate = score_student(["ada", "park"], lower, rank("YELLOW"))

    assert candidate is not None
    assert suggestion_for([candidate]) == Suggestion.CHOOSE


def test_people_with_several_fits_or_none_wait_where_they_should() -> None:
    student(first_name="Ada", last_name="Park", current_rank=rank("YELLOW"))
    student(first_name="Ada", last_name="Pike", current_rank=rank("YELLOW"))

    ada = one_record("Ada P", "White", "Yellow")
    nobody = one_record("Kit B", "White", "Yellow", sheet="122025")

    assert ada.suggestion == Suggestion.CHOOSE
    assert ada.queue == PersonQueue.NEEDS_A_LOOK
    assert nobody.queue == PersonQueue.NO_STUDENT


def test_a_person_not_sure_to_be_one_is_not_ready_to_confirm() -> None:
    student(first_name="Omar", last_name="Haddad", current_rank=rank("BLUE"))
    commit(history_workbook())

    omar = person_named("Omar Haddad")
    assert omar.suggestion == Suggestion.CLEAR
    assert omar.person.confidence == LegacyPersonConfidence.LOW
    assert omar.queue == PersonQueue.NEEDS_A_LOOK


def test_a_builder_record_is_its_own_person() -> None:
    first, second = legacy_record(), legacy_record()

    assert first.person_id is not None
    assert first.person_id != second.person_id
    assert legacy_record(source_name=SHEET_NOTE_NAME).person_id is None
