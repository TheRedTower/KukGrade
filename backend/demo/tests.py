from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from django.core.management.base import CommandError
from django.db import connection
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from demo import seed
from demo.personas import DEMO_PASSWORD, PERSONA_EMAILS, PERSONAS
from demo.reset import club_tables, reset
from demo.schedule import next_reset_at
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
from ranks.models import Rank
from students.models import Student
from syllabus.models import SyllabusRequirement

Status = GradingSession.Status

demo_mode = override_settings(DEMO_MODE=True)


@pytest.fixture
def club() -> Iterator[None]:
    with override_settings(DEMO_MODE=True):
        seed.build()
        yield


def session_named(title: str) -> GradingSession:
    return GradingSession.objects.get(title=title)


def sign_in(email: str) -> APIClient:
    client = APIClient()
    token = client.get("/api/auth/me/").cookies["csrftoken"].value
    response = client.post(
        "/api/auth/login/",
        {"email": email, "password": DEMO_PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200, response.content
    return client


# Building


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
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
@pytest.mark.usefixtures("club")
def test_there_are_students_who_are_not_yet_in_any_grading() -> None:
    free = Student.objects.filter(status=Student.Status.ACTIVE).exclude(
        pk__in=unsettled_registrations().values("student_id"),
    )
    assert free.count() >= 15
    assert Student.objects.filter(status=Student.Status.INACTIVE).count() == 2
    assert Student.objects.filter(status=Student.Status.LEFT).count() == 1


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
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
    assert sum(a.items.exclude(assessor_notes="").exists() for a in started) == 3
    withdrawn = GradingCandidate.objects.filter(
        session=session,
        status=GradingCandidate.Status.WITHDRAWN,
    )
    assert withdrawn.count() == 1


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
def test_the_locked_grading_waits_for_the_masters_decision() -> None:
    outcomes = CandidateOutcome.objects.filter(
        candidate__session=session_named("Spring Grading"),
    )
    assert outcomes.filter(status=CandidateOutcome.Status.PROPOSED).count() == 5
    assert outcomes.filter(status=CandidateOutcome.Status.DRAFT).count() == 2
    assert not outcomes.filter(status=CandidateOutcome.Status.FINALISED).exists()
    proposed = set(
        outcomes.filter(status=CandidateOutcome.Status.PROPOSED).values_list(
            "proposed_outcome",
            flat=True,
        ),
    )
    assert proposed == {"PASS", "FAIL", "CONDITIONAL"}


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
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
@pytest.mark.usefixtures("club")
def test_the_planned_grading_includes_a_black_belt_candidate() -> None:
    codes = set(
        GradingCandidate.objects.filter(
            session=session_named("Autumn Grading (planned)"),
        ).values_list("testing_for_rank__code", flat=True),
    )
    assert "JKN" in codes


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
def test_some_imported_history_is_linked_and_some_waits_to_be() -> None:
    assert LegacyGradingRecord.objects.count() == 8
    assert LegacyGradingRecord.objects.filter(student__isnull=False).count() == 5


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
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
@pytest.mark.usefixtures("club")
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
def test_nothing_is_built_unless_demo_mode_is_on() -> None:
    with pytest.raises(CommandError, match="KUKGRADE_DEMO_MODE"):
        seed.build()
    assert not Student.objects.exists()


@pytest.mark.django_db
@demo_mode
def test_a_database_with_real_accounts_is_never_touched() -> None:
    User.objects.create_user("real.instructor@example.com", "A-Real-Password-1!")

    with pytest.raises(CommandError, match="not the demo's own"):
        seed.build()
    with pytest.raises(CommandError, match="not the demo's own"):
        reset()

    assert not Student.objects.exists()


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_reset_leaves_the_club_alone_once_a_real_account_exists() -> None:
    seed.build()
    User.objects.create_user("real.instructor@example.com", "A-Real-Password-1!")
    students = Student.objects.count()

    with pytest.raises(CommandError):
        reset()

    assert Student.objects.count() == students


# Resetting


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_a_reset_rebuilds_the_same_club_and_keeps_the_accounts_and_catalogue() -> None:
    seed.build()
    personas = User.objects.filter(email__in=PERSONA_EMAILS)
    ids = {u.email: u.pk for u in personas}
    hashes = {u.email: u.password for u in personas}
    ranks, syllabus = Rank.objects.count(), SyllabusRequirement.objects.count()
    students = Student.objects.count()
    # A visitor's mess.
    Student.objects.filter(first_name="Leo").update(first_name="Rude word")

    reset()

    assert Student.objects.count() == students
    assert not Student.objects.filter(first_name="Rude word").exists()
    assert {u.email: u.pk for u in personas} == ids
    assert {u.email: u.password for u in personas} == hashes
    assert (Rank.objects.count(), SyllabusRequirement.objects.count()) == (
        ranks,
        syllabus,
    )
    assert Promotion.objects.count() == 14
    assert User.objects.filter(email="deleted-user@kukgrade.internal").exists()
    # Numbering starts over, so a visitor never sees a creeping id.
    assert session_named("Autumn Grading").pk == 1


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_a_signed_in_visitor_stays_signed_in_through_a_reset() -> None:
    seed.build()
    visitor = sign_in("instructor@demo.example.com")

    reset()

    assert visitor.get("/api/auth/me/").status_code == 200
    assert visitor.get("/api/students/").status_code == 200


@pytest.mark.django_db
def test_every_table_a_reset_empties_exists() -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
        )
        existing = {name for (name,) in cursor.fetchall()}
    assert set(club_tables()) <= existing
    assert {"gradings_gradingsession", "audit_auditevent", "students_student"} <= set(
        club_tables(),
    )


@pytest.mark.parametrize(
    ("now", "expected_day", "expected_hour"),
    [
        ((2027, 3, 1, 0, 0), 1, 6),
        ((2027, 3, 1, 5, 59), 1, 6),
        ((2027, 3, 1, 6, 0), 1, 12),
        ((2027, 3, 1, 23, 30), 2, 0),
    ],
)
@override_settings(DEMO_RESET_HOURS=6, TIME_ZONE="UTC")
def test_resets_fall_on_whole_multiples_of_the_interval(
    now: tuple[int, int, int, int, int],
    expected_day: int,
    expected_hour: int,
) -> None:
    following = next_reset_at(datetime(*now, tzinfo=UTC))

    assert (following.day, following.hour, following.minute) == (
        expected_day,
        expected_hour,
        0,
    )


# What visitors may and may not do


@pytest.mark.django_db
@demo_mode
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/auth/change-password/"),
        ("patch", "/api/auth/me/"),
        ("post", "/api/users/"),
        ("patch", "/api/users/00000000-0000-0000-0000-000000000000/"),
        ("patch", "/api/users/00000000-0000-0000-0000-000000000000/authority/"),
        ("post", "/api/users/00000000-0000-0000-0000-000000000000/set-password/"),
        ("post", "/api/data-imports/batches/"),
    ],
)
def test_changes_that_would_affect_other_visitors_are_closed(
    method: str,
    path: str,
) -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user("a@example.com", "x"))

    response = getattr(client, method)(path, {}, format="json")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "demo_mode"


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
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
        {"result": "MET", "assessor_notes": "Looked sharp."},
        format="json",
    )

    assert response.status_code == 200, response.content


