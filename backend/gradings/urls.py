from __future__ import annotations

from rest_framework.routers import SimpleRouter

from gradings.views import GradingCandidateViewSet, GradingSessionViewSet

router = SimpleRouter()
router.register("gradings/sessions", GradingSessionViewSet, basename="grading-session")
router.register(
    "gradings/candidates",
    GradingCandidateViewSet,
    basename="grading-candidate",
)

urlpatterns = router.urls
