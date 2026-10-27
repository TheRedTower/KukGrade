"""Candidate assessments: generation, snapshots, lifecycle, items, summary and API."""

from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import AUTHORITY_PERMISSIONS
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import (
    delete_candidate_assessment,
    generate_candidate_assessment,
    reopen_candidate_assessment,
    update_candidate_assessment,
    update_candidate_assessment_item,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.outcome_services import promote_candidate
from gradings.read_models import candidate_assessment_summary
from gradings.services import (
    build_candidate,
    transition_grading_session,
    validate_candidate_can_be_deleted,
    validate_session_transition,
)
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    promoter,
    rank,
    start_assessment,
    student,
    user,
)
from kukgrade.testing import results
from students.models import Student
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement
from syllabus.services import effective_syllabus_requirements

pytestmark = pytest.mark.django_db


def test_assessment_covers_earlier_ranks_but_not_later_ranks_or_other_age_bands() -> (
    None
):
    built = candidate(
        student=student(date_of_birth=date(2016, 1, 1), current_rank=rank("YELLOW")),
        testing_for_rank=rank("BLUE_STRIPE"),
    )
    SyllabusRequirement.objects.create(
        rank=rank("BLUE"),
        item=SyllabusItem.objects.create(
            code="LATER_RANK_ITEM",
            name="Later Rank Item",
            category=SyllabusItem.Category.TECHNIQUE_SET,
        ),
        age_band=built.age_band,
        sequence=100,
    )
    SyllabusRequirement.objects.create(
        rank=rank("YELLOW"),
        item=SyllabusItem.objects.create(
            code="OTHER_BAND_ITEM",
            name="Other Band Item",
            category=SyllabusItem.Category.TECHNIQUE_SET,
        ),
        age_band=AgeBand.AGE_18_AND_OVER,
        sequence=100,
    )

    generated = assessment(candidate=built)

    codes = set(generated.items.values_list("item_code", flat=True))
    assert "SOHN_PPAE_KI" in codes  # introduced at Yellow Stripe
    assert "LATER_RANK_ITEM" not in codes
    assert "OTHER_BAND_ITEM" not in codes
    assert set(generated.items.values_list("source_age_band", flat=True)) == {
        built.age_band,
    }


def test_generate_candidate_assessment_creates_snapshot_items() -> None:
    built = candidate()
    generator = user("assessment-generator@example.com")
    requirements = effective_syllabus_requirements(
        rank=built.testing_for_rank,
        age_band=built.age_band,
    )

    generated = generate_candidate_assessment(built, generator)

    assert generated.candidate == built
    assert generated.generated_by == generator
    assert generated.status == CandidateAssessment.Status.NOT_STARTED
    assert generated.generated_at is not None
    assert [item.source_requirement for item in generated.items.all()] == [
        row.requirement for row in requirements
    ]
    assert [item.position for item in generated.items.all()] == list(
        range(1, len(requirements) + 1),
    )
    first_requirement = requirements[0].requirement
    first_item = generated.items.get(source_requirement=first_requirement)
    assert first_item.source_item == first_requirement.item
    assert first_item.source_rank == built.testing_for_rank
    assert first_item.source_age_band == built.age_band
    assert first_item.item_code == first_requirement.item.code
    assert first_item.item_name == first_requirement.item.name
    assert first_item.korean_name == first_requirement.item.korean_name
    assert first_item.category == first_requirement.item.category
    assert first_item.requirement_sequence == first_requirement.sequence
    assert first_item.required is first_requirement.required
    assert first_item.start_number == first_requirement.start_number
    assert first_item.end_number == first_requirement.end_number
    assert first_item.requirement_notes == first_requirement.notes


# The rank each worked-example candidate holds, and a birth date in each age
# band on the default session's grading date (2027-03-20).
RANK_BEFORE = {"BLUE_STRIPE": "YELLOW", "JKN": "DAHN_BO"}
BORN_IN_BAND: dict[str, date] = {
    AgeBand.AGE_8_AND_UNDER: date(2020, 1, 1),
    AgeBand.AGE_9_TO_12: date(2016, 1, 1),
    AgeBand.AGE_13_TO_17: date(2012, 1, 1),
    AgeBand.AGE_18_AND_OVER: date(1990, 1, 1),
}


