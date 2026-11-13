"""Candidate records downloaded as a PDF (POST sessions/<id>/exports/records/)."""

from __future__ import annotations

from typing import Any

import pytest
from django.db import connection, transaction
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import (
    add_item_comment,
    update_candidate_assessment_item,
)
from gradings.exports import pdf
from gradings.exports.making import NOT_IN_SESSION, snapshot
from gradings.exports.records import NOT_SEALED
from gradings.models import (
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import promote_candidate
from gradings.services import transition_grading_session, withdraw_locked_candidate
from gradings.testing import (
    assessment,
    candidate,
    client_for,
    finalised_outcome,
    grading_session,
    master,
    pdf_pages,
    pdf_text,
    promoter,
    rank,
    sealed,
    staff,
    user,
)
from kukgrade.testing import results
from syllabus.models import CORE_CATEGORIES

pytestmark = pytest.mark.django_db


def url(session: GradingSession) -> str:
    return f"/api/gradings/sessions/{session.pk}/exports/records/"


def ledger_item(built: GradingCandidate) -> CandidateAssessmentItem:
    item = (
        CandidateAssessmentItem.objects.filter(assessment__candidate=built)
        .exclude(category__in=CORE_CATEGORIES)
        .order_by("position")
        .first()
    )
    assert item is not None
    return item


def lock(session: GradingSession) -> GradingSession:
    return transition_grading_session(session, GradingSession.Status.LOCKED)


def download(
    session: GradingSession, candidates: list[int], account: User | None = None
) -> Any:
    client = client_for(account or staff("downloader@x.org"))
    return client.post(url(session), {"candidates": candidates}, format="json")


# What the file holds


def test_the_records_download_as_one_pdf_in_the_gradings_order() -> None:
    session = grading_session(
        status=GradingSession.Status.OPEN,
        title="October grading – Juniors",
        location="Riverside Dojang",
    )
    senior = sealed(
        session,
        first_name="Ana",
        last_name="Adams",
        held="YELLOW_STRIPE",
        testing_for="YELLOW",
    )
    junior = sealed(session, first_name="Sam", last_name="Okafor")

    response = download(session, [senior.pk, junior.pk])

    assert response.status_code == 200, response.content
    assert response["Content-Type"] == "application/pdf"
    assert "Records%20%282%29.pdf" in response["Content-Disposition"]
    assert response["Cache-Control"] == "no-store"
    texts = pdf_pages(response.content)
    junior_at = next(n for n, t in enumerate(texts) if "Sam Okafor ·" in t)
    senior_at = next(n for n, t in enumerate(texts) if "Ana Adams ·" in t)
    # The white belt first, whichever was ticked first.
    assert junior_at < senior_at
    first = texts[junior_at]
    assert f"Sam Okafor · {junior.student.wksa_id}" in first
    assert "White → Yellow Stripe · October grading – Juniors" in first
    assert "PROVISIONAL" in first
    assert "Junior ages 9-12" in first
    assert "Riverside Dojang" in first
    assert "Page 1 of" in first


def test_one_record_is_named_for_its_candidate() -> None:
    session = grading_session(
        status=GradingSession.Status.OPEN, title="October grading"
    )
    built = sealed(session, first_name="José", last_name="Smith")

    response = download(session, [built.pk])

    assert response.status_code == 200
    assert response["Content-Disposition"] == (
        "attachment; filename*=utf-8''2027-03-20%20October%20grading%20%E2%80%93"
        "%20Record%20%E2%80%93%20Jos%C3%A9%20Smith.pdf"
    )


def test_a_record_holds_every_requirement_its_marks_and_who_marked_them() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    items = list(CandidateAssessmentItem.objects.filter(assessment__candidate=built))

    printed = pdf_text(download(session, [built.pk]).content)

    for item in items:
        assert item.item_name in printed
        if item.korean_name:
            assert item.korean_name in printed
    assert "Core grading areas" in printed
    assert f"{len(items)} of {len(items)} requirements met" in printed
    assert "KSN Jane Smith" in printed
    assert "Requirement" in printed and "Marked by" in printed


def test_every_comment_and_reasoned_change_is_printed_with_who_and_when() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    item = ledger_item(built)
    coach = staff("coach@x.org", first_name="Min", last_name="Park", rank=rank("JKN"))
    add_item_comment(item, "Strong <b>stance</b> & good control.", coach)
    # The first recorded change is the mark itself and is not listed; each
    # later one is, with its reason, as on the record screen.
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.NOT_MET,
        reason="First look.",
        assessor=coach,
    )
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        reason="Steady on the second attempt.",
        assessor=coach,
    )

    printed = pdf_text(download(session, [built.pk]).content)

    assert "“Strong <b>stance</b> & good control.” — JKN Min Park" in printed
    assert "Changed from Not met to Met: “Steady on the second attempt.”" in printed
    assert "First look." not in printed
    assert "Changes after the lock" in printed


