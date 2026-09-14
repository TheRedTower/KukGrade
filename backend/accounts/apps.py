from __future__ import annotations

from typing import Any

from django.apps import AppConfig
from django.db.models.signals import post_migrate, post_save


def _sync_groups(using: str = "default", **_kwargs: Any) -> None:
    from accounts.groups import sync_role_groups

    sync_role_groups(using=using)


def _apply_role_group(
    sender: Any,
    instance: Any,
    created: bool,
    **_kwargs: Any,
) -> None:
    from accounts.groups import apply_role_group

    apply_role_group(instance)


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self) -> None:
        from accounts.models import User

        # Connected without a sender filter on purpose. post_migrate is sent
        # once per app config in INSTALLED_APPS order, and `accounts` is
        # first, so a sender-filtered receiver would run before the other
        # apps' permissions had been created. Running on every app config is
        # idempotent, and the final invocation sees every permission.
        post_migrate.connect(_sync_groups, dispatch_uid="accounts.sync_groups")

        # Keeps role and group membership consistent without anyone having to
        # remember. Groups other than the two role groups are left alone.
        post_save.connect(
            _apply_role_group,
            sender=User,
            dispatch_uid="accounts.apply_role_group",
        )
