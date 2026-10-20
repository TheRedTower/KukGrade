from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from datetime import date
from typing import TypedDict

from django.db import models
from django.db.models import (
    Case,
    CharField,
    Count,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
    Value,
    When,
)

from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    LegacyGradingRecord,
    Promotion,
)
from gradings.services import unsettled_registrations
from students.models import Student
from syllabus.models import CATEGORY_ORDER


class GradingStage(models.TextChoices):
    """Where a registration that has not reached its result has got to."""

    REGISTERED = "REGISTERED", "Registered"
    BEING_ASSESSED = "BEING_ASSESSED", "Being assessed"
    ASSESSED = "ASSESSED", "Assessed"
    AWAITING_DECISION = "AWAITING_DECISION", "Awaiting final decision"
    AWAITING_PROMOTION = "AWAITING_PROMOTION", "Passed, awaiting promotion"


def _grading_stage() -> Case:
    # Latest step first. Only unsettled registrations are staged, so a
    # finalised outcome here is always a Pass not yet promoted.
    return Case(
        When(
            outcome__status=CandidateOutcome.Status.FINALISED,
            then=Value(GradingStage.AWAITING_PROMOTION),
        ),
        When(
            outcome__status=CandidateOutcome.Status.PROPOSED,
            then=Value(GradingStage.AWAITING_DECISION),
        ),
        When(
            assessment__status=CandidateAssessment.Status.COMPLETED,
            then=Value(GradingStage.ASSESSED),
        ),
        When(
            assessment__status=CandidateAssessment.Status.IN_PROGRESS,
            then=Value(GradingStage.BEING_ASSESSED),
        ),
        default=Value(GradingStage.REGISTERED),
        output_field=CharField(),
    )


def with_current_grading(students: QuerySet[Student]) -> QuerySet[Student]:
    """Annotate each student's registration that has not reached its result.

    One grading at a time means there is at most one; a double registration
    made before that rule shows the earlier grading. Each annotation is None
    for a student with none: `current_grading_session`, `_title`, `_stage`.
    """
    current = (
        unsettled_registrations()
        .filter(student=OuterRef("pk"))
        .order_by("session__grading_date", "session_id")
    )
    return students.annotate(
        current_grading_session=Subquery(current.values("session_id")[:1]),
        current_grading_title=Subquery(current.values("session__title")[:1]),
        current_grading_stage=Subquery(
            current.annotate(stage=_grading_stage()).values("stage")[:1],
        ),
    )


class OverallAssessmentSummary(TypedDict):
    total: int
    required: int
    met: int
    not_met: int
    not_assessed: int
    required_met: int
    required_not_assessed: int
    all_required_assessed: bool


class CategoryAssessmentSummary(OverallAssessmentSummary):
    category: str


class CandidateAssessmentSummary(TypedDict):
    overall: OverallAssessmentSummary
    categories: list[CategoryAssessmentSummary]


class StudentRankTimeline(TypedDict):
    promotions: list[Promotion]


class GradingHistoryItem(TypedDict):
    source: str  # "KUKGRADE" | "LEGACY"
    record_id: int
    date: date | None
    cycle_year: int | None
    cycle_month: int | None
    date_precision: str  # "DAY" | "MONTH"
    testing_for_rank_name: str | None
    source_testing_for_rank_text: str
    outcome: str | None
    attendance_status: str
    comments: str
    # Anything else a historical sheet said beside the record; blank for a
    # KukGrade grading.
    note: str


class StudentGradingHistory(TypedDict):
    items: list[GradingHistoryItem]


def student_rank_timeline(student: Student) -> StudentRankTimeline:
    promotions = list(
        Promotion.objects.filter(student=student)
        .select_related("grading_candidate__session", "from_rank", "to_rank")
        .order_by("-effective_date", "-promoted_at", "-pk"),
    )
    return {"promotions": promotions}