@pytest.mark.parametrize("testing_for", ["BLUE_STRIPE", "JKN"])
@pytest.mark.parametrize("age_band", AgeBand.values)
def test_assessment_snapshots_the_cumulative_syllabus_the_browser_serves(
    testing_for: str,
    age_band: str,
) -> None:
    # One resolver behind both: what the syllabus screen lists for a
    # rank and age band is exactly what a grading for them assesses, in the
    # same order. syllabus/tests.py pins that content for these cases.
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[age_band],
            current_rank=rank(RANK_BEFORE[testing_for]),
        ),
        testing_for_rank=rank(testing_for),
    )
    assert built.age_band == age_band

    generated = assessment(candidate=built)
    served = auth_client(f"browser-{testing_for}-{age_band}@example.com").get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": testing_for, "age_band": age_band, "page_size": "200"},
    )

    assert [
        (
            item.position,
            item.category,
            item.item_code,
            item.display_range,
            item.requirement_notes,
            item.required,
        )
        for item in generated.items.all()
    ] == [
        (
            position,
            row["category"],
            row["item_code"],
            row["display_range"],
            row["notes"],
            row["required"],
        )
        for position, row in enumerate(results(served), start=1)
    ]


def test_assessment_item_extended_at_an_earlier_rank_records_that_rank() -> None:
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("YELLOW"),
        ),
        testing_for_rank=rank("BLUE_STRIPE"),
    )

    generated = assessment(candidate=built)

    # Ki Bohn Soo was introduced at Yellow Stripe and extended to 1-15 at
    # Yellow; a Blue Stripe grading still assesses all fifteen.
    ki_bohn_soo = generated.items.get(item_code="KI_BOHN_SOO")
    assert ki_bohn_soo.source_rank == rank("YELLOW")
    assert ki_bohn_soo.source_requirement == SyllabusRequirement.objects.get(
        rank__code="YELLOW",
        age_band=AgeBand.AGE_18_AND_OVER,
        item__code="KI_BOHN_SOO",
    )
    assert ki_bohn_soo.display_range == "1-15"
    assert ki_bohn_soo.required is True


def test_generate_candidate_assessment_retains_optional_requirements() -> None:
    built = candidate()
    optional_item = SyllabusItem.objects.create(
        code="OPTIONAL_ASSESSMENT_ITEM",
        name="Optional Assessment Item",
        category=SyllabusItem.Category.OTHER,
    )
    optional_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=999,
        notes="May be assessed if time allows.",
    )

    generated = assessment(candidate=built)

    snapshot = generated.items.get(source_requirement=optional_requirement)
    assert snapshot.required is False
    assert snapshot.requirement_notes == "May be assessed if time allows."


def test_generate_candidate_assessment_excludes_inactive_requirements_and_items() -> (
    None
):
    built = candidate()
    inactive_item = SyllabusItem.objects.create(
        code="INACTIVE_ASSESSMENT_ITEM",
        name="Inactive Assessment Item",
        category=SyllabusItem.Category.OTHER,
        active=False,
    )
    inactive_requirement_item = SyllabusItem.objects.create(
        code="INACTIVE_REQUIREMENT_ITEM",
        name="Inactive Requirement Item",
        category=SyllabusItem.Category.OTHER,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=inactive_item,
        age_band=built.age_band,
        sequence=990,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=inactive_requirement_item,
        age_band=built.age_band,
        sequence=991,
        active=False,
    )

    generated = assessment(candidate=built)

    assert not generated.items.filter(
        item_code__in=["INACTIVE_ASSESSMENT_ITEM", "INACTIVE_REQUIREMENT_ITEM"],
    ).exists()


def test_generate_candidate_assessment_refuses_a_rank_with_no_recorded_syllabus() -> (
    None
):
    # Everything through JKN is recorded, but nothing for KSN itself: that is
    # not KSN's syllabus, so no assessment is generated from it.
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("JKN"),
        ),
        testing_for_rank=rank("KSN"),
    )

    with pytest.raises(ValidationError) as exc_info:
        assessment(candidate=built)

    assert exc_info.value.message_dict["candidate"] == [
        "No syllabus is recorded for KSN (18+), so this candidate cannot be "
        "assessed yet.",
    ]
    assert not CandidateAssessment.objects.filter(candidate=built).exists()


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_generate_candidate_assessment_rejected_for_closed_session_states(
    session_status: str,
) -> None:
    built = candidate()
    GradingSession.objects.filter(pk=built.session_id).update(status=session_status)
    built.session.refresh_from_db()

    with pytest.raises(ValidationError):
        assessment(candidate=built)


def test_generate_candidate_assessment_rejects_duplicate_generation() -> None:
    built = candidate()
    assessment(candidate=built)

    with pytest.raises(ValidationError):
        assessment(candidate=built)


def test_duplicate_assessment_is_prevented_at_database_level() -> None:
    built = candidate()
    generator = user("db-duplicate-generator@example.com")
    CandidateAssessment.objects.create(candidate=built, generated_by=generator)

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessment.objects.bulk_create(
            [CandidateAssessment(candidate=built, generated_by=generator)],
        )


