"""Who can do what, asserted per role against every significant operation.

The audit found the opposite of this file: four role permission classes with
sixteen passing assertions, wired to zero views. The tests proved the classes
worked in isolation while every grading endpoint was open to any authenticated
user, which is exactly the false confidence that let the gap survive.

So these tests go through the URL layer, not the permission classes.

A note on the 403-vs-404 pattern below: DRF checks permissions before it looks
an object up, so a request to a non-existent id still answers 403 when the
caller lacks authority and 404 when they have it. That lets the matrix assert
authorisation without building a full grading fixture for every cell.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import (
    AUTHORITY_PERMISSIONS,
    AUTHORITY_REFUSALS,
    HasRequiredPermissions,
)
from kukgrade.viewsets import KukGradeViewSet

pytestmark = pytest.mark.django_db

READ_ENDPOINTS = [
    "/api/ranks/",
    "/api/syllabus/age-bands/",
    "/api/syllabus/requirements/effective/?rank_code=YELLOW&age_band=AGE_18_AND_OVER",
    "/api/gradings/sessions/",
    "/api/gradings/candidates/",
    "/api/gradings/assessments/",
    "/api/gradings/assessment-items/",
]


def persona(
    email: str,
    role: str = User.Role.INSTRUCTOR,
    *,
    permissions: tuple[str, ...] = (),
) -> APIClient:
    user = User.objects.create_user(email=email, role=role)
    for dotted in permissions:
        app_label, codename = dotted.split(".")
        user.user_permissions.add(
            Permission.objects.get(
                codename=codename,
                content_type__app_label=app_label,
            ),
        )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def instructor(email: str = "matrix-instructor@example.com") -> APIClient:
    return persona(email)


def administrator(email: str = "matrix-admin@example.com") -> APIClient:
    return persona(email, User.Role.ADMINISTRATOR)


def master(email: str = "matrix-master@example.com") -> APIClient:
    return persona(
        email,
        permissions=("gradings.can_make_final_grading_decision",),
    )


def promoter(email: str = "matrix-promoter@example.com") -> APIClient:
    return persona(email, permissions=("gradings.can_promote_student",))


# --------------------------------------------------------------------------
# Anonymous
# --------------------------------------------------------------------------


@pytest.mark.parametrize("endpoint", READ_ENDPOINTS)
def test_anonymous_is_denied_everywhere(endpoint: str) -> None:
    assert APIClient().get(endpoint).status_code == 403


def test_health_stays_public() -> None:
    assert APIClient().get("/api/health/").status_code == 200


# --------------------------------------------------------------------------
# Instructors own everything Kuk Sool
# --------------------------------------------------------------------------


@pytest.mark.parametrize("endpoint", READ_ENDPOINTS)
def test_instructor_can_read_every_grading_endpoint(endpoint: str) -> None:
    slug = endpoint.split("?")[0].strip("/").replace("/", "-")
    assert instructor(f"read-{slug}@example.com").get(endpoint).status_code == 200


def test_instructor_can_run_a_grading_end_to_end() -> None:
    client = instructor("runs-grading@example.com")

    created = client.post(
        "/api/gradings/sessions/",
        {"title": "Instructor-run grading", "grading_date": str(date(2027, 7, 1))},
        format="json",
    )
    assert created.status_code == 201

    session_id = created.json()["id"]
    assert (
        client.patch(
            f"/api/gradings/sessions/{session_id}/",
            {"location": "Riverside"},
            format="json",
        ).status_code
        == 200
    )
    # An instructor cancels a session; only an administrator deletes one.
    refused = client.delete(f"/api/gradings/sessions/{session_id}/")
    assert refused.status_code == 403
    assert (
        administrator("deletes-grading@example.com")
        .delete(f"/api/gradings/sessions/{session_id}/")
        .status_code
        == 204
    )


def test_instructor_may_propose_an_outcome() -> None:
    # 404 rather than 403: the authority is there, the object is not.
    response = instructor("proposes@example.com").post(
        "/api/gradings/candidates/99999999/propose-outcome/",
        {"proposed_outcome": "PASS"},
        format="json",
    )
    assert response.status_code == 404


# --------------------------------------------------------------------------
# ...but not the final decision
# --------------------------------------------------------------------------


def test_instructor_cannot_finalise_an_outcome() -> None:
    response = instructor("cannot-finalise@example.com").patch(
        "/api/gradings/outcomes/99999999/finalise/",
        {"final_outcome": "PASS"},
        format="json",
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_administrator_cannot_finalise_an_outcome() -> None:
    # "Administrators do everything" means logistics, not grading authority.
    response = administrator("admin-cannot-finalise@example.com").patch(
        "/api/gradings/outcomes/99999999/finalise/",
        {"final_outcome": "PASS"},
        format="json",
    )
    assert response.status_code == 403


def test_master_may_finalise_an_outcome() -> None:
    response = master().patch(
        "/api/gradings/outcomes/99999999/finalise/",
        {"final_outcome": "PASS"},
        format="json",
    )
    assert response.status_code == 404


def test_instructor_cannot_promote_a_student() -> None:
    response = instructor("cannot-promote@example.com").post(
        "/api/gradings/outcomes/99999999/promote/",
        {},
        format="json",
    )
    assert response.status_code == 403


def test_promotion_authority_is_separate_from_final_decision() -> None:
    # Holding one must not confer the other.
    assert (
        master("master-only@example.com")
        .post("/api/gradings/outcomes/99999999/promote/", {}, format="json")
        .status_code
        == 403
    )
    assert (
        promoter("promoter-only@example.com")
        .patch(
            "/api/gradings/outcomes/99999999/finalise/",
            {"final_outcome": "PASS"},
            format="json",
        )
        .status_code
        == 403
    )


# --------------------------------------------------------------------------
# Administrators add people management, nothing else
# --------------------------------------------------------------------------


def test_only_administrators_manage_users() -> None:
    plain = User.objects.create_user(email="plain@example.com")
    admin = User.objects.create_user(
        email="an-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    assert plain.has_perm("accounts.add_user") is False
    assert admin.has_perm("accounts.add_user") is True
    # Both still run gradings.
    assert plain.has_perm("gradings.add_gradingsession") is True
    assert admin.has_perm("gradings.add_gradingsession") is True


def test_nobody_holds_a_delete_grant_nothing_reads() -> None:
    # Outcomes and promotions are never deleted directly: no endpoint exists
    # and the admin refuses, so a grant would only suggest otherwise.
    admin = User.objects.create_user(
        email="no-delete-grant@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    assert admin.has_perm("gradings.delete_candidateoutcome") is False
    assert admin.has_perm("gradings.delete_promotion") is False
    # Deleting a session or a student, which the services do gate, is kept.
    assert admin.has_perm("gradings.delete_any_gradingsession") is True
    assert admin.has_perm("students.delete_student") is True


def test_a_user_in_no_group_is_denied() -> None:
    user = User.objects.create_user(email="groupless@example.com")
    user.groups.clear()
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.get("/api/gradings/sessions/").status_code == 403


def test_inactive_user_is_denied_even_with_the_permission() -> None:
    user = User.objects.create_user(email="inactive-master@example.com")
    user.user_permissions.add(
        Permission.objects.get(
            codename="can_make_final_grading_decision",
            content_type=ContentType.objects.get(
                app_label="gradings",
                model="candidateoutcome",
            ),
        ),
    )
    user.is_active = False
    user.save()
    client = APIClient()
    client.force_authenticate(user=user)

    assert (
        client.patch(
            "/api/gradings/outcomes/99999999/finalise/",
            {"final_outcome": "PASS"},
            format="json",
        ).status_code
        == 403
    )


# --------------------------------------------------------------------------
# Completeness: no action may escape the matrix
# --------------------------------------------------------------------------

STANDARD_ACTION_METHODS = {
    "list": "get",
    "retrieve": "get",
    "create": "post",
    "update": "put",
    "partial_update": "patch",
    "destroy": "delete",
}


def every_router() -> list[Any]:
    """Every app's API router - all of them, so none escapes these checks."""
    from accounts.urls import router as accounts_router
    from audit.urls import router as audit_router
    from data_imports.urls import router as data_imports_router
    from gradings.urls import router as gradings_router
    from ranks.urls import router as ranks_router
    from students.urls import router as students_router
    from syllabus.urls import router as syllabus_router

    return [
        accounts_router,
        audit_router,
        data_imports_router,
        gradings_router,
        ranks_router,
        students_router,
        syllabus_router,
    ]


