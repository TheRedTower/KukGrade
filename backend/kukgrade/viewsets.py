"""What every KukGrade viewset shares: the methods it answers, who is asking,
and how a record is deleted.

The view calls the service: a request is read and checked by a serializer,
then the view hands what it says to the app's service with the acting user,
and serialises what comes back. A serializer never saves.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, ClassVar, cast

from django.db import models
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User


# The base of every viewset. (A comment, not a docstring: the schema would
# publish a docstring as the description of every endpoint of a viewset that
# has none of its own.)
#
# No PUT: an edit is a PATCH of what changes, and nothing replaces a record
# whole. Leaving 'put' out of http_method_names is what answers 405 for it -
# the router still binds PUT to an update mixin's method, and these are the
# methods dispatch checks first. A viewset that needs PUT adds it, saying why.
class KukGradeViewSet[M: models.Model](GenericViewSet[M]):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @property
    def actor(self) -> User:
        """Who is asking: the signed-in staff member every permission checked."""
        return cast(User, self.request.user)


class ServiceDestroyMixin:
    """DELETE asks the app's own delete service, with who is asking - never a
    bare instance.delete(), so the app's rules and audit event always apply.
    A viewset names its service: `delete_service = staticmethod(...)`."""

    delete_service: ClassVar[staticmethod[[Any, User], object]]

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        view = cast(KukGradeViewSet[Any], self)
        type(self).delete_service(view.get_object(), view.actor)
        return Response(status=status.HTTP_204_NO_CONTENT)


def run_bulk[R](
    request: Request,
    *,
    request_serializer: type[Any],
    result_serializer: type[Any],
    run: Callable[[dict[str, Any]], R],
) -> Response:
    """The one shape of every bulk action: the request checked as a whole,
    then the service run over its rows, each row on its own (one refusal never
    blocks the others), and what it did and refused served together."""
    payload = request_serializer(data=request.data)
    payload.is_valid(raise_exception=True)
    result = run(payload.validated_data)
    return Response(result_serializer(result, context={"request": request}).data)
