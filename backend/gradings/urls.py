from __future__ import annotations

from rest_framework.routers import SimpleRouter

from gradings.views import (
    CandidateAssessmentItemViewSet,
    CandidateAssessmentViewSet,
    CandidateOutcomeViewSet,
    GradingCandidateViewSet,
    GradingSessionViewSet,
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

urlpatterns = router.urls
