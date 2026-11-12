"""The shared view machinery holds everywhere (kukgrade.viewsets,
kukgrade.serializers.ModelSerializer): a serializer never saves, every
viewset is a KukGradeViewSet, and PUT is answered only where a viewset says
why it needs it."""

from __future__ import annotations

from collections.abc import Iterator

from django.apps import apps
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework import serializers
from rest_framework.viewsets import ViewSetMixin

from gradings.views import CandidateOutcomeViewSet
from kukgrade.serializers import ModelSerializer
from kukgrade.viewsets import KukGradeViewSet

# The viewsets that answer PUT, each saying why beside its http_method_names.
ANSWER_PUT = {CandidateOutcomeViewSet}

PROJECT_APPS = {
    config.name
    for config in apps.get_app_configs()
    if not config.name.startswith(("django.", "rest_framework", "drf_spectacular"))
}


def _project_classes(base: type) -> list[type]:
    # Resolving the URLs imports every app's views, and so its serializers.
    assert get_resolver().url_patterns
    seen: list[type] = []
    pending: list[type] = list(base.__subclasses__())
    while pending:
        cls = pending.pop()
        pending.extend(cls.__subclasses__())
        if cls.__module__.split(".")[0] in PROJECT_APPS and cls not in seen:
            seen.append(cls)
    return seen


def test_no_serializer_saves() -> None:
    assert len(_project_classes(serializers.BaseSerializer)) > 50
    savers = [
        f"{cls.__module__}.{cls.__qualname__}.{name}"
        for cls in _project_classes(serializers.BaseSerializer)
        if cls is not ModelSerializer
        for name in ("create", "update", "save")
        if name in vars(cls)
    ]
    assert savers == []


def test_every_model_serializer_is_the_one_that_never_saves() -> None:
    plain = [
        f"{cls.__module__}.{cls.__qualname__}"
        for cls in _project_classes(serializers.ModelSerializer)
        if not issubclass(cls, ModelSerializer)
    ]
    assert plain == []


def _routed_viewsets(
    patterns: list[URLPattern | URLResolver],
) -> Iterator[type]:
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            yield from _routed_viewsets(pattern.url_patterns)
            continue
        cls = getattr(pattern.callback, "cls", None)
        if cls is not None and issubclass(cls, ViewSetMixin):
            yield cls


def test_every_viewset_is_a_kukgrade_viewset_without_put() -> None:
    routed = set(_routed_viewsets(get_resolver().url_patterns))
    assert routed
    assert [cls for cls in routed if not issubclass(cls, KukGradeViewSet)] == []
    answering_put = {
        cls for cls in routed if "put" in getattr(cls, "http_method_names", ())
    }
    assert answering_put == ANSWER_PUT
