"""The deleted-user placeholder is gone (accounts migration 0011)."""

from __future__ import annotations

from typing import Any

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from accounts.models import User
from audit.models import AuditAction, AuditEvent

PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"
BEFORE_THE_REMOVAL = [("accounts", "0010_user_deleted_at")]


def _old_user() -> Any:
    """The account as it was before the removal: the current one has columns
    added since, which that schema does not hold."""
    state = MigrationExecutor(connection).loader.project_state(BEFORE_THE_REMOVAL)
    return state.apps.get_model("accounts", "User")


@pytest.mark.django_db
def test_there_is_no_deleted_user_placeholder() -> None:
    assert not User.objects.filter(email=PLACEHOLDER_EMAIL).exists()


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_a_placeholder_that_holds_nothing_is_removed_and_one_that_does_is_closed() -> (
    None
):
    final_targets = MigrationExecutor(connection).loader.graph.leaf_nodes()
    try:
        # Going back puts it back, as migration 0005 made it.
        MigrationExecutor(connection).migrate(BEFORE_THE_REMOVAL)
        assert _old_user().objects.filter(email=PLACEHOLDER_EMAIL).exists()
        MigrationExecutor(connection).migrate(final_targets)
        assert not User.objects.filter(email=PLACEHOLDER_EMAIL).exists()

        MigrationExecutor(connection).migrate(BEFORE_THE_REMOVAL)
        placeholder = _old_user().objects.get(email=PLACEHOLDER_EMAIL)
        # Written as the audit log was then: by hand, since record() names
        # an actor by the account as it is now.
        event = AuditEvent.objects.create(
            action=AuditAction.USER_UPDATED,
            entity_type="User",
            entity_id=str(placeholder.pk),
            summary="Something it was credited with.",
            actor_id=placeholder.pk,
        )
        MigrationExecutor(connection).migrate(final_targets)

        kept = User.objects.get(email=PLACEHOLDER_EMAIL)
        assert kept.deleted_at is not None
        assert not kept.is_active
        assert event.actor_id == kept.pk
    finally:
        MigrationExecutor(connection).migrate(final_targets)
