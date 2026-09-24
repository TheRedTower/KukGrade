"""Standard student-roster template and best-effort header suggestions.

Suggestions are never authoritative - the admin confirms or overrides the
mapping before anything is validated or committed (import Decision 11:
support both the standard template and a custom mapping).
"""

from __future__ import annotations

from collections.abc import Sequence

STUDENT_TARGET_FIELDS: tuple[str, ...] = (
    "wksa_id",
    "first_name",
    "last_name",
    "date_of_birth",
    "current_rank",
    "status",
)

STUDENT_REQUIRED_TARGET_FIELDS: tuple[str, ...] = (
    "wksa_id",
    "first_name",
    "last_name",
    "date_of_birth",
    "current_rank",
)

# The standard template's header row, in column order. The frontend's
# "Download standard template" link (ImportStudentsScreen) must match it.
STANDARD_STUDENT_HEADERS: dict[str, str] = {
    "wksa_id": "WKSA ID",
    "first_name": "First Name",
    "last_name": "Last Name",
    "date_of_birth": "Date of Birth",
    "current_rank": "Current Rank",
    "status": "Status",
}

_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "wksa_id": ("wksa id", "wksa_id", "member no", "member number", "id"),
    "first_name": ("first name", "first_name", "forename", "given name"),
    "last_name": ("last name", "last_name", "surname", "family name"),
    "date_of_birth": ("date of birth", "date_of_birth", "dob"),
    "current_rank": ("current rank", "current_rank", "belt", "rank"),
    "status": ("status",),
}


def _normalise_header(header: str) -> str:
    return " ".join(str(header).strip().lower().split())


def suggest_column_mapping(headers: Sequence[str]) -> dict[str, str]:
    """Best-effort target field -> source header mapping, for pre-filling the UI."""
    normalised = {header: _normalise_header(header) for header in headers}
    mapping: dict[str, str] = {}
    for field, aliases in _HEADER_ALIASES.items():
        for header, norm in normalised.items():
            if norm in aliases:
                mapping[field] = header
                break
    return mapping
