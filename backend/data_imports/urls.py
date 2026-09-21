from __future__ import annotations

from rest_framework.routers import SimpleRouter

from data_imports.views import ImportBatchViewSet

router = SimpleRouter()
router.register("data-imports/batches", ImportBatchViewSet, basename="import-batch")

urlpatterns = router.urls