def routed_viewsets() -> list[tuple[str, Any]]:
    routers = every_router()
    return [
        (f"{viewset.__name__}", viewset)
        for router in routers
        for _prefix, viewset, _basename in router.registry
    ]


def reachable_actions(viewset: Any) -> set[str]:
    allowed_methods = {
        method.lower()
        for method in getattr(
            viewset,
            "http_method_names",
            ["get", "post", "put", "patch", "delete", "head", "options"],
        )
    }
    actions = {
        name
        for name, method in STANDARD_ACTION_METHODS.items()
        if hasattr(viewset, name) and method in allowed_methods
    }
    for extra in viewset.get_extra_actions():
        if any(method in allowed_methods for method in extra.mapping):
            actions.add(extra.__name__)
    return actions


# put -> update, delete -> destroy: the two verbs a viewset most commonly
# excludes via http_method_names while still including the mixin that
# defines the method. DRF's router binds them regardless of
# http_method_names, so if the exclusion isn't handled by the permission
# class, the request is denied as an undeclared action (403) instead of
# falling through to Django's own "method not allowed" (405).
_VERB_TO_MIXIN_ACTION = {"put": "update", "delete": "destroy"}


def routed_detail_routes() -> list[tuple[str, str, Any]]:
    """(url_name, basename, viewset) for every registered detail route."""
    routers = every_router()
    return [
        (f"{basename}-detail", basename, viewset)
        for router in routers
        for _prefix, viewset, basename in router.registry
    ]


