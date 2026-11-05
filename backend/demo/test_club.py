"""The demo club as it is built: one build for the whole module.

Building it through the real services takes about ten seconds, so it is built
once, inside a transaction rolled back when the module ends. Each test runs in
its own savepoint within it: every test starts from the same club, and nothing
leaks to other modules.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from demo import seed
from demo.personas import DEMO_PASSWORD, PERSONA_EMAILS, PERSONAS
from demo.testing import session_named, sign_in
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    Promotion,
)
from gradings.services import unsettled_registrations
from students.models import Student

Status = GradingSession.Status

demo_mode = override_settings(DEMO_MODE=True)


# One worker builds the club once for all of these, rather than each worker its own.
pytestmark = pytest.mark.xdist_group("demo_club")


@pytest.fixture(scope="module", autouse=True)
def club(django_db_setup: None, django_db_blocker: Any) -> Iterator[None]:
    with django_db_blocker.unblock():
        outer = transaction.atomic()
        outer.__enter__()
        try:
            with override_settings(DEMO_MODE=True):
                seed.build()
            yield
        finally:
            transaction.set_rollback(True)
            outer.__exit__(None, None, None)


@pytest.fixture(autouse=True)
def in_demo_mode() -> Iterator[None]:
    with override_settings(DEMO_MODE=True):
        yield


@pytest.mark.django_db
def test_the_club_is_built_with_a_grading_in_every_state() -> None:
    states = {s.title: s.status for s in GradingSession.objects.all()}
    assert states == {
        "Autumn Grading": Status.COMPLETED,
        "Winter Grading": Status.COMPLETED,
        "Spring Grading": Status.LOCKED,
        "Summer Grading": Status.OPEN,
        "Autumn Grading (planned)": Status.DRAFT,
    }


@pytest.mark.django_db
def test_there_are_students_who_are_not_yet_in_any_grading() -> None:
    free = Student.objects.filter(status=Student.Status.ACTIVE).exclude(
        pk__in=unsettled_registrations().values("student_id"),
    )
    assert free.count() >= 15
    assert Student.objects.filter(status=Student.Status.INACTIVE).count() == 2
    assert Student.objects.filter(status=Student.Status.LEFT).count() == 1


@pytest.mark.django_db
def test_the_open_grading_has_assessments_to_tick_and_a_withdrawal() -> None:
    session = session_named("Summer Grading")
    statuses = list(
        CandidateAssessment.objects.filter(candidate__session=session).values_list(
            "status",
            flat=True,
        ),
    )
    assert statuses.count(CandidateAssessment.Status.NOT_STARTED) >= 2
    assert statuses.count(CandidateAssessment.Status.IN_PROGRESS) == 5
    assert statuses.count(CandidateAssessment.Status.COMPLETED) == 2
    started = CandidateAssessment.objects.filter(
        candidate__session=session,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    # Part way: items still waiting for a visitor on every one, comments on three.
    for assessment in started:
        assert assessment.items.filter(result="NOT_ASSESSED", required=True).exists()
    assert sum(a.items.filter(comments__isnull=False).exists() for a in started) == 3
    withdrawn = GradingCandidate.objects.filter(
        session=session,
        status=GradingCandidate.Status.WITHDRAWN,
    )
    assert withdrawn.count() == 1


@pytest.mark.django_db
def test_the_locked_grading_waits_for_the_masters_decision() -> None:
    outcomes = CandidateOutcome.objects.filter(
        candidate__session=session_named("Spring Grading"),
    )
    assert outcomes.filter(status=CandidateOutcome.Status.PROPOSED).count() == 5
    # Two candidates have no recommendation yet, so they have no record at all.
    assert outcomes.count() == 5
    assert not outcomes.filter(status=CandidateOutcome.Status.FINALISED).exists()
    proposed = set(
        outcomes.filter(status=CandidateOutcome.Status.PROPOSED).values_list(
            "proposed_outcome",
            flat=True,
        ),
    )
    assert proposed == {"PASS", "FAIL", "CONDITIONAL"}


@pytest.mark.django_db
def test_the_promotion_ledger_has_history_including_a_master_override() -> None:
    assert Promotion.objects.count() == 14
    overridden = CandidateOutcome.objects.filter(
        proposed_outcome="FAIL",
        final_outcome="PASS",
    )
    assert overridden.count() == 1
    assert CandidateOutcome.objects.filter(final_outcome="CONDITIONAL").exists()
    assert CandidateOutcome.objects.filter(final_outcome="FAIL").exists()
    # A student's rank moved on, by the promotion and not by hand.
    promoted = Promotion.objects.select_related("student").first()
    assert promoted is not None
    assert promoted.student.current_rank == promoted.to_rank


@pytest.mark.django_db
def test_the_planned_grading_includes_a_black_belt_candidate() -> None:
    codes = set(
        GradingCandidate.objects.filter(
            session=session_named("Autumn Grading (planned)"),
        ).values_list("testing_for_rank__code", flat=True),
    )
    assert "JKN" in codes


@pytest.mark.django_db
def test_some_imported_history_is_linked_and_some_waits_to_be() -> None:
    assert LegacyGradingRecord.objects.count() == 8
    assert LegacyGradingRecord.objects.filter(student__isnull=False).count() == 5


@pytest.mark.django_db
def test_the_audit_log_is_real_and_dated_to_the_gradings() -> None:
    assert AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).exists()
    assert AuditEvent.objects.filter(action=AuditAction.OUTCOME_FINALISED).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.USER_AUTHORITY_CHANGED,
    ).exists()
    oldest = AuditEvent.objects.order_by("occurred_at").first()
    assert oldest is not None
    assert (datetime.now(UTC) - oldest.occurred_at).days >= 300
    autumn = session_named("Autumn Grading")
    finalised = AuditEvent.objects.filter(
        action=AuditAction.OUTCOME_FINALISED,
    ).order_by("occurred_at")
    first = finalised.first()
    assert first is not None
    assert first.occurred_at.astimezone(ZoneInfo("UTC")).date() <= autumn.grading_date


@pytest.mark.django_db
def test_only_the_master_may_decide_and_nobody_is_a_superuser() -> None:
    users = {user.email: user for user in User.objects.filter(email__in=PERSONA_EMAILS)}
    master = users["master@demo.example.com"]
    instructor = users["instructor@demo.example.com"]
    administrator = users["administrator@demo.example.com"]
    assert master.has_perm("gradings.can_make_final_grading_decision")
    assert master.has_perm("gradings.can_promote_student")
    assert not instructor.has_perm("gradings.can_make_final_grading_decision")
    assert not administrator.has_perm("gradings.can_make_final_grading_decision")
    assert not any(user.is_superuser for user in users.values())
    assert not any(user.must_change_password for user in users.values())


# Safety


@pytest.mark.django_db
def test_grading_work_stays_open_to_the_instructor() -> None:
    client = sign_in("instructor@demo.example.com")
    assessment = CandidateAssessment.objects.filter(
        candidate__session=session_named("Summer Grading"),
        status=CandidateAssessment.Status.IN_PROGRESS,
    ).first()
    assert assessment is not None
    item: CandidateAssessmentItem | None = assessment.items.filter(
        result="NOT_ASSESSED",
        required=True,
    ).first()
    assert item is not None

    response = client.patch(
        f"/api/gradings/assessment-items/{item.pk}/",
        {"result": "MET"},
        format="json",
    )
    commented = client.post(
        f"/api/gradings/assessment-items/{item.pk}/comments/",
        {"body": "Looked sharp."},
        format="json",
    )

    assert response.status_code == 200, response.content
    assert commented.status_code == 201, commented.content


@pytest.mark.django_db
def test_many_people_can_be_signed_in_to_one_account_at_once() -> None:
    visitors = [sign_in("instructor@demo.example.com") for _ in range(12)]

    assert all(v.get("/api/auth/me/").status_code == 200 for v in visitors)
    visitors[0].post("/api/auth/logout/")
    assert visitors[0].get("/api/auth/me/").status_code in (401, 403)
    assert all(v.get("/api/auth/me/").status_code == 200 for v in visitors[1:])


@pytest.mark.django_db
def test_each_demo_account_signs_in_with_the_published_password() -> None:
    for persona in PERSONAS:
        me = sign_in(persona.email).get("/api/auth/me/").json()
        assert me["email"] == persona.email


# What the sign-in screen is told


@pytest.mark.django_db
def test_the_site_settings_publish_the_demo_accounts_and_next_reset() -> None:
    served = APIClient().get("/api/site/").json()["demo"]

    assert served["password"] == DEMO_PASSWORD
    assert [a["key"] for a in served["accounts"]] == [p.key for p in PERSONAS]
    assert datetime.fromisoformat(served["next_reset_at"]) > datetime.now(UTC)


@pytest.mark.django_db
def test_every_students_age_is_the_roster_age() -> None:
    today = datetime.now(ZoneInfo(settings.TIME_ZONE)).date()
    ages = {
        (first, last): age
        for first, last, age, _ in [*seed.ROSTER, *seed.INACTIVE, *seed.LEFT]
    }
    for student in Student.objects.all():
        born = student.date_of_birth
        age = (
            today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        )
        assert age == ages[(student.first_name, student.last_name)]
