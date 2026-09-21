from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from django.contrib.auth import login, logout
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q, QuerySet
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.authentication import BaseAuthentication
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from accounts.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    SelfProfileSerializer,
    SetPasswordSerializer,
    UserAuthoritySerializer,
    UserManagementSerializer,
    UserSerializer,
)
from accounts.services import DELETED_USER_PLACEHOLDER_EMAIL, delete_platform_user
from gradings.serializers import raise_drf_validation_error


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes: Sequence[type[BaseAuthentication]] = ()
    permission_classes = [AllowAny]
    # The one view in the API that opts into ScopedRateThrottle - unlimited
    # password attempts is the risk this closes.
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses=UserSerializer)
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        login(request, serializer.validated_data["user"])
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=UserSerializer)
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)

    @extend_schema(request=SelfProfileSerializer, responses=UserSerializer)
    def patch(self, request: Request) -> Response:
        serializer = SelfProfileSerializer(
            request.user,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(UserSerializer(updated).data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    # Repeated wrong-current-password guesses should be rate-limited the
    # same as login attempts.
    throttle_scope = "password_change"

    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(
            request.user,
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet[User],
):
    """The administrator-facing users API.

    Deactivate via is_active for routine offboarding - that is reversible
    and keeps every attribution intact with no extra work. destroy() is a
    genuine hard delete, gated to accounts.delete_user (Administrator group
    only), for corruption or test-data cleanup: see
    accounts.services.delete_platform_user for how it keeps every PROTECT
    attribution foreign key satisfied by reassigning history to a
    placeholder account rather than erasing it. No PUT: partial_update
    covers every real edit.
    """

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_classes = [HasRequiredPermissions]
    serializer_class = UserManagementSerializer
    permission_map = {
        "list": ("accounts.view_user",),
        "retrieve": ("accounts.view_user",),
        "create": ("accounts.add_user",),
        "partial_update": ("accounts.change_user",),
        "destroy": ("accounts.delete_user",),
        "authority": ("accounts.change_user",),
        "set_password": ("accounts.change_user",),
    }

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        try:
            delete_platform_user(instance, cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_queryset(self) -> QuerySet[User]:
        # The "Deleted User" placeholder (see accounts.services) is internal
        # bookkeeping, not an account anyone administers - hidden from the
        # users API entirely so it can never show up in the list, be edited,
        # or be deleted itself through this endpoint.
        queryset = User.objects.exclude(email=DELETED_USER_PLACEHOLDER_EMAIL).order_by(
            "email",
        )

        role_filter = self.request.query_params.get("role")
        if role_filter in User.Role.values:
            queryset = queryset.filter(role=role_filter)
        elif role_filter:
            queryset = queryset.none()

        active_filter = self.request.query_params.get("is_active")
        if active_filter in {"true", "false"}:
            queryset = queryset.filter(is_active=active_filter == "true")
        elif active_filter:
            queryset = queryset.none()

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search),
            )

        return queryset

    @extend_schema(
        request=UserAuthoritySerializer,
        responses=UserManagementSerializer,
    )
    @action(detail=True, methods=["patch"])
    def authority(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        target = self.get_object()
        serializer = UserAuthoritySerializer(
            target,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(
            UserManagementSerializer(updated, context={"request": request}).data,
        )

    @extend_schema(request=SetPasswordSerializer, responses={204: None})
    @action(detail=True, methods=["post"], url_path="set-password")
    def set_password(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        target = self.get_object()
        serializer = SetPasswordSerializer(
            target,
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
