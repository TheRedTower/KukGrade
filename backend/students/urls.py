from __future__ import annotations

from rest_framework.routers import SimpleRouter

from students.views import StudentViewSet

router = SimpleRouter()
router.register("students", StudentViewSet, basename="student")

urlpatterns = router.urls
