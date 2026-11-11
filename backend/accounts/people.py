"""How a person is named on a record: their rank and name, as the rank they
held when they acted.

Owner, 2026-11-10: every comment, mark, decision and change shows "KSN Jane
Smith", never an email address, and a later promotion never changes it ("the
decision was made as a KSN and it will stay as that rank"). So each record
that names a person keeps, beside them, the title they held then: their
rank, or "administrator" for an administrator account, which has no rank and
reads "Jane Smith (administrator)".
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from accounts.models import User

ADMINISTRATOR_TITLE = "administrator"


def title_of(user: User | None) -> str:
    """What to keep beside `user` on a record made now."""
    if user is None:
        return ""
    if user.role == User.Role.ADMINISTRATOR:
        return ADMINISTRATOR_TITLE
    return user.rank.name if user.rank_id is not None and user.rank else ""


def person_label(name: str, title: str) -> str:
    """A person as a record names them: "KSN Jane Smith"."""
    if not name:
        return ""
    if title == ADMINISTRATOR_TITLE:
        return f"{name} (administrator)"
    return f"{title} {name}" if title else name


def named(user: User | None, title: str) -> str:
    """`user` by their current name and the title the record kept."""
    return person_label(user.get_full_name(), title) if user else ""


class PersonNameField(serializers.CharField):
    """A person a record names, served as it names them ("KSN Jane Smith"):
    the record's `person` field and the `<person>_title` kept beside it.
    Blank when the record names nobody."""

    def __init__(self, person: str, **kwargs: Any) -> None:
        self.person = person
        kwargs.setdefault(
            "help_text",
            f"Who {person.replace('_', ' ')} is, as the record names them: their "
            "rank then and their name.",
        )
        super().__init__(source="*", read_only=True, **kwargs)

    def to_representation(self, value: Any) -> str:
        return named(
            getattr(value, self.person), getattr(value, f"{self.person}_title")
        )