def test_a_final_record_names_the_decision_the_master_and_the_promotion() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    lock(session)
    outcome = finalised_outcome(built)
    promote_candidate(outcome, promoter("records-promoter@x.org"))
    outcome.refresh_from_db()

    printed = pdf_text(download(session, [built.pk]).content)

    assert "FINAL RECORD" in printed
    assert "Pass ·" in printed
    assert "Final decision recorded." in printed
    assert "Yellow Stripe, from" in printed
    assert "Signed · Master:" in printed
    assert "· Final record" in printed


def test_corrections_after_the_lock_are_listed_on_their_own() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    lock(session)
    item = ledger_item(built)
    corrector = master("records-master@x.org")
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.NOT_MET,
        reason="Seen again on the video.",
        assessor=corrector,
    )

    printed = pdf_text(download(session, [built.pk]).content)

    after = printed.split("Changes after the lock", 1)[1]
    assert f"{item.item_name}: Changed from Met to Not met" in after
    assert "after the lock" in after
    assert "None." not in after


def test_a_withdrawn_candidates_record_says_so_and_why() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    lock(session)
    withdraw_locked_candidate(
        built,
        GradingCandidate.WithdrawalReason.INJURY,
        "Hurt a wrist in the breaking.",
        user("override@x.org", is_superuser=True),
    )

    printed = pdf_text(download(session, [built.pk]).content)

    assert "WITHDRAWN" in printed
    assert "Injured during grading" in printed
    assert "Hurt a wrist in the breaking." in printed
    assert "No final decision recorded" in printed


def test_a_record_with_nothing_written_says_so_in_words() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)

    printed = pdf_text(download(session, [built.pk]).content)

    assert "No overall note was recorded." in printed
    assert "No proposal recorded" in printed
    assert "Not promoted" in printed
    assert "None." in printed


def test_a_record_never_holds_a_date_of_birth_or_an_email_address() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    born = built.student.date_of_birth

    printed = pdf_text(download(session, [built.pk]).content)

    assert pdf.day(born) not in printed
    assert born.isoformat() not in printed
    assert "@" not in printed


@override_settings(DEMO_MODE=True)
def test_a_demo_record_says_so_on_every_page() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)

    texts = pdf_pages(download(session, [built.pk]).content)

    assert all(page.count(pdf.DEMO_BAND) == 2 for page in texts)


def test_many_long_comments_run_on_over_pdf_pages() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    item = ledger_item(built)
    writer = staff("long-writer@x.org")
    for n in range(12):
        add_item_comment(item, f"Comment {n}: " + "word " * 390, writer)

    response = download(session, [built.pk])

    assert response.status_code == 200
    texts = pdf_pages(response.content)
    assert len(texts) > 2
    assert all(f"Page {n} of {len(texts)}" in page for n, page in enumerate(texts, 1))


# Refusals


def test_nothing_is_made_unless_every_candidate_has_a_sealed_record() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    ready = sealed(session)
    unsealed = candidate(session=session)
    assessment(candidate=unsealed)
    elsewhere = sealed(grading_session(status=GradingSession.Status.OPEN))

    response = download(session, [ready.pk, unsealed.pk, elsewhere.pk, 999999])

    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {
        str(unsealed.pk): [NOT_SEALED],
        str(elsewhere.pk): [NOT_IN_SESSION],
        "999999": [NOT_IN_SESSION],
    }
    assert not AuditEvent.objects.filter(action=AuditAction.RECORDS_DOWNLOADED).exists()


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"candidates": []}, "Choose at least one candidate."),
        ({"candidates": [1, 1]}, "A candidate is chosen twice."),
        ({}, "This field is required."),
    ],
)
def test_a_bad_list_is_refused(body: dict[str, Any], message: str) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)

    response = client_for(staff("bad-list@x.org")).post(
        url(session), body, format="json"
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["candidates"] == [message]


def test_too_many_candidates_for_one_file_are_refused() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)

    response = download(session, list(range(1, 62)))

    assert response.status_code == 400
    assert "at most 60" in response.json()["error"]["message"]


def test_an_unknown_session_is_not_found() -> None:
    response = client_for(staff("unknown@x.org")).post(
        "/api/gradings/sessions/999999/exports/records/",
        {"candidates": [1]},
        format="json",
    )

    assert response.status_code == 404


# Who may


def test_signed_out_nobody_downloads_a_record() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)

    response = APIClient().post(url(session), {"candidates": [built.pk]})

    assert response.status_code in (401, 403)
    assert response["Content-Type"] == "application/json"


def test_an_account_that_cannot_see_assessments_cannot_download_them() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    account = staff("no-groups@x.org")
    account.groups.clear()
    grant_permission(account, "gradings.view_gradingsession")

    response = download(session, [built.pk], User.objects.get(pk=account.pk))

    assert response.status_code == 403


