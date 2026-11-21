from __future__ import annotations

from rest_framework.routers import SimpleRouter

from gradings.views import (
    CandidateAssessmentItemViewSet,
    CandidateAssessmentViewSet,
    CandidateOutcomeViewSet,
    GradingCandidateViewSet,
    GradingSessionViewSet,
    HistoricalPersonViewSet,
    LegacyGradingRecordViewSet,
)

router = SimpleRouter()
router.register("gradings/sessions", GradingSessionViewSet, basename="grading-session")
router.register(
    "gradings/candidates",
    GradingCandidateViewSet,
    basename="grading-candidate",
)
router.register(
    "gradings/assessments",
    CandidateAssessmentViewSet,
    basename="candidate-assessment",
)
router.register(
    "gradings/assessment-items",
    CandidateAssessmentItemViewSet,
    basename="candidate-assessment-item",
)
router.register(
    "gradings/outcomes",
    CandidateOutcomeViewSet,
    basename="candidate-outcome",
)
router.register(
    "gradings/legacy-records",
    LegacyGradingRecordViewSet,
    basename="legacy-grading-record",
)
router.register(
    "gradings/legacy-people",
    HistoricalPersonViewSet,
    basename="legacy-person",
)

urlpatterns = router.urls