def excluded_but_bound_methods(viewset: Any) -> list[str]:
    """Verbs this viewset's http_method_names excludes, whose mixin method
    the class still defines - exactly the shape that masked PUT as 403 on
    CandidateAssessmentViewSet, CandidateAssessmentItemViewSet, and
    CandidateOutcomeViewSet before it was noticed on a fourth viewset built
    later (StudentViewSet) and fixed once, at the source, in
    HasRequiredPermissions rather than per view.
    """
    declared = getattr(viewset, "http_method_names", None)
    if declared is None:
        return []
    return [
        verb
        for verb, action_name in _VERB_TO_MIXIN_ACTION.items()
        if verb not in declared and hasattr(viewset, action_name)
    ]


def excluded_method_cases() -> list[tuple[str, str, str]]:
    return [
        (url_name, basename, verb)
        for url_name, basename, viewset in routed_detail_routes()
        for verb in excluded_but_bound_methods(viewset)
    ]


@pytest.mark.parametrize("url_name,basename,verb", excluded_method_cases())
def test_excluded_http_methods_answer_not_allowed_not_permission_denied(
    url_name: str,
    basename: str,
    verb: str,
) -> None:
    """Every current and future case of the PUT-masked-as-403 shape, at once.

    Parametrized over the live router registry rather than pinned to one
    endpoint: a new viewset built the same way is covered automatically,
    with no test to remember to add.
    """
    from django.urls import reverse

    client = administrator(f"method-exclusion-{basename}-{verb}@example.com")
    url = reverse(url_name, args=["999999999"])

    response = getattr(client, verb)(url, {}, format="json")

    assert response.status_code == 405, (
        f"{basename} {verb.upper()} -> {response.status_code}, expected 405"
    )
    assert response.json()["error"]["code"] == "method_not_allowed"


@pytest.mark.parametrize("name,viewset", routed_viewsets())
def test_every_routed_action_declares_its_permissions(
    name: str,
    viewset: Any,
) -> None:
    """A new @action without a permission_map entry fails here, not in production.

    The permission class denies undeclared actions, so the consequence would
    otherwise be a 403 nobody understands rather than a failing test.
    """
    declared = set(getattr(viewset, "permission_map", {}))
    missing = reachable_actions(viewset) - declared

    assert not missing, f"{name} does not declare permissions for: {sorted(missing)}"


# --------------------------------------------------------------------------
# The map is always checked, and it carries the authority too
# --------------------------------------------------------------------------


def test_a_viewset_that_names_no_classes_still_checks_its_map() -> None:
    """A new viewset that leaves out permission_classes inherits the check,
    rather than the project default of "any signed-in user"."""

    class Forgetful(KukGradeViewSet[User]):
        permission_map = {"list": ("accounts.view_user",)}

    assert Forgetful.permission_classes == [HasRequiredPermissions]


