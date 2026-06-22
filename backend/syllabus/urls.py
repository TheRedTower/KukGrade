from __future__ import annotations

from rest_framework.routers import SimpleRouter

from syllabus.views import SyllabusItemViewSet, SyllabusRequirementViewSet

router = SimpleRouter()
router.register("syllabus/items", SyllabusItemViewSet, basename="syllabus-item")
router.register(
    "syllabus/requirements",
    SyllabusRequirementViewSet,
    basename="syllabus-requirement",
)

urlpatterns = router.urls
