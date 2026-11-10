"""The deleted-user placeholder is gone (accounts migration 0011)."""

from __future__ import annotations

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record

PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"
BEFORE_THE_REMOVAL = [("accounts", "0010_user_deleted_at")]


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
        assert User.objects.filter(email=PLACEHOLDER_EMAIL).exists()
        MigrationExecutor(connection).migrate(final_targets)
        assert not User.objects.filter(email=PLACEHOLDER_EMAIL).exists()

        MigrationExecutor(connection).migrate(BEFORE_THE_REMOVAL)
        placeholder = User.objects.get(email=PLACEHOLDER_EMAIL)
        event = record(
            AuditAction.USER_UPDATED,
            placeholder,
            "Something it was credited with.",
            actor=placeholder,
        )
        MigrationExecutor(connection).migrate(final_targets)

        kept = User.objects.get(email=PLACEHOLDER_EMAIL)
        assert kept.deleted_at is not None
        assert not kept.is_active
        assert event.actor_id == kept.pk
    finally:
        MigrationExecutor(connection).migrate(final_targets)