def test_generation_is_atomic_if_item_creation_fails() -> None:
    built = candidate()
    requirement = effective_syllabus_requirements(
        rank=built.testing_for_rank,
        age_band=built.age_band,
    )[0]

    # The same requirement twice breaks the item snapshot's own uniqueness: a
    # defect in the data, not a second assessment. It surfaces as the
    # integrity error it is rather than as "already has an assessment",
    # and takes the half-built assessment with it.
    with (
        patch(
            "gradings.assessment_services.effective_syllabus_requirements",
            return_value=[requirement, requirement],
        ),
        pytest.raises(IntegrityError),
        transaction.atomic(),
    ):
        generate_candidate_assessment(built, user("snapshot-defect@example.com"))

    assert not CandidateAssessment.objects.filter(candidate=built).exists()


def test_assessment_snapshot_survives_live_syllabus_edits() -> None:
    generated = assessment()
    snapshot = generated.items.select_related(
        "source_requirement", "source_item"
    ).first()
    assert snapshot is not None
    source_requirement = snapshot.source_requirement
    source_item = snapshot.source_item
    assert source_requirement is not None
    assert source_item is not None

    original_name = snapshot.item_name
    original_start = snapshot.start_number
    original_end = snapshot.end_number
    source_item.name = "Changed Live Item Name"
    source_item.save()
    source_requirement.start_number = 99
    source_requirement.end_number = 100
    source_requirement.notes = "Changed live notes"
    source_requirement.save()

    snapshot.refresh_from_db()
    assert snapshot.item_name == original_name
    assert snapshot.start_number == original_start
    assert snapshot.end_number == original_end
    assert snapshot.requirement_notes != "Changed live notes"


def test_snapshot_keeps_the_cumulative_parts_of_a_form_taught_in_parts() -> None:
    # 8-and-under Cho Geup Hyung: part 1 at Blue, 2 at Red stripe, 3 at Red.
    # A Red grading assesses all three, and the record keeps that wording
    # whatever later happens to the syllabus (audit F-09).
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_8_AND_UNDER],
            current_rank=rank("RED_STRIPE"),
        ),
        testing_for_rank=rank("RED"),
    )
    generated = assessment(candidate=built)

    snapshot = generated.items.get(item_code="CHO_GEUP_HYUNG")
    assert snapshot.notation == "Parts 1-3"
    assert snapshot.requirement_notes == "Chart notation: (pt.3)."

    source = snapshot.source_requirement
    assert source is not None
    source.notes = "Chart notation: (pt.4)."
    source.save()

    snapshot.refresh_from_db()
    assert snapshot.notation == "Parts 1-3"


def test_deleting_source_requirement_and_item_preserves_snapshot_display_data() -> None:
    built = candidate()
    source_item = SyllabusItem.objects.create(
        code="DELETABLE_SOURCE_ITEM",
        name="Deletable Source Item",
        category=SyllabusItem.Category.OTHER,
    )
    source_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=source_item,
        age_band=built.age_band,
        sequence=997,
    )
    generated = assessment(candidate=built)
    snapshot = generated.items.select_related("source_requirement", "source_item").get(
        source_requirement=source_requirement
    )
    assert snapshot is not None
    item_name = snapshot.item_name
    item_code = snapshot.item_code

    source_requirement.delete()
    source_item.delete()

    snapshot.refresh_from_db()
    assert snapshot.source_requirement is None
    assert snapshot.source_item is None
    assert snapshot.item_name == item_name
    assert snapshot.item_code == item_code


def test_assessment_lifecycle_requires_start_before_completion() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(
            generated,
            status=CandidateAssessment.Status.COMPLETED,
        )

    started = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )

    assert started.status == CandidateAssessment.Status.IN_PROGRESS
    assert started.started_at is not None


def test_not_started_assessment_cannot_begin_in_locked_session() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment(
            generated,
            status=CandidateAssessment.Status.IN_PROGRESS,
        )

    assert "open sessions" in str(exc_info.value)
    generated.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_assessment_completion_requires_required_items_and_completes_candidate() -> (
    None
):
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(
            generated, status=CandidateAssessment.Status.COMPLETED
        )

    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    built.refresh_from_db()
    assert completed.status == CandidateAssessment.Status.COMPLETED
    assert completed.completed_at is not None
    assert built.status == GradingCandidate.Status.COMPLETED


def test_optional_not_assessed_items_do_not_block_completion() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    optional_item = SyllabusItem.objects.create(
        code="OPTIONAL_COMPLETION_ITEM",
        name="Optional Completion Item",
        category=SyllabusItem.Category.OTHER,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=998,
    )
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )
    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )

    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    assert completed.status == CandidateAssessment.Status.COMPLETED
    assert generated.items.get(item_code="OPTIONAL_COMPLETION_ITEM").result == (
        CandidateAssessmentItem.Result.NOT_ASSESSED
    )


def test_completed_assessment_is_immutable() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )
    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(completed, notes="Too late")
    completed_item = completed.items.first()
    assert completed_item is not None
    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            completed_item,
            result=CandidateAssessmentItem.Result.NOT_MET,
            assessor=user("too-late-assessor@example.com"),
        )


