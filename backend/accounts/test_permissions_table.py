"""The "who can do what" table in docs/features.md is the code's, not a copy."""

from __future__ import annotations

from accounts.groups import GROUP_PERMISSIONS
from accounts.permissions import AUDIT_LOG_GRANTS, AUTHORITY_PERMISSIONS
from accounts.permissions_table import FEATURES_DOC, with_table
from accounts.test_permission_matrix import routed_viewsets


def test_the_docs_table_is_the_one_the_grants_give() -> None:
    document = FEATURES_DOC.read_text()

    assert with_table(document) == document, (
        "docs/features.md's permissions table is out of date: run "
        "`python manage.py write_permissions_table` from backend/."
    )


def test_every_permission_an_action_checks_is_in_a_row() -> None:
    # The rows are the grants, the authorities and the audit-log rule; an
    # action checking anything else would change who can do what without the
    # table saying so.
    in_rows = {
        f"{app}.{codename}"
        for specs in GROUP_PERMISSIONS.values()
        for app, codename in specs
    }
    in_rows |= set(AUTHORITY_PERMISSIONS.values()) | set(AUDIT_LOG_GRANTS)
    checked = {
        permission
        for _name, viewset in routed_viewsets()
        for required in getattr(viewset, "permission_map", {}).values()
        for permission in required
    }

    assert checked - in_rows == set()
