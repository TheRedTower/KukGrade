"""The OpenAPI schema generator's view of KukGrade's conventions."""

from __future__ import annotations

from typing import Any

from drf_spectacular.openapi import AutoSchema

from kukgrade.filtering import declares_its_own


class KukGradeAutoSchema(AutoSchema):
    """Documents an action's own declared filters (`@action(query_filters=...)`)
    as a list's are, whether or not it answers with a list."""

    def get_filter_backends(self) -> list[Any]:
        if declares_its_own(self.view):
            return list(getattr(self.view, "filter_backends", []))
        backends: list[Any] = super().get_filter_backends()
        return backends