def test_assessment_item_result_updates_set_and_clear_assessor_metadata() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    item = generated.items.first()
    assert item is not None
    assessor = user("item-assessor@example.com")

    updated = update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor_notes="Strong basics",
        assessor=assessor,
    )

    assert updated.result == CandidateAssessmentItem.Result.MET
    assert updated.assessor == assessor
    assert updated.assessed_at is not None
    assert updated.assessor_notes == "Strong basics"
    updated.assessment.refresh_from_db()
    assert updated.assessment.status == CandidateAssessment.Status.IN_PROGRESS

    reset = update_candidate_assessment_item(
        updated,
        result=CandidateAssessmentItem.Result.NOT_ASSESSED,
        assessor=assessor,
    )

    assert reset.assessor is None
    assert reset.assessed_at is None


def test_assessment_item_update_rejected_until_assessment_is_started() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor_notes="Should not save",
            assessor=user("not-started-assessor@example.com"),
        )

    item.refresh_from_db()
    generated.refresh_from_db()
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED
    assert item.assessor is None
    assert item.assessed_at is None
    assert item.assessor_notes == ""
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_not_started_assessment_item_update_rejected_in_locked_session() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )
    session.refresh_from_db()
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("locked-not-started-assessor@example.com"),
        )

    generated.refresh_from_db()
    item.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.NOT_STARTED
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED


def test_a_completed_assessment_can_be_reopened_while_the_session_is_open() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    item = generated.items.first()
    assert item is not None
    recorded = (item.result, item.assessor_id, item.assessed_at)

    response = auth_client("reopen-instructor@example.com").post(
        f"/api/gradings/assessments/{generated.pk}/reopen/",
    )

    assert response.status_code == 200
    assert response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS
    generated.refresh_from_db()
    built.refresh_from_db()
    item.refresh_from_db()
    assert generated.completed_at is None
    assert built.status == GradingCandidate.Status.REGISTERED
    assert (item.result, item.assessor_id, item.assessed_at) == recorded
    assert AuditEvent.objects.filter(
        action=AuditAction.ASSESSMENT_REOPENED,
        entity_id=str(generated.pk),
    ).exists()


def test_reopening_is_refused_once_the_session_locks_or_before_completion() -> None:
    locked_built, locked_generated = locked_completed_candidate()
    open_session = grading_session(status=GradingSession.Status.OPEN)
    in_progress = assessment(candidate=candidate(session=open_session))
    start_assessment(in_progress)
    actor = user("reopen-refused@example.com")

    with pytest.raises(ValidationError) as locked_exc:
        reopen_candidate_assessment(locked_generated, actor)
    with pytest.raises(ValidationError) as in_progress_exc:
        reopen_candidate_assessment(in_progress, actor)

    assert "session is open" in str(locked_exc.value)
    assert "Only a completed assessment" in str(in_progress_exc.value)
    locked_generated.refresh_from_db()
    assert locked_generated.status == CandidateAssessment.Status.COMPLETED


def test_reopen_requires_the_change_assessment_permission() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN)),
    )
    bare = user("no-perms@example.com")
    bare.groups.clear()
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=bare.pk))

    response = client.post(f"/api/gradings/assessments/{generated.pk}/reopen/")

    assert response.status_code == 403


def test_the_model_refuses_a_candidate_created_in_any_status_but_registered() -> None:
    # Admin and the shell reach the model directly, not the serializer.
    built = build_candidate(
        session=grading_session(),
        student=student(wksa_id="206-2-500"),
        testing_for_rank=rank("YELLOW_STRIPE"),
    )
    built.status = GradingCandidate.Status.COMPLETED

    with pytest.raises(ValidationError) as exc_info:
        built.save()

    assert "status" in exc_info.value.message_dict


def test_item_results_cannot_change_once_the_session_locks() -> None:
    # Unreachable through the services, since a session cannot lock with an
    # assessment in progress - forced here so the guard itself is proven.
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    start_assessment(generated)
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("locked-in-progress-assessor@example.com"),
        )

    assert "open session" in str(exc_info.value)


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_assessment_item_update_rejected_in_terminal_sessions(
    session_status: str,
) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    GradingSession.objects.filter(pk=session.pk).update(status=session_status)
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user(f"terminal-{session_status.lower()}@example.com"),
        )

    item.refresh_from_db()
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED


def test_assessment_item_result_update_rejected_in_draft_session() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.DRAFT))
    )
    generated.status = CandidateAssessment.Status.IN_PROGRESS
    generated.started_at = timezone.now()
    generated.save()
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("draft-result@example.com"),
        )


def test_candidate_core_fields_cannot_change_after_assessment_generation() -> None:
    generated = assessment()
    built = generated.candidate
    built.student = student(wksa_id="206-2-501")

    with pytest.raises(ValidationError):
        built.save()


