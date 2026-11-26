"""The "who can do what" table in docs/features.md, drawn from the grants.

Its rows are the role grants (`accounts.groups`), the Master authorities and
the audit-log rule (`accounts.permissions`), so it says what the code does.
`manage.py write_permissions_table` writes it; a test fails while it differs.
"""

from __future__ import annotations

from pathlib import Path

from accounts.groups import (
    ADMINISTRATOR_GRANTS,
    ADMINISTRATOR_GROUP,
    GROUP_PERMISSIONS,
    INSTRUCTOR_GROUP,
    ROLE_GRANTS,
    SHARED_GRANTS,
    Grant,
)
from accounts.permissions import (
    AUDIT_LOG_GRANTS,
    AUTHORITY_PERMISSIONS,
    AUTHORITY_WORDS,
    MASTER_AUTHORITY_KEYS,
)

FEATURES_DOC = Path(__file__).resolve().parents[2] / "docs" / "features.md"
START = "<!-- permissions-table:start (manage.py write_permissions_table) -->"
END = "<!-- permissions-table:end -->"
TICK = "✓"


def _held(group: str) -> set[str]:
    return {f"{app}.{codename}" for app, codename in GROUP_PERMISSIONS[group]}


def _audit_log_cell(group: str) -> str:
    if _held(group) & set(AUDIT_LOG_GRANTS):
        return TICK
    # Not the role's: name what a person of that role can be granted.
    per_user = set(AUTHORITY_PERMISSIONS.values()) - {
        AUTHORITY_PERMISSIONS[key] for key in MASTER_AUTHORITY_KEYS
    }
    grantable = [p for p in AUDIT_LOG_GRANTS if p in per_user]
    return f"with `{grantable[0].split('.', 1)[1]}`" if grantable else ""


def rows() -> list[tuple[str, str, str, str]]:
    def ticks(grant: Grant) -> tuple[str, str]:
        return (
            TICK if grant in ROLE_GRANTS[INSTRUCTOR_GROUP] else "",
            TICK if grant in ROLE_GRANTS[ADMINISTRATOR_GROUP] else "",
        )

    master_holds_log = any(
        AUTHORITY_PERMISSIONS[key] in AUDIT_LOG_GRANTS for key in MASTER_AUTHORITY_KEYS
    )
    return [
        *((grant.words, *ticks(grant), "") for grant in SHARED_GRANTS),
        *(
            (f"**{AUTHORITY_WORDS[key][0]}** (`{key}`)", "", "", TICK)
            for key in MASTER_AUTHORITY_KEYS
        ),
        (
            "Read the audit log",
            _audit_log_cell(INSTRUCTOR_GROUP),
            _audit_log_cell(ADMINISTRATOR_GROUP),
            TICK if master_holds_log else "",
        ),
        *((grant.words, *ticks(grant), "") for grant in ADMINISTRATOR_GRANTS),
    ]


def render_table() -> str:
    head = "| Capability | Instructor | Administrator | Master permissions |"
    rule = "| --- | :-: | :-: | :-: |"
    return "\n".join([head, rule, *("| " + " | ".join(row) + " |" for row in rows())])


def with_table(document: str) -> str:
    """The document with the table between its markers drawn afresh."""
    before, start, rest = document.partition(START)
    _old, end, after = rest.partition(END)
    if not start or not end:
        msg = f"{FEATURES_DOC.name} has lost its permissions-table markers."
        raise ValueError(msg)
    table = render_table()
    return f"{before}{START}\n<!-- prettier-ignore -->\n{table}\n\n{END}{after}"