@pytest.mark.parametrize(
    "account",
    [
        lambda: staff("instructor@x.org"),
        lambda: staff("administrator@x.org", role=User.Role.ADMINISTRATOR),
        lambda: master("records-reader-master@x.org"),
    ],
)
def test_anyone_who_can_read_the_record_may_download_it(account: Any) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)

    assert download(session, [built.pk], account()).status_code == 200


def test_without_sight_of_promotions_the_record_leaves_them_out() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = sealed(session)
    account = staff("no-promotions@x.org")
    account.groups.clear()
    for codename in (
        "view_gradingsession",
        "view_gradingcandidate",
        "view_candidateassessment",
        "view_candidateassessmentitem",
        "view_candidateoutcome",
    ):
        account = grant_permission(account, f"gradings.{codename}")

    response = download(session, [built.pk], account)

    assert response.status_code == 200
    assert "Promotion" not in pdf_text(response.content)


# The audit log


def test_one_event_names_everyone_in_the_file_by_wksa_id_only() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, title="October")
    first = sealed(session, first_name="Priya", last_name="Nair")
    second = sealed(session, first_name="Sam", last_name="Okafor")

    download(session, [first.pk, second.pk], staff("auditor@x.org"))

    [event] = AuditEvent.objects.filter(action=AuditAction.RECORDS_DOWNLOADED)
    assert event.entity_type == "GradingSession"
    assert event.entity_id == str(session.pk)
    assert event.summary == (
        "Records of 2 candidates downloaded as a PDF from grading session 'October'."
    )
    assert event.metadata == {
        "session_id": session.pk,
        "candidates": [first.student.wksa_id, second.student.wksa_id],
        "candidate_ids": [first.pk, second.pk],
        "student_ids": [first.student_id, second.student_id],
    }
    written = f"{event.summary} {event.metadata}"
    for name in ("Priya", "Nair", "Sam", "Okafor"):
        assert name not in written


def test_a_single_record_is_audited_by_the_students_wksa_id() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, title="October")
    built = sealed(session)

    download(session, [built.pk])

    [event] = AuditEvent.objects.filter(action=AuditAction.RECORDS_DOWNLOADED)
    assert event.summary == (
        f"Record of student {built.student.wksa_id} downloaded as a PDF from "
        "grading session 'October'."
    )


def test_the_download_is_in_the_students_the_candidates_and_the_sessions_history() -> (
    None
):
    session = grading_session(status=GradingSession.Status.OPEN)
    first = sealed(session)
    second = sealed(session, first_name="Sam", last_name="Okafor")
    download(session, [first.pk, second.pk])
    reader = client_for(staff("history-reader@x.org", role=User.Role.ADMINISTRATOR))

    for subject in (
        f"student:{second.student_id}",
        f"candidate:{second.pk}",
        f"session:{session.pk}",
    ):
        rows = results(
            reader.get("/api/audit-events/", {"subject": subject, "page_size": "200"})
        )
        assert AuditAction.RECORDS_DOWNLOADED in {row["action"] for row in rows}
        [row] = [r for r in rows if r["action"] == AuditAction.RECORDS_DOWNLOADED]
        assert {
            "label": "Candidates",
            "value": (f"{first.student.wksa_id}, {second.student.wksa_id}"),
        } in row["details"]


# What the roster offers


def test_the_roster_says_whose_record_can_be_downloaded() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    ready = sealed(session)
    unsealed = candidate(session=session)

    rows = results(
        client_for(staff("roster@x.org")).get(
            "/api/gradings/candidates/", {"session": session.pk}
        )
    )

    offered = {row["id"]: row["can_download_record"] for row in rows}
    assert offered == {ready.pk: True, unsealed.pk: False}


# Reading


def test_the_file_takes_the_same_queries_however_many_records_it_holds() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    one = [sealed(session).pk]
    account = staff("count@x.org")
    client = client_for(account)
    client.post(url(session), {"candidates": one}, format="json")  # warm caches
    with CaptureQueriesContext(connection) as single:
        client.post(url(session), {"candidates": one}, format="json")
    three = one + [
        sealed(session, first_name=name, last_name="Lee").pk for name in ("Bo", "Cy")
    ]
    with CaptureQueriesContext(connection) as several:
        client.post(url(session), {"candidates": three}, format="json")

    assert len(several) == len(single)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_a_file_is_read_as_one_moment() -> None:
    with snapshot(), connection.cursor() as cursor:
        cursor.execute("SHOW transaction_isolation")
        assert cursor.fetchone() == ("repeatable read",)
    # Inside a transaction already, it keeps that transaction's own.
    with transaction.atomic(), snapshot(), connection.cursor() as cursor:
        cursor.execute("SHOW transaction_isolation")
        assert cursor.fetchone() == ("read committed",)
