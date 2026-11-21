from __future__ import annotations

from rest_framework.routers import SimpleRouter

from ranks.views import RankViewSet

router = SimpleRouter()
router.register("ranks", RankViewSet, basename="rank")

urlpatterns = router.urls
