"""What the server says may be done now, so the screens hold no lifecycle
rules of their own (audit 5.1-5.3): each flag follows the same rule the write
it stands for checks."""

from __future__ import annotations

import itertools
from typing import Any

import pytest
from django.utils import timezone

from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
from gradings.services import session_may_move_to
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    grading_session,
    locked_completed_candidate,
    override_master,
    start_assessment,
    student,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db

Status = GradingSession.Status
MOVES = ("can_open", "can_lock", "can_complete", "can_cancel")
_readers = itertools.count()


def reader() -> Any:
    return auth_client(f"capability-reader-{next(_readers)}@example.com")


def session_as_served(session: GradingSession, client: Any = None) -> dict[str, Any]:
    client = client or reader()
    response = client.get(f"/api/gradings/sessions/{session.pk}/")
    assert response.status_code == 200
    return dict(response.json())


@pytest.mark.parametrize(
    ("status", "moves", "roster_open", "marking_open"),
    [
        (Status.DRAFT, {"can_open", "can_cancel"}, True, False),
        (Status.OPEN, {"can_lock", "can_cancel"}, True, True),
        (Status.LOCKED, {"can_complete"}, False, False),
        (Status.COMPLETED, set(), False, False),
        (Status.CANCELLED, set(), False, False),
    ],
)
def test_a_session_serves_the_moves_its_status_allows(
    status: str,
    moves: set[str],
    roster_open: bool,
    marking_open: bool,
) -> None:
    served = session_as_served(grading_session(status=status))

    assert {move for move in MOVES if served[move]} == moves
    assert served["roster_open"] is roster_open
    assert served["marking_open"] is marking_open
    assert served["decisions_open"] is (status == Status.LOCKED)
    assert served["cancel_reason_required"] is (status == Status.LOCKED)
    assert served["marking_begun"] is (status != Status.DRAFT)
    assert served["results_open"] is (status in {Status.LOCKED, Status.COMPLETED})


def test_a_session_serves_whether_work_is_recorded_in_it() -> None:
    session = grading_session(status=Status.OPEN)
    registered = candidate(session=session)
    prepared = assessment(candidate=registered)

    assert session_as_served(session)["has_recorded_work"] is False

    start_assessment(prepared)

    assert session_as_served(session)["has_recorded_work"] is True


def test_cancelling_a_locked_session_is_served_only_to_the_override() -> None:
    session = grading_session(status=Status.LOCKED)
    master = auth_client("plain-viewer@example.com")
    override = auth_client("override-viewer@example.com")
    override.force_authenticate(user=override_master("override@example.com"))

    assert session_as_served(session, master)["can_cancel"] is False
    assert session_as_served(session, override)["can_cancel"] is True


def test_no_move_is_offered_to_someone_who_may_not_change_sessions() -> None:
    session = grading_session(status=Status.OPEN)
    closed = user("closed-viewer@example.com", is_active=False)

    assert not any(
        session_may_move_to(session, target, closed) for target in Status.values
    )


def test_a_session_serves_how_many_were_withdrawn() -> None:
    session = grading_session(status=Status.OPEN)
    candidate(session=session)
    candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    served = session_as_served(session)

    assert (served["candidate_count"], served["withdrawn_count"]) == (1, 1)


def roster(session: GradingSession, **query: object) -> list[dict[str, Any]]:
    client = reader()
    response = client.get("/api/gradings/candidates/", {"session": session.pk, **query})
    assert response.status_code == 200
    return results(response)


def test_the_roster_filters_withdrawn_candidates_in_the_query() -> None:
    session = grading_session(status=Status.OPEN)
    staying = candidate(session=session)
    gone = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    assert [row["id"] for row in roster(session, withdrawn="false")] == [staying.pk]
    assert [row["id"] for row in roster(session, withdrawn="true")] == [gone.pk]


def test_a_candidate_row_serves_their_first_name() -> None:
    session = grading_session()
    candidate(session=session, student=student(first_name="Morgan", last_name="Lee"))

    [row] = roster(session)

    assert row["student_first_name"] == "Morgan"


