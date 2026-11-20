"""The things to check in a historical import (data_imports.legacy_checks):
the exceptions only, each one decision, and what each decision does when the
records are saved. Synthetic workbooks and made-up names only."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.legacy_checks import (
    CheckDecision,
    CheckKind,
    LegacyCheck,
    legacy_checks,
)
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    CHECK_DECISION_REFUSED,
    CHECK_GONE,
    CHOOSE_A_RANK,
    CHOOSE_A_ROW,
    CHOOSE_AN_OUTCOME,
    choose_legacy_sheets,
    commit_legacy_grading_import,
    resolve_legacy_check,
    set_import_row_excluded,
)
from data_imports.testing import grading_workbook, legacy_batch, standard_workbook
from data_imports.tests import (
    admin_user,
    instructor_user,
    student_workbook,
    upload_batch,
)
from gradings.models import LegacyGradingRecord, LegacyOutcome
from gradings.testing import rank
from ranks.models import Rank

pytestmark = pytest.mark.django_db

BASE = "/api/data-imports/batches/"

# One of everything to check, and rows that need nothing.
SHEET: list[list[object]] = [
    ["Ada Park", "White", "Yellow Stripe", "Pass", ""],  # 1: fine
    ["Bo Lee", "Bown Stripe", "Brown", "Pass", ""],  # 2: rank unreadable
    ["Cy Moss", "Red stripe?", "Red", "Pass", ""],  # 3: rank doubted
    ["Di Vale", "Blue", "Red Stripe", "Testing? No", ""],  # 4: outcome unread
    ["Ed Hart", "Blue", "Red Stripe", "Pass", ""],  # 5: written twice...
    ["Ed Hart", "Blue", "Red Stripe", "Pass", ""],  # 6: ...here
    ["Fay Dunn", "Yellow", "Blue Stripe", "", ""],  # 7: no outcome
    ["Gus Kerr", "", "Yellow Stripe", "Pass", ""],  # 8: no rank
    ["Hal Ross", "Yellow", "Blue Stripe", "Pass", ""],  # 9: graded...
    ["Hal Ross", "Yellow", "", "DNA", ""],  # 10: ...and not attending
]


def admin() -> User:
    return User.objects.filter(email="import-admin@example.com").first() or (
        admin_user("import-admin@example.com")
    )


def uploaded(rows: list[list[object]] | None = None) -> ImportBatch:
    return legacy_batch(standard_workbook(rows or SHEET), uploaded_by=admin())


def checks_of(batch: ImportBatch) -> list[LegacyCheck]:
    return legacy_checks(ImportBatch.objects.get(pk=batch.pk))


def check(batch: ImportBatch, kind: str, number: int = 0) -> LegacyCheck:
    return [found for found in checks_of(batch) if found.kind == kind][number]


def rows_of(found: LegacyCheck) -> list[int]:
    return [row.row_number for row in found.rows]


def record(name: str, number: int = 0) -> LegacyGradingRecord:
    return list(
        LegacyGradingRecord.objects.filter(source_name=name).order_by("pk"),
    )[number]


def resolve(batch: ImportBatch, **decision: Any) -> LegacyCheck:
    """resolve_legacy_check, for a check still there after."""
    found = resolve_legacy_check(batch, **decision)
    assert found is not None
    return found


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def refused(error: pytest.ExceptionInfo[ValidationError]) -> dict[str, list[str]]:
    return error.value.message_dict


# --- what is listed -------------------------------------------------------


def test_only_the_exceptions_are_listed_in_the_order_of_their_kinds() -> None:
    batch = uploaded()

    listed = [
        (found.kind, found.text, rows_of(found), found.is_open)
        for found in checks_of(batch)
    ]

    # Every rank KukGrade reads, and every outcome it knows, is taken as read.
    assert listed == [
        (CheckKind.RANK, "Bown Stripe", [2], True),
        (CheckKind.RANK, "Red stripe?", [3], True),
        (CheckKind.OUTCOME, "Testing? No", [4], True),
        (CheckKind.WRITTEN_TWICE, "", [5, 6], True),
        (CheckKind.MISSING_AND_GRADED, "", [9, 10], True),
        (CheckKind.NO_OUTCOME, "", [7], True),
        (CheckKind.NO_RANK, "", [8], True),
    ]


def test_each_check_says_what_to_look_at_in_plain_words() -> None:
    messages = {found.key: found.message for found in checks_of(uploaded())}

    assert messages["RANK:bown stripe"] == "KukGrade can't read the rank “Bown Stripe”."
    assert messages["RANK:red stripe?"] == (
        "The workbook marks the rank “Red stripe?” as uncertain."
    )
    assert messages["OUTCOME:testing? no"] == (
        "KukGrade can't read the outcome “Testing? No”."
    )
    assert messages["NO_OUTCOME:06-2025!R8"] == "No outcome is written."
    assert messages["NO_RANK:06-2025!R9"] == "No current rank is written."


def test_a_doubted_rank_offers_the_rank_it_reads_as_and_an_unreadable_one_none() -> (
    None
):
    batch = uploaded()

    assert check(batch, CheckKind.RANK, 0).suggested_rank_code is None
    assert check(batch, CheckKind.RANK, 1).suggested_rank_code == "RED_STRIPE"


def test_a_spelling_is_one_check_however_many_rows_write_it() -> None:
    batch = uploaded(
        [
            ["Ada Park", "DNB", "DNB", "Pass", ""],
            ["Bo Lee", "dnb", "DNB", "Pass", ""],
        ],
    )

    [found] = checks_of(batch)
    assert (found.key, found.text, rows_of(found)) == ("RANK:dnb", "DNB", [1, 2])


def test_a_sheet_not_chosen_has_nothing_to_check() -> None:
    batch = legacy_batch(
        grading_workbook(
            {"062025": [SHEET[1]], "092025": [["Bo Lee", "DNB", "Brown", "Pass", ""]]},
        ),
        uploaded_by=admin(),
    )

    choose_legacy_sheets(batch, included=["092025"])

    assert [found.text for found in checks_of(batch)] == ["DNB"]


# --- ranks ----------------------------------------------------------------


def test_a_rank_chosen_for_a_spelling_is_saved_on_its_records() -> None:
    batch = uploaded()

    decided = resolve(
        batch,
        key="RANK:bown stripe",
        decision=CheckDecision.RANK,
        rank_code="BROWN_STRIPE",
    )

    assert (decided.decision, decided.rank_code, decided.is_open) == (
        CheckDecision.RANK,
        "BROWN_STRIPE",
        False,
    )
    commit_legacy_grading_import(batch, actor=admin())
    saved = record("Bo Lee")
    assert saved.current_rank == rank("BROWN_STRIPE")
    # The workbook's text is kept as written.
    assert saved.source_current_rank_text == "Bown Stripe"
    # A rank KukGrade reads needed no decision.
    assert saved.testing_for_rank == rank("BROWN")


def test_a_doubted_rank_is_not_taken_as_read_until_chosen() -> None:
    batch = uploaded()

    commit_legacy_grading_import(batch, actor=admin())

    assert record("Cy Moss").current_rank is None
    assert record("Cy Moss").testing_for_rank == rank("RED")


def test_a_rank_kept_as_written_stays_unmatched_even_if_kukgrade_could_read_it() -> (
    None
):
    batch = uploaded()

    resolve(batch, key="RANK:red stripe?", decision=CheckDecision.KEEP)

    assert check(batch, CheckKind.RANK, 1).decision == CheckDecision.KEEP
    commit_legacy_grading_import(batch, actor=admin())
    assert record("Cy Moss").current_rank is None


def test_a_later_decision_replaces_an_earlier_one() -> None:
    batch = uploaded()
    key = "RANK:red stripe?"

    resolve(batch, key=key, decision=CheckDecision.KEEP)
    resolve(
        batch,
        key=key,
        decision=CheckDecision.RANK,
        rank_code="RED_STRIPE",
    )
    assert ImportBatch.objects.get(pk=batch.pk).configuration.checks_kept == []
    kept_again = resolve(batch, key=key, decision=CheckDecision.KEEP)

    assert (kept_again.decision, kept_again.rank_code) == (CheckDecision.KEEP, None)
    assert "red stripe?" not in (
        ImportBatch.objects.get(pk=batch.pk).configuration.rank_mappings
    )


@pytest.mark.parametrize("code", ["", "NOT_A_RANK", None])
def test_a_rank_must_be_one_of_kukgrades(code: str | None) -> None:
    batch = uploaded()

    with pytest.raises(ValidationError) as error:
        resolve(
            batch,
            key="RANK:bown stripe",
            decision=CheckDecision.RANK,
            rank_code=code,
        )

    assert refused(error) == {"rank_code": [CHOOSE_A_RANK]}
    assert check(batch, CheckKind.RANK).is_open


def test_a_rank_switched_off_cannot_be_chosen_and_one_chosen_reopens() -> None:
    batch = uploaded()
    brown_stripe = rank("BROWN_STRIPE")
    resolve(
        batch,
        key="RANK:bown stripe",
        decision=CheckDecision.RANK,
        rank_code=brown_stripe.code,
    )

    Rank.objects.filter(pk=brown_stripe.pk).update(active=False)

    assert check(batch, CheckKind.RANK).is_open
    with pytest.raises(ValidationError) as error:
        resolve(
            batch,
            key="RANK:bown stripe",
            decision=CheckDecision.RANK,
            rank_code=brown_stripe.code,
        )
    assert refused(error) == {"rank_code": [CHOOSE_A_RANK]}


# --- outcomes -------------------------------------------------------------


def test_an_outcome_read_is_saved_on_its_records_and_the_text_kept() -> None:
    batch = uploaded()

    decided = resolve(
        batch,
        key="OUTCOME:testing? no",
        decision=CheckDecision.OUTCOME,
        outcome=LegacyOutcome.FAIL,
    )

    assert (decided.decision, decided.outcome) == (
        CheckDecision.OUTCOME,
        LegacyOutcome.FAIL,
    )
    # No longer a reason to look at the row.
    row = ImportRow.objects.get(batch=batch, row_number=4)
    assert not any("Outcome" in issue for issue in row.issues)
    commit_legacy_grading_import(batch, actor=admin())
    saved = record("Di Vale")
    assert saved.outcome == LegacyOutcome.FAIL
    assert saved.source_outcome_text == "Testing? No"


def test_an_outcome_reading_covers_the_same_words_however_written() -> None:
    batch = uploaded(
        [
            ["Ada Park", "White", "Yellow", "Passed", ""],
            ["Bo Lee", "White", "Yellow", "passed.", ""],
        ],
    )

    [found] = checks_of(batch)
    assert rows_of(found) == [1, 2]
    resolve(
        batch,
        key=found.key,
        decision=CheckDecision.OUTCOME,
        outcome=LegacyOutcome.PASS,
    )
    commit_legacy_grading_import(batch, actor=admin())

    assert set(LegacyGradingRecord.objects.values_list("outcome", flat=True)) == {
        LegacyOutcome.PASS,
    }


def test_an_outcome_kept_as_written_is_saved_with_none() -> None:
    batch = uploaded()

    resolve(batch, key="OUTCOME:testing? no", decision=CheckDecision.KEEP)
    commit_legacy_grading_import(batch, actor=admin())

    assert record("Di Vale").outcome is None


@pytest.mark.parametrize("outcome", [None, "DNA"])
def test_an_outcome_must_be_pass_fail_or_conditional(outcome: str | None) -> None:
    batch = uploaded()

    with pytest.raises(ValidationError) as error:
        resolve(
            batch,
            key="OUTCOME:testing? no",
            decision=CheckDecision.OUTCOME,
            outcome=outcome,
        )

    assert refused(error) == {"outcome": [CHOOSE_AN_OUTCOME]}


# --- names on one sheet ---------------------------------------------------


def test_leaving_one_out_sorts_a_name_written_twice_and_bringing_it_back_reopens() -> (
    None
):
    batch = uploaded()
    before = check(batch, CheckKind.WRITTEN_TWICE)
    assert before.rows_to_leave_out == [5, 6]

    decided = resolve(
        batch,
        key=before.key,
        decision=CheckDecision.LEAVE_OUT,
        row_number=6,
    )

    # The same check, now sorted: its key holds while its rows are the same.
    assert (decided.key, decided.decision, rows_of(decided)) == (
        before.key,
        CheckDecision.LEAVE_OUT,
        [5, 6],
    )
    assert decided.rows_to_leave_out == [5]
    left_out = ImportRow.objects.get(batch=batch, row_number=6)
    assert (left_out.excluded, left_out.outcome) == (True, ImportRow.Outcome.EXCLUDED)
    # The other row's reason to look went with it.
    assert ImportRow.objects.get(batch=batch, row_number=5).issues == []

    set_import_row_excluded(batch, row_number=6, excluded=False)
    assert check(batch, CheckKind.WRITTEN_TWICE).is_open


def test_a_name_written_twice_can_be_kept_and_both_rows_come_in() -> None:
    batch = uploaded()
    key = check(batch, CheckKind.WRITTEN_TWICE).key

    resolve(batch, key=key, decision=CheckDecision.KEEP)

    assert check(batch, CheckKind.WRITTEN_TWICE).decision == CheckDecision.KEEP
    commit_legacy_grading_import(batch, actor=admin())
    assert LegacyGradingRecord.objects.filter(source_name="Ed Hart").count() == 2


def test_keeping_as_written_brings_back_the_row_the_check_left_out() -> None:
    batch = uploaded()
    twice = check(batch, CheckKind.WRITTEN_TWICE).key
    no_outcome = check(batch, CheckKind.NO_OUTCOME).key
    resolve(batch, key=twice, decision=CheckDecision.LEAVE_OUT, row_number=6)
    resolve(batch, key=no_outcome, decision=CheckDecision.LEAVE_OUT, row_number=7)

    kept = resolve(batch, key=twice, decision=CheckDecision.KEEP)
    resolve(batch, key=no_outcome, decision=CheckDecision.KEEP)

    assert (kept.decision, kept.rows_to_leave_out) == (CheckDecision.KEEP, [5, 6])
    assert check(batch, CheckKind.NO_OUTCOME).decision == CheckDecision.KEEP
    assert not ImportRow.objects.filter(batch=batch, excluded=True).exists()
    commit_legacy_grading_import(batch, actor=admin())
    assert LegacyGradingRecord.objects.filter(source_name="Ed Hart").count() == 2
    assert LegacyGradingRecord.objects.filter(source_name="Fay Dunn").exists()


def test_leaving_out_the_other_row_instead_brings_the_first_back() -> None:
    batch = uploaded()
    key = check(batch, CheckKind.WRITTEN_TWICE).key
    resolve(batch, key=key, decision=CheckDecision.LEAVE_OUT, row_number=6)

    after = resolve(batch, key=key, decision=CheckDecision.LEAVE_OUT, row_number=5)

    assert (after.decision, after.rows_to_leave_out) == (CheckDecision.LEAVE_OUT, [6])
    assert list(
        ImportRow.objects.filter(batch=batch, excluded=True).values_list(
            "row_number", flat=True
        ),
    ) == [5]


def test_a_row_left_out_from_the_rows_list_stays_out_when_its_check_is_kept() -> None:
    batch = uploaded()
    set_import_row_excluded(batch, row_number=6, excluded=True)

    resolve(
        batch,
        key=check(batch, CheckKind.WRITTEN_TWICE).key,
        decision=CheckDecision.KEEP,
    )

    assert ImportRow.objects.get(batch=batch, row_number=6).excluded


def test_a_row_is_brought_back_only_by_the_last_decision_that_left_it_out() -> None:
    batch = uploaded([["Gus Kerr", "", "Yellow", "", ""]])
    no_outcome = check(batch, CheckKind.NO_OUTCOME).key
    no_rank = check(batch, CheckKind.NO_RANK).key
    resolve(batch, key=no_outcome, decision=CheckDecision.LEAVE_OUT, row_number=1)
    # Brought back from the rows list, then left out for its missing rank.
    set_import_row_excluded(batch, row_number=1, excluded=False)
    resolve(batch, key=no_rank, decision=CheckDecision.LEAVE_OUT, row_number=1)

    resolve(batch, key=no_outcome, decision=CheckDecision.KEEP)

    assert ImportRow.objects.get(batch=batch, row_number=1).excluded
    # The missing rank's decision is the one that undoes it.
    resolve(batch, key=no_rank, decision=CheckDecision.KEEP)
    assert not ImportRow.objects.get(batch=batch, row_number=1).excluded


def test_keeping_a_row_another_import_has_saved_since_ends_its_check() -> None:
    rows: list[list[object]] = [["Fay Dunn", "Yellow", "Blue Stripe", "", ""]]
    batch = uploaded(rows)
    key = check(batch, CheckKind.NO_OUTCOME).key
    resolve(batch, key=key, decision=CheckDecision.LEAVE_OUT, row_number=1)
    commit_legacy_grading_import(uploaded(rows), actor=admin())

    assert resolve_legacy_check(batch, key=key, decision=CheckDecision.KEEP) is None

    row = ImportRow.objects.get(batch=batch, row_number=1)
    assert (row.excluded, row.outcome) == (False, ImportRow.Outcome.SKIP_EXISTING)
    answer = client_for(admin()).post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": key, "decision": "KEEP"},
        format="json",
    )
    assert answer.status_code == 400
    assert answer.json()["error"]["fields"] == {"key": [CHECK_GONE]}


def test_names_alike_that_chain_are_one_check_and_stay_open_while_two_remain() -> None:
    batch = uploaded(
        [
            ["Al Bry", "White", "Yellow", "Pass", ""],
            ["Al B", "White", "Yellow", "Pass", ""],
            ["Al Bry", "White", "Yellow", "Pass", ""],
        ],
    )
    found = check(batch, CheckKind.WRITTEN_TWICE)
    assert rows_of(found) == [1, 2, 3]

    after = resolve(
        batch,
        key=found.key,
        decision=CheckDecision.LEAVE_OUT,
        row_number=2,
    )

    assert (after.is_open, after.rows_to_leave_out) == (True, [1, 3])
    # While still open, leaving out another adds to the first.
    sorted_ = resolve(
        batch,
        key=found.key,
        decision=CheckDecision.LEAVE_OUT,
        row_number=3,
    )
    assert (sorted_.decision, sorted_.rows_to_leave_out) == (
        CheckDecision.LEAVE_OUT,
        [1],
    )
    # Keeping as written brings both back.
    resolve(batch, key=found.key, decision=CheckDecision.KEEP)
    assert not ImportRow.objects.filter(batch=batch, excluded=True).exists()


def test_a_result_and_a_missing_entry_alike_are_a_check_of_their_own_kind() -> None:
    batch = uploaded()

    found = check(batch, CheckKind.MISSING_AND_GRADED)

    assert rows_of(found) == [9, 10]
    assert "missing or not attending" in found.message
    resolve(
        batch,
        key=found.key,
        decision=CheckDecision.LEAVE_OUT,
        row_number=10,
    )
    assert (
        check(batch, CheckKind.MISSING_AND_GRADED).decision == CheckDecision.LEAVE_OUT
    )


def test_only_one_of_the_checks_rows_still_in_the_import_can_be_left_out() -> None:
    batch = uploaded()
    key = check(batch, CheckKind.WRITTEN_TWICE).key

    for row_number in (1, None):
        with pytest.raises(ValidationError) as error:
            resolve(
                batch,
                key=key,
                decision=CheckDecision.LEAVE_OUT,
                row_number=row_number,
            )
        assert refused(error) == {"row_number": [CHOOSE_A_ROW]}
    assert not ImportRow.objects.filter(batch=batch, excluded=True).exists()


# --- what a row does not say ----------------------------------------------


def test_a_row_with_nothing_written_can_be_kept_or_left_out() -> None:
    batch = uploaded()
    no_outcome = check(batch, CheckKind.NO_OUTCOME)
    no_rank = check(batch, CheckKind.NO_RANK)

    resolve(batch, key=no_outcome.key, decision=CheckDecision.KEEP)
    resolve(
        batch,
        key=no_rank.key,
        decision=CheckDecision.LEAVE_OUT,
        row_number=8,
    )

    assert check(batch, CheckKind.NO_OUTCOME).decision == CheckDecision.KEEP
    left_out = check(batch, CheckKind.NO_RANK)
    assert (left_out.decision, left_out.rows_to_leave_out) == (
        CheckDecision.LEAVE_OUT,
        [],
    )
    commit_legacy_grading_import(batch, actor=admin())
    assert record("Fay Dunn").outcome is None
    assert not LegacyGradingRecord.objects.filter(source_name="Gus Kerr").exists()


def test_a_row_missing_an_outcome_and_a_rank_is_two_checks() -> None:
    batch = uploaded([["Ada Park", "", "Yellow", "", ""]])

    assert [found.kind for found in checks_of(batch)] == [
        CheckKind.NO_OUTCOME,
        CheckKind.NO_RANK,
    ]


# --- refused --------------------------------------------------------------


def test_a_check_that_is_no_longer_there_is_refused() -> None:
    batch = uploaded()
    set_import_row_excluded(batch, row_number=2, excluded=True)

    with pytest.raises(ValidationError) as error:
        resolve(batch, key="RANK:bown stripe", decision=CheckDecision.KEEP)

    assert refused(error) == {"key": [CHECK_GONE]}


@pytest.mark.parametrize(
    ("kind", "decision"),
    [
        (CheckKind.RANK, CheckDecision.LEAVE_OUT),
        (CheckKind.RANK, CheckDecision.OUTCOME),
        (CheckKind.OUTCOME, CheckDecision.RANK),
        (CheckKind.WRITTEN_TWICE, CheckDecision.RANK),
        (CheckKind.NO_OUTCOME, CheckDecision.OUTCOME),
    ],
)
def test_a_check_is_sorted_only_the_ways_its_kind_allows(
    kind: str,
    decision: str,
) -> None:
    batch = uploaded()

    with pytest.raises(ValidationError) as error:
        resolve(
            batch,
            key=check(batch, kind).key,
            decision=decision,
            rank_code="RED",
            outcome=LegacyOutcome.PASS,
            row_number=5,
        )

    assert refused(error) == {"decision": [CHECK_DECISION_REFUSED]}


def test_a_finished_import_cannot_be_changed() -> None:
    batch = uploaded()
    commit_legacy_grading_import(batch, actor=admin())

    with pytest.raises(ValidationError):
        resolve(batch, key="RANK:bown stripe", decision=CheckDecision.KEEP)


def test_a_roster_has_no_checks_to_decide() -> None:
    roster = upload_batch(
        content=student_workbook([["123-4-501", "Ada", "Park", "2013-06-02", "White"]]),
        uploaded_by=admin(),
    )

    assert served(client_for(admin()), roster) == []
    with pytest.raises(ValidationError) as error:
        resolve(roster, key="RANK:x", decision=CheckDecision.KEEP)

    assert "batch" in refused(error)


# --- the API --------------------------------------------------------------


def served(
    client: APIClient, batch: ImportBatch, **params: str
) -> list[dict[str, Any]]:
    answer = client.get(f"{BASE}{batch.pk}/checks/", params)
    assert answer.status_code == 200, answer.content
    results: list[dict[str, Any]] = answer.json()["results"]
    return results


def test_the_checks_are_served_a_page_at_a_time_and_can_be_narrowed() -> None:
    batch = uploaded()
    client = client_for(admin())

    every = served(client, batch)
    assert [found["kind"] for found in every][:3] == ["RANK", "RANK", "OUTCOME"]
    first = every[0]
    assert first["key"] == "RANK:bown stripe"
    assert first["kind_display"] == "Rank to read"
    assert first["is_open"] is True
    assert first["decision"] is None
    assert first["row_count"] == 1
    assert first["rows"][0]["values"]["name"] == "Bo Lee"

    assert [found["key"] for found in served(client, batch, kind="OUTCOME")] == [
        "OUTCOME:testing? no",
    ]
    assert served(client, batch, kind="NOTHING") == []
    resolve(batch, key="RANK:bown stripe", decision=CheckDecision.KEEP)
    assert [found["key"] for found in served(client, batch, open="false")] == [
        "RANK:bown stripe",
    ]
    assert len(served(client, batch, open="true")) == len(every) - 1
    assert served(client, batch, open="maybe") == []
    assert client.get(f"{BASE}{batch.pk}/checks/", {"knid": "RANK"}).status_code == 400


def test_a_check_about_many_rows_lists_the_first_fifty_and_counts_them_all() -> None:
    batch = uploaded([[f"Name {number}", "DNB", "", "DNA", ""] for number in range(60)])

    [found] = served(client_for(admin()), batch, kind="RANK")

    assert (found["row_count"], len(found["rows"])) == (60, 50)


def test_the_summary_counts_each_kind_and_what_is_still_open() -> None:
    batch = uploaded()
    resolve(batch, key="RANK:bown stripe", decision=CheckDecision.KEEP)

    summary = client_for(admin()).get(f"{BASE}{batch.pk}/checks/summary/").json()

    assert (summary["checks"], summary["open"]) == (7, 6)
    assert summary["kinds"][0] == {
        "kind": "RANK",
        "kind_display": "Rank to read",
        "checks": 2,
        "open": 1,
    }
    assert [kind["kind"] for kind in summary["kinds"]] == list(CheckKind.values)


def test_a_decision_is_made_through_the_api_and_the_check_served_back() -> None:
    batch = uploaded()
    client = client_for(admin())

    answer = client.post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": "RANK:bown stripe", "decision": "RANK", "rank_code": "BROWN_STRIPE"},
        format="json",
    )

    assert answer.status_code == 200, answer.content
    assert answer.json()["decision"] == "RANK"
    assert answer.json()["decision_display"] == "Rank chosen"
    refused_answer = client.post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": "RANK:nothing", "decision": "KEEP"},
        format="json",
    )
    assert refused_answer.status_code == 400
    assert refused_answer.json()["error"]["fields"] == {"key": [CHECK_GONE]}
    bad = client.post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": "RANK:bown stripe", "decision": "GUESS"},
        format="json",
    )
    assert bad.status_code == 400
    assert "decision" in bad.json()["error"]["fields"]


def test_an_instructor_can_neither_see_nor_decide_the_checks() -> None:
    batch = uploaded()
    client = client_for(instructor_user())

    assert client.get(f"{BASE}{batch.pk}/checks/").status_code == 403
    assert client.get(f"{BASE}{batch.pk}/checks/summary/").status_code == 403
    answer = client.post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": "RANK:bown stripe", "decision": "KEEP"},
        format="json",
    )
    assert answer.status_code == 403
    assert check(batch, CheckKind.RANK).is_open


def test_no_one_signed_out_can_reach_the_checks() -> None:
    batch = uploaded()
    client = APIClient()

    assert client.get(f"{BASE}{batch.pk}/checks/").status_code in (401, 403)
    assert client.post(
        f"{BASE}{batch.pk}/checks/resolve/",
        {"key": "RANK:bown stripe", "decision": "KEEP"},
        format="json",
    ).status_code in (401, 403)