def test_candidate_deletion_allowed_only_for_draft_unstarted_assessment() -> None:
    draft_candidate = candidate(
        session=grading_session(status=GradingSession.Status.DRAFT)
    )
    assessment(candidate=draft_candidate)
    draft_candidate.delete()
    assert not GradingCandidate.objects.filter(pk=draft_candidate.pk).exists()

    open_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN)
    )
    open_assessment = assessment(candidate=open_candidate)
    update_candidate_assessment(
        open_assessment,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )

    with pytest.raises(ValidationError):
        validate_candidate_can_be_deleted(open_candidate)


def test_session_lock_and_completion_require_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)

    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    generated = assessment(candidate=built)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    start_assessment(generated)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    complete_assessment(generated)
    session = transition_grading_session(session, GradingSession.Status.LOCKED)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.LOCKED,
            GradingSession.Status.COMPLETED,
            session=session,
        )
    finalised_outcome(built)
    validate_session_transition(
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        session=session,
    )


def test_withdrawn_candidates_do_not_block_session_completion() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    validate_session_transition(
        GradingSession.Status.OPEN,
        GradingSession.Status.LOCKED,
        session=session,
    )
    session = transition_grading_session(session, GradingSession.Status.LOCKED)
    validate_session_transition(
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        session=session,
    )


def test_direct_candidate_completed_spoofing_rejected_through_api() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("candidate-complete-spoof@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-update-status/",
        {"candidates": [built.id], "status": GradingCandidate.Status.COMPLETED},
        format="json",
    )

    assert response.status_code == 200
    assert list(response.json()["errors"]) == ["0"]
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED


def test_assessment_api_generation_lists_and_filters() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    client = auth_client("assessment-api@example.com")

    unauthenticated = APIClient().post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )
    generate_response = client.post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )
    duplicate_response = client.post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )

    assert unauthenticated.status_code == 403
    assert generate_response.status_code == 201
    assert duplicate_response.status_code == 400
    payload = generate_response.json()
    assert payload["candidate"] == built.id
    assert CandidateAssessmentItem.objects.filter(
        assessment_id=payload["id"],
    ).exists()
    assert "outcome" not in payload

    list_response = client.get(
        "/api/gradings/assessments/"
        f"?candidate={built.id}&session={session.id}"
        "&status=NOT_STARTED",
    )
    post_response = client.post("/api/gradings/assessments/", {}, format="json")

    assert list_response.status_code == 200
    assert [item["id"] for item in results(list_response)] == [payload["id"]]
    assert post_response.status_code == 405