def test_who_can_be_marked_absent_and_prepared_follows_the_writes() -> None:
    session = grading_session(status=Status.OPEN)
    unprepared = candidate(session=session)
    prepared = assessment(candidate=candidate(session=session)).candidate
    started = start_assessment(assessment(candidate=candidate(session=session)))
    withdrawn = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    rows = {row["id"]: row for row in roster(session)}

    absent = {pk for pk, row in rows.items() if row["can_be_marked_absent"]}
    preparable = {pk for pk, row in rows.items() if row["can_prepare_assessment"]}
    assert absent == {unprepared.pk, prepared.pk}
    assert preparable == {unprepared.pk}
    assert started.candidate_id not in absent
    assert withdrawn.pk not in preparable


def test_nobody_is_marked_absent_or_prepared_once_the_roster_closes() -> None:
    built, _ = locked_completed_candidate()

    [row] = roster(built.session)

    assert row["can_be_marked_absent"] is False
    assert row["can_prepare_assessment"] is False


def assessment_as_served(generated: CandidateAssessment) -> dict[str, Any]:
    response = reader().get(
        "/api/gradings/assessments/",
        {"candidate": generated.candidate_id},
    )
    assert response.status_code == 200
    [served] = results(response)
    return dict(served)


def test_an_assessment_can_be_started_only_when_the_session_is_open() -> None:
    open_one = assessment(
        candidate=candidate(session=grading_session(status=Status.OPEN))
    )
    draft_one = assessment(candidate=candidate(session=grading_session()))

    assert assessment_as_served(open_one)["can_start"] is True
    assert assessment_as_served(draft_one)["can_start"] is False
    assert assessment_as_served(start_assessment(open_one))["can_start"] is False


def mark_all(generated: CandidateAssessment, **only: object) -> None:
    generated.items.filter(**only).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"marker-{generated.pk}-{len(only)}@example.com"),
        assessed_at=timezone.now(),
    )


def summary(generated: CandidateAssessment) -> dict[str, Any]:
    client = reader()
    response = client.get(f"/api/gradings/assessments/{generated.pk}/summary/")
    assert response.status_code == 200
    return dict(response.json())


def test_the_summary_says_when_the_assessment_can_be_completed() -> None:
    session = grading_session(status=Status.OPEN)
    generated = start_assessment(assessment(candidate=candidate(session=session)))

    assert summary(generated)["can_complete"] is False
    mark_all(generated, required=True)
    assert summary(generated)["can_complete"] is True
    complete_assessment(generated)
    assert summary(generated)["can_complete"] is False


def items(generated: CandidateAssessment) -> dict[int, dict[str, Any]]:
    client = reader()
    response = client.get(
        "/api/gradings/assessment-items/",
        {"assessment": generated.pk, "page_size": 200},
    )
    assert response.status_code == 200
    return {row["id"]: row for row in results(response)}


def test_an_item_says_whether_its_next_change_needs_a_reason() -> None:
    session = grading_session(status=Status.OPEN)
    generated = start_assessment(assessment(candidate=candidate(session=session)))
    marker = auth_client("item-marker@example.com")
    first, second = list(generated.items.order_by("position"))[:2]

    assert items(generated)[first.pk]["reason_required"] is False
    marker.patch(f"/api/gradings/assessment-items/{first.pk}/", {"result": "MET"})
    marker.patch(f"/api/gradings/assessment-items/{second.pk}/", {"result": "MET"})
    marker.patch(
        f"/api/gradings/assessment-items/{second.pk}/",
        {"result": "NOT_ASSESSED", "reason": "Marked the wrong row."},
    )

    served = items(generated)
    assert served[first.pk]["reason_required"] is True
    # Cleared, but it has been marked before: marking it again says why.
    assert served[second.pk]["reason_required"] is True


def test_after_the_lock_every_change_needs_a_reason() -> None:
    _built, generated = locked_completed_candidate()

    assert all(row["reason_required"] for row in items(generated).values())


def test_a_mark_can_be_cleared_unless_a_completed_assessment_needs_it() -> None:
    session = grading_session(status=Status.OPEN)
    generated = start_assessment(assessment(candidate=candidate(session=session)))
    unmarked = generated.items.order_by("position").first()
    assert unmarked is not None and unmarked.required

    # Nothing to clear yet.
    assert items(generated)[unmarked.pk]["can_clear"] is False
    mark_all(generated)
    assert items(generated)[unmarked.pk]["can_clear"] is True
    complete_assessment(generated)
    # A completed assessment keeps its required marks: changed, not emptied.
    assert items(generated)[unmarked.pk]["can_clear"] is False
