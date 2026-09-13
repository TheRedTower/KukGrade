from __future__ import annotations

from django.db.models import QuerySet
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from gradings.services import student_rank_timeline
from students.models import Student
from students.serializers import StudentRankHistorySerializer


class StudentViewSet(GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = StudentRankHistorySerializer

    def get_queryset(self) -> QuerySet[Student]:
        return Student.objects.select_related("current_rank").order_by(
            "last_name",
            "first_name",
            "wksa_id",
        )

    @action(detail=True, methods=["get"], url_path="rank-history")
    def rank_history(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        student = self.get_object()
        serializer = StudentRankHistorySerializer(student_rank_timeline(student))
        return Response(serializer.data)