def test_assessment_summary_is_served_while_the_assessment_is_in_progress() -> None:
    # The whole point of this endpoint: the outcome route is unreachable here,
    # because a CandidateOutcome needs a LOCKED session and a COMPLETED
    # assessment.
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(
        candidate=built,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    items = list(generated.items.order_by("pk"))
    assert len(items) >= 2
    scored_at = timezone.now()
    assessor = user("assessment-summary-assessor@example.com")
    items[0].result = CandidateAssessmentItem.Result.MET
    items[0].assessor = assessor
    items[0].assessed_at = scored_at
    items[0].save()
    items[1].result = CandidateAssessmentItem.Result.NOT_MET
    items[1].assessor = assessor
    items[1].assessed_at = scored_at
    items[1].save()

    client = auth_client("assessment-summary@example.com")

    response = client.get(f"/api/gradings/assessments/{generated.id}/summary/")

    assert response.status_code == 200
    payload = response.json()
    assert payload == candidate_assessment_summary(generated)
    assert payload["overall"]["met"] == 1
    assert payload["overall"]["not_met"] == 1
    assert payload["overall"]["required_not_assessed"] == (
        generated.items.filter(
            required=True,
            result=CandidateAssessmentItem.Result.NOT_ASSESSED,
        ).count()
    )
    assert {category["category"] for category in payload["categories"]} == {
        item.category for item in generated.items.all()
    }


def test_assessment_list_serves_each_assessments_overall_counts() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(
        candidate=candidate(session=session),
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    first = generated.items.order_by("pk").first()
    assert first is not None
    first.result = CandidateAssessmentItem.Result.NOT_MET
    first.assessor = user("assessment-list-assessor@example.com")
    first.assessed_at = timezone.now()
    first.save()
    client = auth_client("assessment-list-counts@example.com")

    response = client.get(f"/api/gradings/assessments/?session={session.id}")

    assert response.status_code == 200
    [served] = results(response)
    assert served["overall"] == candidate_assessment_summary(generated)["overall"]
    assert served["overall"]["not_met"] == 1


def test_assessment_list_query_count_does_not_grow_with_the_cohort() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    assessment(candidate=candidate(session=session))
    client = auth_client("assessment-list-queries@example.com")
    url = f"/api/gradings/assessments/?session={session.id}"
    client.get(url)

    with CaptureQueriesContext(connection) as one:
        client.get(url)
    for _ in range(3):
        assessment(candidate=candidate(session=session))
    with CaptureQueriesContext(connection) as four:
        response = client.get(url)

    assert len(results(response)) == 4
    assert len(four.captured_queries) == len(one.captured_queries)


def test_assessment_list_counts_in_the_database_and_agrees_with_the_summary() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    marked = assessment(candidate=candidate(session=session))
    untouched = assessment(candidate=candidate(session=session))
    marker = user("assessment-list-marker@example.com")
    optional = list(marked.items.order_by("pk").values_list("pk", flat=True))[::4]
    marked.items.filter(pk__in=optional).update(required=False)
    everything = list(marked.items.order_by("pk"))
    # Required and optional items, each met, not met and left unassessed.
    for position, item in enumerate(everything):
        item.result = (
            CandidateAssessmentItem.Result.MET,
            CandidateAssessmentItem.Result.NOT_MET,
            CandidateAssessmentItem.Result.NOT_ASSESSED,
        )[position % 3]
        if item.result != CandidateAssessmentItem.Result.NOT_ASSESSED:
            item.assessor = marker
            item.assessed_at = timezone.now()
        item.save()
    assert {item.required for item in everything} == {True, False}
    client = auth_client("assessment-list-agreement@example.com")
    url = f"/api/gradings/assessments/?session={session.id}"
    client.get(url)

    with CaptureQueriesContext(connection) as listing:
        response = client.get(url)
    listed = [query["sql"] for query in listing.captured_queries]

    served = {row["id"]: row["overall"] for row in results(response)}
    for built in (marked, untouched):
        summary = client.get(f"/api/gradings/assessments/{built.id}/summary/")
        assert served[built.id] == summary.json()["overall"]
    assert served[marked.id]["not_assessed"] > 0 < served[marked.id]["not_met"]
    # Counted by the database: no query reads the items themselves.
    assert not any(
        'FROM "gradings_candidateassessmentitem"' in sql and "COUNT(" not in sql
        for sql in listed
    )


def test_assessment_summary_requires_the_view_permission() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = APIClient()

    response = client.get(f"/api/gradings/assessments/{generated.id}/summary/")

    assert response.status_code == 403


def test_assessment_summary_rejects_a_write() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = auth_client("assessment-summary-readonly@example.com")

    response = client.post(
        f"/api/gradings/assessments/{generated.id}/summary/",
        {},
        format="json",
    )

    assert response.status_code == 405


def test_assessment_delete_requires_the_cleanup_permission() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = auth_client("assessment-delete-forbidden@example.com")

    response = client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert response.status_code == 403
    assert CandidateAssessment.objects.filter(pk=generated.pk).exists()


def test_only_an_administrator_can_delete_an_assessment_after_lock() -> None:
    # Kept for emergencies (2026-10-18 owner decision), and only for
    # administrators: Master authority over the session is not enough.
    _, generated = locked_completed_candidate()
    master_instructor = user("locked-delete-master@example.com")
    for permission in AUTHORITY_PERMISSIONS.values():
        grant_permission(master_instructor, permission)
    instructor_client = APIClient()
    instructor_client.force_authenticate(user=master_instructor)

    refused = instructor_client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert refused.status_code == 403
    assert CandidateAssessment.objects.filter(pk=generated.pk).exists()

    admin = User.objects.create_user(
        email="locked-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(user=admin)

    allowed = admin_client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert allowed.status_code == 204
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()


def test_administrator_can_delete_a_not_started_assessment() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    admin = User.objects.create_user(
        email="assessment-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=admin)

    response = client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert response.status_code == 204
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()


def test_deleting_completed_assessment_cascades_and_reverts_rank() -> None:
    built, generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("assessment-cascade-delete@example.com")
    promotion = promote_candidate(outcome, actor)
    student = built.student
    student.refresh_from_db()
    assert student.current_rank == promotion.to_rank

    admin = User.objects.create_user(
        email="assessment-cascade-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    events_before = AuditEvent.objects.count()

    delete_candidate_assessment(generated, admin)

    student.refresh_from_db()
    assert student.current_rank == promotion.from_rank
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert not Promotion.objects.filter(pk=promotion.pk).exists()
    cascade_event = AuditEvent.objects.filter(
        entity_type="CandidateAssessment",
        entity_id=str(generated.pk),
        action=AuditAction.ASSESSMENT_DELETED,
    ).get()
    assert cascade_event.metadata["had_outcome"] is True
    assert cascade_event.metadata["had_promotion"] is True
    assert cascade_event.metadata["reverted_student_rank"] == {
        "from": promotion.to_rank.code,
        "to": promotion.from_rank.code,
    }
    assert AuditEvent.objects.count() == events_before + 1


def test_deleting_a_completed_assessment_registers_its_candidate_again() -> None:
    from gradings.assessment_services import generate_candidate_assessment

    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    admin = User.objects.create_user(
        email="assessment-redo-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    delete_candidate_assessment(generated, admin)

    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED
    regenerated = generate_candidate_assessment(built, admin)
    assert regenerated.status == CandidateAssessment.Status.NOT_STARTED


def test_deleting_an_assessment_after_lock_leaves_a_withdrawable_candidate() -> None:
    from gradings.services import withdraw_locked_candidate
    from gradings.testing import override_master

    built, generated = locked_completed_candidate()
    admin = User.objects.create_user(
        email="assessment-locked-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    delete_candidate_assessment(generated, admin)

    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED
    withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note="Assessment deleted as test data.",
        actor=override_master("locked-delete-withdrawer@example.com"),
    )
    session = transition_grading_session(built.session, GradingSession.Status.COMPLETED)
    assert session.status == GradingSession.Status.COMPLETED


def test_deleting_an_assessment_is_refused_when_a_later_promotion_exists() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("assessment-delete-later-promotion@example.com")
    promotion = promote_candidate(outcome, actor)

    # The student has since been promoted again through a second grading -
    # this promotion is no longer "the" record of the student's rank, so
    # reverting it would silently corrupt the student's current rank.
    student = built.student
    student.refresh_from_db()
    Student.objects.filter(pk=student.pk).update(current_rank=rank("YELLOW"))

    admin = User.objects.create_user(
        email="assessment-delete-later-promotion-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    with pytest.raises(ValidationError):
        delete_candidate_assessment(outcome.assessment, admin)

    assert Promotion.objects.filter(pk=promotion.pk).exists()


def test_assessment_api_lifecycle_patch_uses_service_rules() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    client = auth_client("assessment-lifecycle-api@example.com")

    invalid_response = client.patch(
        f"/api/gradings/assessments/{generated.id}/",
        {"status": CandidateAssessment.Status.COMPLETED},
        format="json",
    )
    start_response = client.patch(
        f"/api/gradings/assessments/{generated.id}/",
        {"status": CandidateAssessment.Status.IN_PROGRESS, "notes": "Started"},
        format="json",
    )

    assert invalid_response.status_code == 400
    assert start_response.status_code == 200
    assert start_response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS
    assert start_response.json()["notes"] == "Started"


def test_assessment_item_api_allows_only_result_fields_and_filters() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    item = generated.items.first()
    assert item is not None
    original_name = item.item_name
    spoofed_assessor = user("spoofed-assessor@example.com")
    real_assessor = user("real-assessor@example.com")
    client = APIClient()
    client.force_authenticate(user=real_assessor)

    patch_response = client.patch(
        f"/api/gradings/assessment-items/{item.id}/",
        {
            "result": CandidateAssessmentItem.Result.NOT_MET,
            "assessor_notes": "Needs work",
            "item_name": "Client changed name",
            "assessor": spoofed_assessor.id,
            "assessed_at": "2030-01-01T00:00:00Z",
        },
        format="json",
    )
    item.refresh_from_db()
    list_response = client.get(
        f"/api/gradings/assessment-items/?assessment={generated.id}",
    )
    post_response = client.post("/api/gradings/assessment-items/", {}, format="json")
    delete_response = client.delete(f"/api/gradings/assessment-items/{item.id}/")

    assert patch_response.status_code == 200
    assert item.item_name == original_name
    assert item.result == CandidateAssessmentItem.Result.NOT_MET
    assert item.assessor == real_assessor
    assert item.assessed_at is not None
    assert item.assessor_notes == "Needs work"
    assert item.id in [payload["id"] for payload in results(list_response)]
    assert post_response.status_code == 405
    assert delete_response.status_code == 405


def test_assessment_item_api_serves_chart_notation_as_display_wording() -> None:
    # The scoring and completion screens show the same wording the syllabus
    # does, from the snapshot - never the raw "Chart notation: (...)." seed.
    built = candidate()
    for code, notes in (
        ("PART_NOTATION_ITEM", "Chart notation: (1/2)."),
        ("PLAIN_NOTE_ITEM", "May be assessed if time allows."),
    ):
        SyllabusRequirement.objects.create(
            rank=built.testing_for_rank,
            item=SyllabusItem.objects.create(
                code=code,
                name=code.title(),
                category=SyllabusItem.Category.OTHER,
            ),
            age_band=built.age_band,
            sequence=999,
            notes=notes,
        )
    generated = assessment(candidate=built)

    response = auth_client("notation@example.com").get(
        "/api/gradings/assessment-items/",
        {"assessment": generated.id, "page_size": 200},
    )

    assert response.status_code == 200
    by_name = {row["item_name"]: row for row in results(response)}
    part = by_name["Part_Notation_Item"]
    assert part["notation"] == "Part 1 of 2"
    assert part["requirement_notes"] == "Chart notation: (1/2)."
    plain = by_name["Plain_Note_Item"]
    assert plain["notation"] == ""
    assert plain["requirement_notes"] == "May be assessed if time allows."


def test_assessment_item_api_lists_items_in_syllabus_order() -> None:
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("DAHN_BO"),
        ),
        testing_for_rank=rank("JKN"),
    )
    generated = assessment(candidate=built)

    response = auth_client("syllabus-order@example.com").get(
        "/api/gradings/assessment-items/",
        {"assessment": generated.id, "page_size": 200},
    )

    assert response.status_code == 200
    rows = results(response)
    assert [row["position"] for row in rows] == list(range(1, len(rows) + 1))
    assert "requirement_sequence" not in rows[0]
    # Core areas first and weapons last, as the chart runs; within a category
    # items keep the order they were introduced in, not alphabetical order.
    assert [row["category"] for row in rows[:6]] == [
        "ETIQUETTE",
        "FUNDAMENTALS",
        "HAND_TECHNIQUES",
        "KICKING",
        "FALLING",
        "BREAKING",
    ]
    # The six core areas are flagged as such; rank content is not (F-31).
    assert all(row["category_is_core"] for row in rows[:6])
    assert not any(row["category_is_core"] for row in rows[6:])
    assert [row["item_name"] for row in rows if row["category"] == "WEAPONS"] == [
        "Sword Techs",
        "Bohng Dol-li-ki",
    ]
    assert rows[-1]["category"] == "WEAPONS"
    techniques = [
        row["item_name"] for row in rows if row["category"] == "TECHNIQUE_SET"
    ]
    assert techniques[:3] == ["Sohn Ppae Ki", "Ki Bohn Soo", "Sohn Mohk Soo"]
    assert techniques[-2:] == ["Mohk Joh Leu Ki", "Bahng Too Ki"]


def test_notes_only_item_change_is_recorded() -> None:
    # Previously only a result change recorded anything, so the written
    # judgement about a candidate - the part a dispute would turn on -
    # could be silently rewritten with no trace.
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    assessor = user("notes-only-assessor@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()

    updated = update_candidate_assessment_item(
        item,
        assessor_notes="Clean technique on the first attempt.",
        assessor=assessor,
    )

    after = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
    assert after == before + 1
    event = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
        entity_id=str(updated.pk),
    ).latest("occurred_at")
    assert event.metadata["before"]["assessor_notes"] == ""
    assert (
        event.metadata["after"]["assessor_notes"]
        == "Clean technique on the first attempt."
    )
    assert event.actor == assessor


def test_repeating_the_same_item_notes_records_nothing() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    update_candidate_assessment_item(
        item,
        assessor_notes="Already recorded.",
        assessor=user("repeat-notes-assessor@example.com"),
    )
    before = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
    stamp = CandidateAssessmentItem.objects.get(pk=item.pk).updated_at

    # The model strips notes, so surrounding whitespace is not a change.
    for repeat in ("Already recorded.", " Already recorded.  "):
        update_candidate_assessment_item(
            item,
            assessor_notes=repeat,
            assessor=user(f"repeat-notes-assessor-{len(repeat)}@example.com"),
        )

    after = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
    assert after == before
    assert CandidateAssessmentItem.objects.get(pk=item.pk).updated_at == stamp


def test_editing_assessment_notes_is_audited_with_both_versions() -> None:
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN),
            ),
        ),
    )
    actor = user("assessment-notes-editor@example.com")

    update_candidate_assessment(generated, notes="Strong stances", actor=actor)
    update_candidate_assessment(generated, notes=" Strong stances ", actor=actor)

    [event] = AuditEvent.objects.filter(action=AuditAction.ASSESSMENT_UPDATED)
    assert event.actor == actor
    assert event.metadata == {
        "before": {"notes": ""},
        "after": {"notes": "Strong stances"},
    }


def test_assessment_list_filters_by_one_or_several_statuses() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    untouched = assessment(candidate=candidate(session=session))
    working = start_assessment(assessment(candidate=candidate(session=session)))
    done = complete_assessment(assessment(candidate=candidate(session=session)))
    client = auth_client("assessment-status-filter@example.com")
    base = f"/api/gradings/assessments/?session={session.pk}"

    def ids(query: str) -> set[int]:
        response = client.get(f"{base}{query}")
        assert response.status_code == 200
        return {row["id"] for row in results(response)}

    assert ids("&status=COMPLETED") == {done.pk}
    assert ids("&status=COMPLETED,IN_PROGRESS") == {done.pk, working.pk}
    assert ids("&status=COMPLETED,NOPE") == set()
    assert ids("") == {untouched.pk, working.pk, done.pk}
