from __future__ import annotations

from rest_framework.routers import SimpleRouter

from audit.views import AuditEventViewSet

router = SimpleRouter()
router.register("audit-events", AuditEventViewSet, basename="audit-event")

urlpatterns = router.urls