@pytest.mark.parametrize("name,viewset", routed_viewsets())
def test_every_routed_viewset_checks_its_permission_map(
    name: str,
    viewset: Any,
) -> None:
    """Without HasRequiredPermissions a permission_map is silently ignored,
    so the completeness test above would pass over an open endpoint."""
    assert HasRequiredPermissions in viewset.permission_classes, name
    for extra in viewset.get_extra_actions():
        classes = extra.kwargs.get("permission_classes")
        if classes is not None:
            assert HasRequiredPermissions in classes, f"{name}.{extra.__name__}"


def authority_requests() -> list[tuple[str, str, str, str, str]]:
    """Every routed request whose action's map names a per-user authority:
    (viewset, action, authority, method, url), one per method the action
    answers, so a PUT and a DELETE on the same action are each asked."""
    authorities = set(AUTHORITY_PERMISSIONS.values())
    requests = []
    for router in every_router():
        for _prefix, viewset, basename in router.registry:
            permission_map = getattr(viewset, "permission_map", {})
            for extra in viewset.get_extra_actions():
                held = authorities.intersection(
                    permission_map.get(extra.__name__, ()),
                )
                if not held:
                    continue
                kwargs = {"pk": 99999999} if extra.detail else {}
                url = reverse(f"{basename}-{extra.url_name}", kwargs=kwargs)
                for authority in held:
                    for method in extra.mapping:
                        requests.append(
                            (viewset.__name__, extra.__name__, authority, method, url),
                        )
    return sorted(requests)


def test_the_master_actions_declare_their_authority() -> None:
    declared = {(name, action) for name, action, *_ in authority_requests()}
    assert {
        ("CandidateOutcomeViewSet", "finalise"),
        ("CandidateOutcomeViewSet", "staged_decision"),
        ("CandidateOutcomeViewSet", "staged_decisions"),
        ("CandidateOutcomeViewSet", "promote"),
        ("CandidateOutcomeViewSet", "bulk_promote"),
        ("GradingCandidateViewSet", "withdraw"),
    } <= declared


@pytest.mark.parametrize(
    "name,action_name,authority,method,url",
    authority_requests(),
)
@pytest.mark.parametrize("role", [User.Role.INSTRUCTOR, User.Role.ADMINISTRATOR])
def test_an_authority_action_refuses_a_role_without_that_authority(
    name: str,
    action_name: str,
    authority: str,
    method: str,
    url: str,
    role: str,
) -> None:
    """Through the URL: a role's own grants are not enough, and the refusal
    names the missing authority; the same role holding it gets past the check
    (404 on the made-up id, or the request's own validation)."""
    without = persona(f"no-authority-{role}@example.com", role)
    holder = persona(f"holder-{role}@example.com", role, permissions=(authority,))

    refused = getattr(without, method)(url, {}, format="json")
    allowed = getattr(holder, method)(url, {}, format="json")

    assert refused.status_code == 403, f"{name}.{action_name} {method.upper()}"
    assert refused.json()["error"]["message"] == AUTHORITY_REFUSALS[authority]
    assert allowed.status_code != 403, f"{name}.{action_name} {method.upper()}"


# --------------------------------------------------------------------------
# Every permission named is a real one
# --------------------------------------------------------------------------


def _exists(dotted: str) -> bool:
    app_label, codename = dotted.split(".")
    return Permission.objects.filter(
        content_type__app_label=app_label,
        codename=codename,
    ).exists()


def test_every_permission_a_map_or_a_rule_names_exists() -> None:
    """A misspelt permission is held by nobody, so the action it guards would
    refuse everyone (or a flag would never show) with no error anywhere."""
    from accounts import permissions

    named = {
        permission
        for _name, viewset in routed_viewsets()
        for required in getattr(viewset, "permission_map", {}).values()
        for permission in required
    }
    named |= {
        value
        for constant, value in vars(permissions).items()
        if constant.endswith("_PERMISSION") and isinstance(value, str)
    }
    named |= set(AUTHORITY_PERMISSIONS.values())

    assert sorted(dotted for dotted in named if not _exists(dotted)) == []


def test_a_role_group_naming_an_unknown_permission_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from django.core.exceptions import ImproperlyConfigured

    from accounts import groups

    monkeypatch.setattr(
        groups,
        "GROUP_PERMISSIONS",
        {groups.INSTRUCTOR_GROUP: (("students", "view_studnet"),)},
    )

    with pytest.raises(ImproperlyConfigured, match=r"students\.view_studnet"):
        groups.sync_role_groups()
