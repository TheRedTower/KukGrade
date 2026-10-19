"""The password policy: defined once, enforced by Django, served to the screens.

Every path that sets a password - creating a user, an administrator's reset,
changing your own, Django admin's forms, `createsuperuser` - runs Django's
`validate_password`, which runs `AUTH_PASSWORD_VALIDATORS`. The two validators
here read the rules below, and `/api/site/` serves the same rules, so the
checklist the screens show cannot drift from what the server enforces
(2026-10-19, `docs/email-and-credential-lifecycle.md` amendments 2 and 3).

Length is counted in characters (code points), as Python's `len` counts
them; a character rule is a pattern any regular-expression engine reads the
same way, so the browser can tick it off as the password is typed. The
common-password and similarity checks need the server's word list and the
account's own details, so they are served only as labels and run on save.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from django.core.exceptions import ValidationError

MIN_LENGTH = 16
MAX_LENGTH = 64


@dataclass(frozen=True)
class CharacterRule:
    code: str
    pattern: str
    label: str
    message: str


CHARACTER_RULES: tuple[CharacterRule, ...] = (
    CharacterRule(
        "uppercase", "[A-Z]", "An uppercase letter", "Include an uppercase letter."
    ),
    CharacterRule(
        "lowercase", "[a-z]", "A lowercase letter", "Include a lowercase letter."
    ),
    CharacterRule("number", "[0-9]", "A number", "Include a number."),
    CharacterRule(
        "special",
        "[^A-Za-z0-9]",
        "A special character, such as ! or #",
        "Include a special character, such as ! or #.",
    ),
)

# Run by Django's own validators when the password is saved.
CHECKED_ON_SAVE: tuple[str, ...] = (
    "Not a commonly used password",
    "Not too similar to your name or email address",
)


def policy() -> dict[str, Any]:
    """The policy as `/api/site/` serves it."""
    return {
        "min_length": MIN_LENGTH,
        "max_length": MAX_LENGTH,
        "character_rules": [
            {"code": rule.code, "label": rule.label, "pattern": rule.pattern}
            for rule in CHARACTER_RULES
        ],
        "checked_on_save": list(CHECKED_ON_SAVE),
    }


class LengthValidator:
    """Between MIN_LENGTH and MAX_LENGTH characters."""

    def validate(self, password: str, user: object = None) -> None:
        if len(password) < MIN_LENGTH:
            raise ValidationError(
                f"Use at least {MIN_LENGTH} characters.",
                code="password_too_short",
            )
        if len(password) > MAX_LENGTH:
            raise ValidationError(
                f"Use no more than {MAX_LENGTH} characters.",
                code="password_too_long",
            )

    def get_help_text(self) -> str:
        return f"Use {MIN_LENGTH} to {MAX_LENGTH} characters."


class CharacterRulesValidator:
    """Every character rule, each missing one reported."""

    def validate(self, password: str, user: object = None) -> None:
        missing = [
            ValidationError(rule.message, code=f"password_needs_{rule.code}")
            for rule in CHARACTER_RULES
            if not re.search(rule.pattern, password)
        ]
        if missing:
            raise ValidationError(missing)

    def get_help_text(self) -> str:
        return (
            "Include " + ", ".join(rule.label.lower() for rule in CHARACTER_RULES) + "."
        )
