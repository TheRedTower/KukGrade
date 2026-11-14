"""Every list of choices a screen offers, served once so no screen keeps its
own copy of the values or their names.

A record's own value is served beside it as `*_display`; these are for the
controls that offer the values a record may take: filters, forms and the
outcome buttons.
"""

from __future__ import annotations

from django.db import models
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import AUTHORITY_KEYS, AUTHORITY_WORDS
from data_imports.models import (
    FINISHED_IMPORT_STATUSES,
    ImportBatch,
    ImportRowOutcome,
)
from gradings.models import (
    CandidateAssessmentStatus,
    GradingCandidateStatus,
    GradingOutcome,
    GradingSessionStatus,
    ItemResult,
    WithdrawalReason,
)
from kukgrade.serializers import ChoiceSerializer
from ranks.models import Rank
from students.models import STUDENT_STATUS_MEANINGS, StudentStatus


def _of(name: str, choices: type[models.TextChoices]) -> type[ChoiceSerializer]:
    """A choice whose value is one of `choices`, so the contract types it."""
    return type(
        f"{name}ChoiceSerializer",
        (ChoiceSerializer,),
        {"value": serializers.ChoiceField(choices=choices.choices)},
    )


class StudentStatusChoiceSerializer(ChoiceSerializer):
    value = serializers.ChoiceField(choices=StudentStatus.choices)
    description = serializers.CharField(help_text="What the status means.")


class AuthorityChoiceSerializer(ChoiceSerializer):
    value = serializers.ChoiceField(choices=AUTHORITY_KEYS)
    description = serializers.CharField()


class WithdrawalReasonChoiceSerializer(ChoiceSerializer):
    value = serializers.ChoiceField(choices=WithdrawalReason.choices)
    note_required = serializers.BooleanField(
        help_text="Whether a withdrawal for this reason must say why.",
    )


class StaffRankChoiceSerializer(serializers.Serializer):
    value = serializers.IntegerField(help_text="The rank's id, as a user's `rank`.")
    # DRF lifts declared fields off the class (see ChoiceSerializer).
    label = serializers.CharField()  # type: ignore[assignment]


class ChoicesSerializer(serializers.Serializer):
    session_statuses = _of("SessionStatus", GradingSessionStatus)(many=True)
    student_statuses = StudentStatusChoiceSerializer(many=True)
    candidate_statuses = _of("CandidateStatus", GradingCandidateStatus)(many=True)
    assessment_statuses = _of("AssessmentStatus", CandidateAssessmentStatus)(
        many=True,
    )
    item_results = _of("ItemResult", ItemResult)(many=True)
    withdrawal_reasons = WithdrawalReasonChoiceSerializer(
        many=True,
        help_text="Why a candidate may be withdrawn, in the order the controls offer.",
    )
    outcomes = _of("Outcome", GradingOutcome)(
        many=True,
        help_text="The grading outcomes, in the order the outcome controls offer them.",
    )
    import_kinds = _of("ImportKind", ImportBatch.Kind)(many=True)
    finished_import_statuses = _of("ImportStatus", ImportBatch.Status)(
        many=True,
        help_text="The states an import ends in; the one open state is left out.",
    )
    import_row_outcomes = _of("ImportRowOutcome", ImportRowOutcome)(many=True)
    roles = _of("Role", User.Role)(many=True)
    authorities = AuthorityChoiceSerializer(
        many=True,
        help_text="The per-user authorities, keyed as the user record spells them.",
    )
    staff_ranks = StaffRankChoiceSerializer(
        many=True,
        help_text="The ranks an instructor's account may hold, lowest first.",
    )


def _listed(choices: type[models.TextChoices]) -> list[dict[str, str]]:
    return [{"value": value, "label": label} for value, label in choices.choices]


@extend_schema(responses=ChoicesSerializer)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def choices(_request: Request) -> Response:
    """Every list of choices the screens offer, each value with its name."""
    finished = [
        choice
        for choice in _listed(ImportBatch.Status)
        if choice["value"] in FINISHED_IMPORT_STATUSES
    ]
    return Response(
        ChoicesSerializer(
            {
                "session_statuses": _listed(GradingSessionStatus),
                "student_statuses": [
                    {**choice, "description": STUDENT_STATUS_MEANINGS[choice["value"]]}
                    for choice in _listed(StudentStatus)
                ],
                "candidate_statuses": _listed(GradingCandidateStatus),
                "assessment_statuses": _listed(CandidateAssessmentStatus),
                "item_results": _listed(ItemResult),
                "withdrawal_reasons": [
                    {
                        **choice,
                        "note_required": choice["value"] == WithdrawalReason.OTHER,
                    }
                    for choice in _listed(WithdrawalReason)
                ],
                "outcomes": _listed(GradingOutcome),
                "import_kinds": _listed(ImportBatch.Kind),
                "finished_import_statuses": finished,
                "import_row_outcomes": _listed(ImportRowOutcome),
                "roles": _listed(User.Role),
                "authorities": [
                    {"value": key, "label": label, "description": description}
                    for key, (label, description) in AUTHORITY_WORDS.items()
                ],
                "staff_ranks": [
                    {"value": rank.pk, "label": rank.name}
                    for rank in Rank.objects.staff()
                ],
            },
        ).data,
    )
