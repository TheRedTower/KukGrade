from __future__ import annotations

from rest_framework.routers import SimpleRouter

from data_imports.views import ImportBatchViewSet, ImportRowViewSet

router = SimpleRouter()
router.register("data-imports/batches", ImportBatchViewSet, basename="import-batch")
# One import's rows. Named "import-batch-..." with the import, so whatever
# closes the imports by name (demo.middleware) closes its rows too.
router.register(
    r"data-imports/batches/(?P<batch_pk>[0-9]+)/rows",
    ImportRowViewSet,
    basename="import-batch-row",
)

urlpatterns = router.urls
