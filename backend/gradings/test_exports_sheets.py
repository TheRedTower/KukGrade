"""Grading sheets printed as a PDF (POST sessions/<id>/exports/grading-sheets/)."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.exports import pdf
from gradings.exports.making import NOT_IN_SESSION
from gradings.exports.sheets import NOT_OPEN, WITHDRAWN
from gradings.models import GradingCandidate, GradingSession
from gradings.testing import (
    candidate,
    client_for,
    grading_session,
    master,
    pdf_pages,
    pdf_text,
    rank,
    staff,
    student,
)
from kukgrade.testing import results
from syllabus.models import CORE_CATEGORIES
from syllabus.services import effective_syllabus_requirements

pytestmark = pytest.mark.django_db


def url(session: GradingSession) -> str:
    return f"/api/gradings/sessions/{session.pk}/exports/grading-sheets/"


def print_sheets(
    session: GradingSession, candidates: list[int], account: User | None = None
) -> Any:
    client = client_for(account or staff("sheets@x.org"))
    return client.post(url(session), {"candidates": candidates}, format="json")


def registered(session: GradingSession, **names: Any) -> GradingCandidate:
    held = names.pop("held", "WHITE")
    testing_for = names.pop("testing_for", "YELLOW_STRIPE")
    return candidate(
        session=session,
        student=student(current_rank=rank(held), **names),
        testing_for_rank=rank(testing_for),
    )


@override_settings(CLUB_NAME="KSW Colchester")
def test_each_candidate_gets_one_filled_in_page_in_the_gradings_order() -> None:
    session = grading_session(title="October grading – Juniors")
    senior = registered(
        session,
        first_name="Ana",
        last_name="Adams",
        held="YELLOW_STRIPE",
        testing_for="YELLOW",
    )
    junior = registered(session, first_name="Sam", last_name="Okafor")

    response = print_sheets(session, [senior.pk, junior.pk])

    assert response.status_code == 200, response.content
    assert "Grading%20sheets.pdf" in response["Content-Disposition"]
    first, second = (" ".join(page.split()) for page in pdf_pages(response.content))
    assert f"Sam Okafor · {junior.student.wksa_id}" in first
    assert f"Ana Adams · {senior.student.wksa_id}" in second
    assert "Grading Form KSW Colchester" in first
    assert "Current Rank White" in first
    assert "Testing date 20 Mar 2027" in first
    # The paper form's own look: its heading once, and a small foot.
    assert first.count("KSW Colchester") == 1
    assert "Page" not in first and "Made" not in first
    printed = pdf.day(timezone.localdate())
    assert first.endswith(f"October grading – Juniors Printed {printed}")
    assert first.count("Subject Comments") == 2


def test_the_core_areas_come_from_the_age_bands_chart() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = registered(session)
    expected = [
        row.requirement.item
        for row in effective_syllabus_requirements(
            rank=built.testing_for_rank, age_band=built.age_band
        )
        if row.requirement.item.category in CORE_CATEGORIES
    ]

    printed = pdf_text(print_sheets(session, [built.pk]).content)

    assert len(expected) == 6
    for item in expected:
        assert item.name in printed
        assert item.korean_name in printed
    assert printed.count("P □ F □") == 6


def test_a_very_long_name_still_fits_on_one_page() -> None:
    session = grading_session()
    built = registered(session, first_name="Long" * 37, last_name="Name" * 37)

    response = print_sheets(session, [built.pk])

    assert response.status_code == 200
    assert len(pdf_pages(response.content)) == 1


def test_a_sheet_never_holds_a_date_of_birth() -> None:
    session = grading_session()
    built = registered(session)

    printed = pdf_text(print_sheets(session, [built.pk]).content)

    assert pdf.day(built.student.date_of_birth) not in printed
    assert built.student.date_of_birth.isoformat() not in printed


@override_settings(DEMO_MODE=True)
def test_a_demo_sheet_says_so() -> None:
    session = grading_session()
    built = registered(session)

    [page] = pdf_pages(print_sheets(session, [built.pk]).content)

    assert page.count(pdf.DEMO_BAND) == 2


# Refusals


def test_nothing_is_printed_for_a_withdrawn_candidate_or_one_from_elsewhere() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    ready = registered(session)
    gone = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)
    elsewhere = registered(grading_session())

    response = print_sheets(session, [ready.pk, gone.pk, elsewhere.pk])

    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {
        str(gone.pk): [WITHDRAWN],
        str(elsewhere.pk): [NOT_IN_SESSION],
    }
    assert not AuditEvent.objects.filter(action=AuditAction.GRADING_SHEETS_PRINTED)


@pytest.mark.parametrize(
    "status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_sheets_are_printed_only_before_the_lock(status: str) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = registered(session)
    GradingSession.objects.filter(pk=session.pk).update(status=status)

    response = print_sheets(session, [built.pk])

    assert response.status_code == 400
    assert response.json()["error"]["message"] == NOT_OPEN


def test_a_bad_list_is_refused() -> None:
    session = grading_session()

    response = client_for(staff("sheets-bad@x.org")).post(
        url(session), {"candidates": []}, format="json"
    )

    assert response.status_code == 400


# Who may


def test_signed_out_nobody_prints_a_sheet() -> None:
    session = grading_session()
    built = registered(session)

    response = APIClient().post(url(session), {"candidates": [built.pk]})

    assert response.status_code in (401, 403)


def test_an_account_that_cannot_see_assessments_cannot_print_sheets() -> None:
    session = grading_session()
    built = registered(session)
    account = staff("sheets-no-groups@x.org")
    account.groups.clear()
    account = grant_permission(account, "gradings.view_gradingsession")

    assert print_sheets(session, [built.pk], account).status_code == 403


@pytest.mark.parametrize(
    "account",
    [
        lambda: staff("sheets-instructor@x.org"),
        lambda: staff("sheets-admin@x.org", role=User.Role.ADMINISTRATOR),
        lambda: master("sheets-master@x.org"),
    ],
)
def test_anyone_who_can_read_the_grading_may_print_its_sheets(account: Any) -> None:
    session = grading_session()
    built = registered(session)

    assert print_sheets(session, [built.pk], account()).status_code == 200


# The audit log, and what the screens are told


def test_one_event_names_everyone_printed_by_wksa_id() -> None:
    session = grading_session(title="October")
    first = registered(session, first_name="Priya", last_name="Nair")
    second = registered(session, first_name="Sam", last_name="Okafor")

    print_sheets(session, [first.pk, second.pk])

    [event] = AuditEvent.objects.filter(action=AuditAction.GRADING_SHEETS_PRINTED)
    assert event.summary == (
        "Grading sheets for 2 candidates printed from grading session 'October'."
    )
    assert event.metadata["candidates"] == [
        first.student.wksa_id,
        second.student.wksa_id,
    ]
    assert "Nair" not in f"{event.summary} {event.metadata}"


def test_a_single_sheet_is_audited_by_the_students_wksa_id() -> None:
    session = grading_session(title="October")
    built = registered(session)

    print_sheets(session, [built.pk])

    [event] = AuditEvent.objects.filter(action=AuditAction.GRADING_SHEETS_PRINTED)
    assert event.summary == (
        f"Grading sheet for student {built.student.wksa_id} printed from grading "
        "session 'October'."
    )


def test_the_session_and_roster_say_when_sheets_can_be_printed() -> None:
    draft = grading_session()
    ready = registered(draft)
    gone = candidate(session=draft, status=GradingCandidate.Status.WITHDRAWN)
    locked = grading_session(status=GradingSession.Status.LOCKED)
    client = client_for(staff("sheets-flags@x.org"))

    sessions = {
        row["id"]: row["can_print_grading_sheets"]
        for row in results(client.get("/api/gradings/sessions/"))
    }
    roster = {
        row["id"]: row["can_print_grading_sheet"]
        for row in results(
            client.get("/api/gradings/candidates/", {"session": draft.pk})
        )
    }

    assert (sessions[draft.pk], sessions[locked.pk]) == (True, False)
    assert roster == {ready.pk: True, gone.pk: False}
