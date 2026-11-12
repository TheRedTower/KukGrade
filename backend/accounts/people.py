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

from django.core.exceptions import ValidationError
from django.db import models
from rest_framework import serializers

from accounts.models import User

ADMINISTRATOR_TITLE = "administrator"

# For an account made before names were required: never its email address.

FIRST_NAME_MESSAGE = "Enter a first name."
LAST_NAME_MESSAGE = "Enter a last name."


def name_of(user: User) -> str:
    """A person's name as a record shows it: never their email address."""
    return user.get_full_name()


def require_names(first_name: str | None, last_name: str | None) -> None:
    """Every staff account has a first and a last name (owner, 2026-11-11),
    so a record can always name who made it. None means "not being set"."""
    errors: dict[str, list[str]] = {}
    if first_name is not None and not first_name.strip():
        errors["first_name"] = [FIRST_NAME_MESSAGE]
    if last_name is not None and not last_name.strip():
        errors["last_name"] = [LAST_NAME_MESSAGE]
    if errors:
        raise ValidationError(errors)


class MissingDetail(models.TextChoices):
    """What an account made before a rule still lacks, for an administrator
    to fill in."""

    NAME = "name", "Needs a name"
    RANK = "rank", "Needs a rank"


def missing_details(user: User) -> list[str]:
    missing = []
    if not user.first_name.strip() or not user.last_name.strip():
        missing.append(MissingDetail.NAME.value)
    if user.role == User.Role.INSTRUCTOR and user.rank_id is None:
        missing.append(MissingDetail.RANK.value)
    return missing


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
    return person_label(name_of(user), title) if user else ""


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
