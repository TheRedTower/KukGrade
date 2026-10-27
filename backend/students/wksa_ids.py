"""The two forms a WKSA ID can take: defined once, enforced, served.

A WKSA ID is the identifier a student is known by, never free text:

- a student ID, `NNN-N-NNN`: the school's prefix (`206-2` for Colchester,
  `KUKGRADE_SCHOOL_PREFIX`) and the student's three-digit number, issued by
  the school owner; a student who transferred in may hold another school's
  prefix in the same form;
- a black belt ID, `A-NNNNN`, issued by WKSA.

A student at a black belt rank (JKN and above, `Rank.Category.BLACK_BELT`)
holds a black belt ID. WKSA hands it out at the national grading where they
are promoted, so it takes effect at once: their student ID is changed to it,
once, when their instructor next records it, and from then on it is theirs
for good - later ranks and certificates come under the same ID. A mistyped
ID of either form can be corrected (owner, 2026-10-20): a correction says
the old ID was never the student's, so it is not kept, only audited. The
student ID a black belt ID replaced is kept as one of the student's previous IDs
(`students.models.PreviousWksaId`): the school owner confirmed (2026-10-20)
that a number stays with its student for good and is never given to anyone
else, so no ID, current or previous, is ever held by two people - nor one whose
student was deleted (`students.models.RetiredWksaId`).

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


# A previous ID is always a student ID (see students.models.PreviousWksaId).
STUDENT_ID_DATABASE_PATTERN = "^" + STUDENT_ID.pattern + "$"


def normalise(value: object) -> str:
    """As typed, less surrounding space, with the black belt `A` upper-cased."""
    return str(value or "").strip().upper()


def form_of(value: str) -> IdForm | None:
    return next((form for form in FORMS if form.matches(value)), None)


BLACK_BELT_RANK_MESSAGE = "A black belt rank needs a black belt ID, such as A-20819."
BLACK_BELT_ID_FIXED_MESSAGE = "A black belt ID never goes back to a student ID."
PREVIOUS_ID_TAKEN_MESSAGE = (
    "That ID belonged to a student earlier. A number stays with its student and "
    "is never given to anyone else."
)


def can_change(wksa_id: str) -> bool:
    """Whether the change to a black belt ID is still to come: the ID is a
    student ID. Either form can still be corrected (see change_refusal)."""
    return form_of(wksa_id) is STUDENT_ID


def is_black_belt_change(current: str, new: str) -> bool:
    """A student ID becoming the black belt ID WKSA handed out - the change
    after which the old ID is kept as the student's previous ID. Any other
    change of ID is the correction of a mistyped one (owner, 2026-10-20)."""
    return form_of(current) is STUDENT_ID and form_of(new) is BLACK_BELT_ID


def change_refusal(current: str, new: str) -> str | None:
    """Why `current` may not become `new`, or None if it may.

    A mistyped ID may be corrected to another of the same form, and a
    student ID becomes the black belt ID; a black belt ID never goes back to
    a student ID.
    """
    if current == new:
        return None
    if form_of(current) is BLACK_BELT_ID and form_of(new) is STUDENT_ID:
        return BLACK_BELT_ID_FIXED_MESSAGE
    return None


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
    """The forms as `/api/site/` serves them, with the sentence that states
    the rule - the same one a refused ID is told - so a screen shows it
    rather than writing its own."""
    example = examples()
    return {
        "hint": format_message(),
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
