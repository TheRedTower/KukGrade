from __future__ import annotations

from typing import Any

from django.apps import AppConfig
from django.contrib.admin import apps as admin_apps
from django.db.models.signals import post_migrate, post_save


def _sync_groups(using: str = "default", **_kwargs: Any) -> None:
    from accounts.groups import sync_role_groups

    sync_role_groups(using=using)


def _apply_role_group(
    sender: Any,
    instance: Any,
    created: bool,
    raw: bool = False,
    **_kwargs: Any,
) -> None:
    # raw=True means a fixture/deserializer (e.g. pytest-django's
    # serialized_rollback restore) is placing this row verbatim, not a real
    # user being created or edited - applying group membership here races
    # the same restore's own Group rows and corrupts them (auth_group unique
    # violation under the transactional tests). Skip on raw saves.
    if raw:
        return

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


class KukGradeAdminConfig(admin_apps.AdminConfig):
    """Django admin, on KukGrade's site (accounts/admin_site.py). Here rather
    than beside the site because an app config is loaded before models are.
    Named in INSTALLED_APPS, never the default for `accounts`."""

    default = False
    default_site = "accounts.admin_site.KukGradeAdminSite"
