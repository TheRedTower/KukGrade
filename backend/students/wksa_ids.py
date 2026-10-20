"""The two forms a WKSA ID can take: defined once, enforced, served.

A WKSA ID is the identifier a student is known by, never free text
(decision log, "2026-10-20 - The WKSA ID scheme"):

- a student ID, `NNN-N-NNN`: the school's prefix (`206-2` for Colchester,
  `KUKGRADE_SCHOOL_PREFIX`) and the student's three-digit number, issued by
  the school owner; a student who transferred in may hold another school's
  prefix in the same form;
- a black belt ID, `A-NNNNN`, issued by WKSA.

`Student.clean()` normalises and checks an ID against these forms, so the
API, Django admin and the roster import all apply them; the database refuses
anything else outright (`student_wksa_id_format`); and `/api/site/` serves the
forms, so the screens describe them without a copy of their own. KukGrade
records an ID it is given - it never invents one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings


@dataclass(frozen=True)
class IdForm:
    code: str
    label: str
    pattern: str

    def matches(self, value: str) -> bool:
        return re.fullmatch(self.pattern, value) is not None


STUDENT_ID = IdForm("student", "Student ID", "[0-9]{3}-[0-9]-[0-9]{3}")
BLACK_BELT_ID = IdForm("black_belt", "Black belt ID", "A-[0-9]{5}")
FORMS: tuple[IdForm, ...] = (STUDENT_ID, BLACK_BELT_ID)

# The same rule for the database's check constraint. The migration that adds
# the constraint holds its own copy of this literal, as migrations must.
DATABASE_PATTERN = "^(" + "|".join(form.pattern for form in FORMS) + ")$"

SCHOOL_PREFIX_PATTERN = "[0-9]{3}-[0-9]"


def normalise(value: object) -> str:
    """As typed, less surrounding space, with the black belt `A` upper-cased."""
    return str(value or "").strip().upper()


def form_of(value: str) -> IdForm | None:
    return next((form for form in FORMS if form.matches(value)), None)


def examples() -> dict[str, str]:
    return {
        STUDENT_ID.code: f"{settings.SCHOOL_ID_PREFIX}-150",
        BLACK_BELT_ID.code: "A-20819",
    }


def format_message() -> str:
    example = examples()
    return (
        f"Use a student ID such as {example[STUDENT_ID.code]} or a black belt "
        f"ID such as {example[BLACK_BELT_ID.code]}."
    )


def described() -> dict[str, Any]:
    """The forms as `/api/site/` serves them."""
    example = examples()
    return {
        "school_prefix": settings.SCHOOL_ID_PREFIX,
        "forms": [
            {
                "code": form.code,
                "label": form.label,
                "pattern": form.pattern,
                "example": example[form.code],
            }
            for form in FORMS
        ],
    }