def unified_student_grading_history(student: Student) -> StudentGradingHistory:
    """Native finalised outcomes + linked, non-voided legacy records,
    source-labelled and date-precision-explicit.

    Deliberately separate from student_rank_timeline / `/rank-history/`,
    which stays Promotion-only (import Decision 6) - this is a read model for
    display, not a second claim about rank history. A native item's
    "current rank at the time" is not tracked as its own field anywhere in
    the native workflow (only testing_for_rank is), so it is left out here
    rather than guessed from promotion history.
    """
    dated_items: list[tuple[date, GradingHistoryItem]] = []

    finalised_outcomes = CandidateOutcome.objects.filter(
        candidate__student=student,
        status=CandidateOutcome.Status.FINALISED,
    ).select_related("candidate__session", "candidate__testing_for_rank")
    for outcome in finalised_outcomes:
        session = outcome.candidate.session
        testing_for_rank = outcome.candidate.testing_for_rank
        native_item: GradingHistoryItem = {
            "source": "KUKGRADE",
            "record_id": outcome.pk,
            "date": session.grading_date,
            "cycle_year": session.grading_date.year,
            "cycle_month": session.grading_date.month,
            "date_precision": "DAY",
            "testing_for_rank_name": testing_for_rank.name,
            "source_testing_for_rank_text": "",
            "outcome": outcome.final_outcome,
            "attendance_status": "ATTENDED",
            "comments": outcome.decision_notes,
            "note": "",
        }
        dated_items.append((session.grading_date, native_item))

    legacy_records = LegacyGradingRecord.objects.filter(
        student=student,
        is_void=False,
    ).select_related("testing_for_rank")
    for legacy in legacy_records:
        sort_date = legacy.grading_date or date(
            legacy.cycle_year,
            legacy.cycle_month,
            1,
        )
        legacy_item: GradingHistoryItem = {
            "source": "LEGACY",
            "record_id": legacy.pk,
            "date": legacy.grading_date,
            "cycle_year": legacy.cycle_year,
            "cycle_month": legacy.cycle_month,
            "date_precision": legacy.date_precision,
            "testing_for_rank_name": (
                legacy.testing_for_rank.name if legacy.testing_for_rank else None
            ),
            "source_testing_for_rank_text": legacy.source_testing_for_rank_text,
            "outcome": legacy.outcome,
            "attendance_status": legacy.attendance_status,
            "comments": legacy.comments,
            "note": legacy.admin_note,
        }
        dated_items.append((sort_date, legacy_item))

    dated_items.sort(key=lambda pair: pair[0], reverse=True)
    return {"items": [item for _sort_date, item in dated_items]}


def _summary_from_tally(tally: Mapping[str, int]) -> OverallAssessmentSummary:
    """The one place a count of items becomes a summary (FDR-046).

    Fed by the in-Python tally below and by the database annotations of
    `with_overall_counts`, so an assessment list and its summary endpoint
    cannot disagree about what "required and not assessed" means.
    """
    total = tally.get("total", 0)
    met = tally.get("met", 0)
    not_met = tally.get("not_met", 0)
    required_not_assessed = tally.get("required_not_assessed", 0)
    return {
        "total": total,
        "required": tally.get("required", 0),
        "met": met,
        "not_met": not_met,
        "not_assessed": total - met - not_met,
        "required_met": tally.get("required_met", 0),
        "required_not_assessed": required_not_assessed,
        "all_required_assessed": required_not_assessed == 0,
    }


def with_overall_counts(
    assessments: QuerySet[CandidateAssessment],
) -> QuerySet[CandidateAssessment]:
    """Annotate each assessment with the counts `assessment_overall` serves.

    A list of assessments only needs the overall counts, so they are counted
    in the database rather than by loading every item of every assessment.
    """
    result = CandidateAssessmentItem.Result
    required = Q(items__required=True)
    met = Q(items__result=result.MET)
    return assessments.annotate(
        tally_total=Count("items"),
        tally_required=Count("items", filter=required),
        tally_met=Count("items", filter=met),
        tally_not_met=Count(
            "items",
            filter=Q(items__result=CandidateAssessmentItem.Result.NOT_MET),
        ),
        tally_required_met=Count("items", filter=required & met),
        tally_required_not_assessed=Count(
            "items",
            filter=required
            & Q(items__result=CandidateAssessmentItem.Result.NOT_ASSESSED),
        ),
    )


def assessment_overall(assessment: CandidateAssessment) -> OverallAssessmentSummary:
    if hasattr(assessment, "tally_total"):
        return _summary_from_tally(
            {
                name: getattr(assessment, f"tally_{name}")
                for name in (
                    "total",
                    "required",
                    "met",
                    "not_met",
                    "required_met",
                    "required_not_assessed",
                )
            },
        )
    return candidate_assessment_summary(assessment)["overall"]


def candidate_assessment_summary(
    assessment: CandidateAssessment,
) -> CandidateAssessmentSummary:
    # Unordered, so a list view's prefetched items are used as they are; the
    # counts do not depend on order and the categories are sorted below.
    tallies: dict[str, Counter[str]] = {}
    for item in assessment.items.all():
        tally = tallies.setdefault(item.category, Counter())
        tally["total"] += 1
        tally["required"] += item.required
        if item.result == CandidateAssessmentItem.Result.MET:
            tally["met"] += 1
            tally["required_met"] += item.required
        elif item.result == CandidateAssessmentItem.Result.NOT_MET:
            tally["not_met"] += 1
        else:
            tally["required_not_assessed"] += item.required

    categories: list[CategoryAssessmentSummary] = [
        {**_summary_from_tally(tally), "category": category}
        for category, tally in tallies.items()
    ]
    return {
        "overall": _summary_from_tally(sum(tallies.values(), Counter())),
        "categories": sorted(
            categories,
            key=lambda summary: (
                CATEGORY_ORDER.get(summary["category"], len(CATEGORY_ORDER)),
                summary["category"],
            ),
        ),
    }