@pytest.mark.django_db
def test_nothing_is_closed_outside_the_demo() -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user("a@example.com", "x"))

    response = client.post("/api/users/", {}, format="json")

    body: Any = response.json()
    assert body.get("error", {}).get("code") != "demo_mode"


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
def test_many_people_can_be_signed_in_to_one_account_at_once() -> None:
    visitors = [sign_in("instructor@demo.example.com") for _ in range(12)]

    assert all(v.get("/api/auth/me/").status_code == 200 for v in visitors)
    visitors[0].post("/api/auth/logout/")
    assert visitors[0].get("/api/auth/me/").status_code in (401, 403)
    assert all(v.get("/api/auth/me/").status_code == 200 for v in visitors[1:])


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
def test_each_demo_account_signs_in_with_the_published_password() -> None:
    for persona in PERSONAS:
        me = sign_in(persona.email).get("/api/auth/me/").json()
        assert me["email"] == persona.email


# What the sign-in screen is told


@pytest.mark.django_db
@pytest.mark.usefixtures("club")
def test_the_site_settings_publish_the_demo_accounts_and_next_reset() -> None:
    served = APIClient().get("/api/site/").json()["demo"]

    assert served["password"] == DEMO_PASSWORD
    assert [a["key"] for a in served["accounts"]] == [p.key for p in PERSONAS]
    assert datetime.fromisoformat(served["next_reset_at"]) > datetime.now(UTC)


@pytest.mark.django_db
def test_the_site_settings_say_nothing_of_a_demo_outside_demo_mode() -> None:
    assert "demo" not in APIClient().get("/api/site/").json()


@pytest.mark.django_db
@demo_mode
def test_the_demo_is_never_offered_first_time_setup() -> None:
    from accounts.setup import issue_setup_code

    client = APIClient()

    assert client.get("/api/setup/").json() == {"setup_needed": False}
    assert issue_setup_code() is None
    token = client.get("/api/auth/me/").cookies["csrftoken"].value
    response = client.post(
        "/api/setup/",
        {
            "code": "AAAA-AAAA-AAAA",
            "email": "x@example.com",
            "password": "Aa1!aaaaaaaaaaaa",
        },
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 400
    assert not User.objects.filter(is_superuser=True).exists()


@pytest.mark.django_db
def test_tables_are_emptied_after_everything_that_refers_to_them() -> None:
    from demo.reset import deletion_order

    order = deletion_order()

    assert sorted(order) == sorted(club_tables())
    for child, parent in [
        ("gradings_candidateoutcome", "gradings_candidateassessment"),
        ("gradings_candidateassessment", "gradings_gradingcandidate"),
        ("gradings_gradingcandidate", "gradings_gradingsession"),
        ("gradings_gradingcandidate", "students_student"),
        ("gradings_promotion", "gradings_candidateoutcome"),
    ]:
        assert order.index(child) < order.index(parent)
