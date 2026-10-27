"""Standard student-roster template and best-effort header suggestions.

Suggestions are never authoritative - the admin confirms or overrides the
mapping before anything is validated or committed (both the
standard template and a custom mapping are supported).
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

# Each field's name on screen, and whether a student needs it - status
# defaults to Active, so it is the only one a row may lack.
STUDENT_FIELD_LABELS: dict[str, str] = {
    "wksa_id": "WKSA ID",
    "first_name": "First name",
    "last_name": "Last name",
    "date_of_birth": "Date of birth",
    "current_rank": "Rank",
    "status": "Status",
}
STUDENT_OPTIONAL_FIELDS: frozenset[str] = frozenset({"status"})

# Fields one value can be given for the whole file, used where a row has
# none (no column, or a blank cell). Never a field that is each person's own -
# an ID, a name or a date of birth given for everyone would be invented.
STUDENT_WHOLE_FILE_FIELDS: tuple[str, ...] = ("current_rank", "status")

# An extra column is kept under its header, which must fit the label.
EXTRA_LABEL_MAX_LENGTH = 150

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
