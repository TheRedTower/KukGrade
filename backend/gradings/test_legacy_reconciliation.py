"""LegacyGradingRecordViewSet: read access for both roles, reconciliation
(link/unlink/resolve-rank/void) administrator-only via the API."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.testing import legacy_batch, legacy_record
from gradings.legacy_services import link_legacy_record_to_student
from gradings.models import LegacyGradingRecord
from gradings.testing import rank, student, user

pytestmark = pytest.mark.django_db


def admin(email: str = "legacy-recon-admin@example.com") -> User:
    return user(email, role=User.Role.ADMINISTRATOR)


def instructor(email: str = "legacy-recon-instructor@example.com") -> User:
    return user(email, role=User.Role.INSTRUCTOR)


def test_instructor_can_list_legacy_records() -> None:
    legacy_record()
    client = APIClient()
    client.force_authenticate(user=instructor())

    list_response = client.get("/api/gradings/legacy-records/")
    assert list_response.status_code == 200
    assert [row["source_name"] for row in list_response.json()["results"]] == [
        "A. Example"
    ]


def test_record_detail_remains_available_after_link_and_void() -> None:
    record = legacy_record()
    target = student(wksa_id="123-4-509")
    administrator = admin()
    writer = APIClient()
    writer.force_authenticate(user=administrator)
    reader = APIClient()
    reader.force_authenticate(user=instructor())
    url = f"/api/gradings/legacy-records/{record.pk}/"

    assert reader.get(url).json()["student"] is None
    assert writer.post(f"{url}link-student/", {"student": target.pk}).status_code == 200
    assert reader.get(url).json()["student"] == target.pk
    assert writer.post(f"{url}void/", {"reason": "Duplicate"}).status_code == 200
    detail = reader.get(url)
    assert detail.status_code == 200
    assert detail.json()["is_void"] is True
    assert detail.json()["void_reason"] == "Duplicate"


def test_instructor_cannot_link_unlink_resolve_or_void() -> None:
    record = legacy_record()
    target = student(wksa_id="123-4-500")
    client = APIClient()
    client.force_authenticate(user=instructor())

    link_response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/link-student/",
        {"student": target.pk},
        format="json",
    )
    assert link_response.status_code == 403

    resolve_response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/resolve-rank/",
        {"field": "current_rank", "rank": rank("YELLOW").pk},
        format="json",
    )
    assert resolve_response.status_code == 403

    void_response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/void/",
        {"reason": "test"},
        format="json",
    )
    assert void_response.status_code == 403


def test_admin_links_and_unlinks_a_record_via_the_api() -> None:
    record = legacy_record()
    target = student(wksa_id="123-4-501")
    client = APIClient()
    client.force_authenticate(user=admin())

    link_response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/link-student/",
        {"student": target.pk},
        format="json",
    )
    assert link_response.status_code == 200
    assert link_response.json()["student"] == target.pk

    unlink_response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/unlink-student/",
    )
    assert unlink_response.status_code == 200
    assert unlink_response.json()["student"] is None


def test_admin_resolves_current_and_testing_for_rank_via_the_api() -> None:
    record = legacy_record(source_current_rank_text="Yellow")
    yellow = rank("YELLOW")
    client = APIClient()
    client.force_authenticate(user=admin())

    url = f"/api/gradings/legacy-records/{record.pk}/resolve-rank/"

    response = client.post(
        url, {"field": "current_rank", "rank": yellow.pk}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["current_rank"] == yellow.pk
    assert response.json()["current_rank_code"] == "YELLOW"

    cleared = client.post(url, {"field": "current_rank", "rank": None}, format="json")
    assert cleared.status_code == 200
    assert cleared.json()["current_rank"] is None

    tested = client.post(
        url, {"field": "testing_for_rank", "rank": yellow.pk}, format="json"
    )
    assert tested.status_code == 200
    assert tested.json()["testing_for_rank"] == yellow.pk
    assert tested.json()["current_rank"] is None


def test_resolving_a_rank_needs_to_say_which() -> None:
    record = legacy_record(source_current_rank_text="Yellow")
    client = APIClient()
    client.force_authenticate(user=admin())
    url = f"/api/gradings/legacy-records/{record.pk}/resolve-rank/"

    for body in ({"rank": rank("YELLOW").pk}, {"field": "notes", "rank": None}):
        response = client.post(url, body, format="json")
        assert response.status_code == 400, body
    record.refresh_from_db()
    assert record.current_rank_id is None


def test_admin_voids_a_record_via_the_api_and_second_void_is_refused() -> None:
    record = legacy_record()
    client = APIClient()
    client.force_authenticate(user=admin())

    response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/void/",
        {"reason": "Duplicate row in source workbook"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["is_void"] is True

    second = client.post(
        f"/api/gradings/legacy-records/{record.pk}/void/",
        {"reason": "Trying again"},
        format="json",
    )
    assert second.status_code == 400


def test_void_without_a_reason_is_rejected() -> None:
    record = legacy_record()
    client = APIClient()
    client.force_authenticate(user=admin())

    response = client.post(
        f"/api/gradings/legacy-records/{record.pk}/void/",
        {"reason": ""},
        format="json",
    )
    assert response.status_code == 400


def test_linked_filter_narrows_the_list() -> None:
    batch = legacy_batch(uploaded_by=admin("recon-filter-uploader@example.com"))
    linked = legacy_record(source_batch=batch, source_locator="06-2025!R3")
    unlinked = legacy_record(source_batch=batch, source_locator="06-2025!R4")
    target = student(wksa_id="123-4-502")
    link_legacy_record_to_student(linked, target, actor=admin())

    client = APIClient()
    client.force_authenticate(user=instructor())

    linked_response = client.get("/api/gradings/legacy-records/?linked=true")
    linked_ids = {row["id"] for row in linked_response.json()["results"]}
    assert linked.pk in linked_ids
    assert unlinked.pk not in linked_ids

    unlinked_response = client.get("/api/gradings/legacy-records/?linked=false")
    unlinked_ids = {row["id"] for row in unlinked_response.json()["results"]}
    assert unlinked.pk in unlinked_ids
    assert linked.pk not in unlinked_ids


def test_anonymous_user_is_denied() -> None:
    client = APIClient()
    response = client.get("/api/gradings/legacy-records/")
    assert response.status_code in (401, 403)


def test_linking_does_not_change_source_name() -> None:
    """A link/unlink correction never touches source identity text."""
    record = legacy_record(source_name="Original Name")
    target = student(wksa_id="123-4-503")
    client = APIClient()
    client.force_authenticate(user=admin())

    client.post(
        f"/api/gradings/legacy-records/{record.pk}/link-student/",
        {"student": target.pk},
        format="json",
    )
    record.refresh_from_db()
    assert record.source_name == "Original Name"


def test_needs_rank_is_one_rule_in_the_filter_and_on_a_loaded_record() -> None:
    yellow = rank("YELLOW")
    for held_text, held, testing_text, testing in (
        ("", None, "", None),
        ("Yellow", None, "", None),
        ("Yellow", yellow, "", None),
        ("", None, "Blue", None),
        ("Yellow", yellow, "Blue", yellow),
        ("", yellow, "", None),
    ):
        legacy_record(
            source_current_rank_text=held_text,
            current_rank=held,
            source_testing_for_rank_text=testing_text,
            testing_for_rank=testing,
        )
    client = APIClient()
    client.force_authenticate(user=admin())

    filtered = {
        row["id"]
        for row in client.get(
            "/api/gradings/legacy-records/?needs_rank=true&page_size=100"
        ).json()["results"]
    }

    loaded = {
        record.pk for record in LegacyGradingRecord.objects.all() if record.needs_rank
    }
    assert len(loaded) == 2
    assert filtered == loaded
