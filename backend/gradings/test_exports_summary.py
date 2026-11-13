"""The session summary downloaded as a PDF (POST sessions/<id>/exports/summary/)."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.exports import pdf
from gradings.exports.summary import NOT_YET
from gradings.models import CandidateOutcome, GradingCandidate, GradingSession
from gradings.outcome_services import promote_candidate
from gradings.services import transition_grading_session
from gradings.testing import (
    candidate,
    client_for,
    finalised_outcome,
    grading_session,
    master,
    pdf_pages,
    pdf_text,
    promoter,
    sealed,
    staff,
    student,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db

Outcome = CandidateOutcome.Outcome


def url(session: GradingSession) -> str:
    return f"/api/gradings/sessions/{session.pk}/exports/summary/"


def download(session: GradingSession, account: User | None = None) -> Any:
    return client_for(account or staff("summary@x.org")).post(url(session))


def graded() -> tuple[GradingSession, dict[str, GradingCandidate]]:
    """A locked grading: two passes to different ranks, a conditional, a
    fail, one awaiting a decision and one who did not attend."""
    session = grading_session(
        status=GradingSession.Status.OPEN,
        title="October grading – Juniors",
        location="Riverside Dojang",
    )
    people = {
        "pass_white": sealed(session, first_name="Ana", last_name="Adams"),
        "pass_yellow": sealed(
            session,
            first_name="Bo",
            last_name="Brown",
            held="YELLOW_STRIPE",
            testing_for="YELLOW",
        ),
        "conditional": sealed(session, first_name="Cy", last_name="Chen"),
        "fail": sealed(session, first_name="Di", last_name="Diaz"),
        "awaiting": sealed(session, first_name="Ed", last_name="Evans"),
        "absent": candidate(
            session=session,
            student=student(first_name="Flo", last_name="Fox"),
            status=GradingCandidate.Status.WITHDRAWN,
        ),
    }
    transition_grading_session(session, GradingSession.Status.LOCKED)
    finalised_outcome(people["pass_white"])
    finalised_outcome(people["pass_yellow"])
    finalised_outcome(
        people["conditional"],
        proposed=Outcome.CONDITIONAL,
        final=Outcome.CONDITIONAL,
        conditional_requirements="Repeat the breaking.",
    )
    finalised_outcome(people["fail"], proposed=Outcome.FAIL, final=Outcome.FAIL)
    session.refresh_from_db()
    return session, people


def test_a_locked_grading_downloads_a_provisional_summary() -> None:
    session, people = graded()

    response = download(session)

    assert response.status_code == 200, response.content
    assert response["Content-Type"] == "application/pdf"
    assert "Summary.pdf" in response["Content-Disposition"]
    [page] = pdf_pages(response.content)
    printed = " ".join(page.split())
    assert "PROVISIONAL" in printed
    assert "Locked, 1 decision still to be recorded" in printed
    assert "Riverside Dojang" in printed
    # The grading's order: the white belts by surname, the yellow stripe last.
    lined_up = ["Ana Adams", "Cy Chen", "Di Diaz", "Ed Evans", "Bo Brown"]
    places = [printed.index(name) for name in lined_up]
    assert places == sorted(places)
    assert "Awaiting decision" in printed
    assert "Not promoted yet" in printed
    assert people["pass_white"].student.wksa_id in printed


def test_those_not_graded_are_listed_with_why() -> None:
    session, people = graded()

    printed = pdf_text(download(session).content)

    not_graded = printed.split("Not graded", 1)[1].split("Passes by rank", 1)[0]
    assert "Flo Fox" in not_graded
    assert "Did not attend" in not_graded
    assert "Ana Adams" not in not_graded


def test_passes_are_counted_by_the_rank_achieved_and_the_rest_said() -> None:
    session, _people = graded()

    printed = pdf_text(download(session).content)

    passes = printed.split("Passes by rank achieved", 1)[1]
    assert "Yellow Stripe: 1 Yellow: 1 Total: 2" in passes
    assert (
        "Not counted above: Conditional 1 · Fail 1 · Withdrawn 1 · Awaiting decision 1"
    ) in passes
    assert "Signed · Master:" in passes


def test_a_completed_grading_downloads_a_final_summary_with_promotions() -> None:
    session, people = graded()
    finalised_outcome(people["awaiting"], proposed=Outcome.FAIL, final=Outcome.FAIL)
    passed = CandidateOutcome.objects.get(candidate=people["pass_white"])
    promote_candidate(passed, promoter("summary-promoter@x.org"))
    transition_grading_session(session, GradingSession.Status.COMPLETED)

    printed = pdf_text(download(session).content)

    assert "FINAL" in printed and "Completed" in printed
    assert "PROVISIONAL" not in printed
    assert "Yellow Stripe, " in printed
    assert "Not promoted" in printed
    assert "Awaiting decision 0" in printed


def test_a_summary_never_holds_a_note_a_date_of_birth_or_an_email_address() -> None:
    session, people = graded()

    printed = pdf_text(download(session).content)

    assert "Repeat the breaking." not in printed
    assert "Final decision recorded." not in printed
    assert pdf.day(people["fail"].student.date_of_birth) not in printed
    assert "@" not in printed


@override_settings(DEMO_MODE=True)
def test_a_demo_summary_says_so() -> None:
    session, _people = graded()

    [page] = pdf_pages(download(session).content)

    assert page.count(pdf.DEMO_BAND) == 2


@pytest.mark.parametrize(
    "status",
    [
        GradingSession.Status.DRAFT,
        GradingSession.Status.OPEN,
        GradingSession.Status.CANCELLED,
    ],
)
def test_a_summary_waits_for_the_lock(status: str) -> None:
    session = grading_session(status=status)

    response = download(session)

    assert response.status_code == 400
    assert response.json()["error"]["message"] == NOT_YET
    assert not AuditEvent.objects.filter(action=AuditAction.SUMMARY_DOWNLOADED)


def test_an_archived_grading_still_has_its_summary() -> None:
    session, _people = graded()
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.COMPLETED, archived_at=session.created_at
    )

    assert download(session).status_code == 200


def test_signed_out_nobody_downloads_a_summary() -> None:
    session, _people = graded()

    assert APIClient().post(url(session)).status_code in (401, 403)


def test_an_account_that_cannot_see_assessments_cannot_download_a_summary() -> None:
    session, _people = graded()
    account = staff("summary-no-groups@x.org")
    account.groups.clear()
    account = grant_permission(account, "gradings.view_gradingsession")

    assert download(session, account).status_code == 403


@pytest.mark.parametrize(
    "account",
    [
        lambda: staff("summary-instructor@x.org"),
        lambda: staff("summary-admin@x.org", role=User.Role.ADMINISTRATOR),
        lambda: master("summary-master@x.org"),
    ],
)
def test_anyone_who_can_read_the_records_may_download_the_summary(
    account: Any,
) -> None:
    session, _people = graded()

    assert download(session, account()).status_code == 200


def test_one_event_names_everyone_in_the_summary_by_wksa_id() -> None:
    session, people = graded()

    download(session)

    [event] = AuditEvent.objects.filter(action=AuditAction.SUMMARY_DOWNLOADED)
    assert event.entity_id == str(session.pk)
    assert event.summary == (
        "Summary of grading session 'October grading – Juniors' downloaded as a PDF."
    )
    everyone = sorted(people.values(), key=lambda c: c.pk)
    assert sorted(event.metadata["candidate_ids"]) == [c.pk for c in everyone]
    assert sorted(event.metadata["candidates"]) == sorted(
        c.student.wksa_id for c in everyone
    )
    assert "Adams" not in f"{event.summary} {event.metadata}"


def test_the_session_says_when_its_summary_can_be_downloaded() -> None:
    locked, _people = graded()
    open_session = grading_session(status=GradingSession.Status.OPEN)
    client = client_for(staff("summary-flag@x.org"))

    offered = {
        row["id"]: row["can_download_summary"]
        for row in results(client.get("/api/gradings/sessions/"))
    }

    assert offered[locked.pk] is True
    assert offered[open_session.pk] is False
