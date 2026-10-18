from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db.models import (
    Case,
    CharField,
    F,
    Func,
    IntegerField,
    QuerySet,
    Value,
    When,
)

from students.models import Student
from syllabus.models import AgeBand

# Each age band's oldest age, in ascending order. None means unbounded.
_AGE_BAND_MAX_AGE: dict[str, int | None] = {
    AgeBand.AGE_8_AND_UNDER: 8,
    AgeBand.AGE_9_TO_12: 12,
    AgeBand.AGE_13_TO_17: 17,
    AgeBand.AGE_18_AND_OVER: None,
}


def calculate_age_on(date_of_birth: date, on_date: date) -> int:
    age = on_date.year - date_of_birth.year
    try:
        birthday_this_year = date(on_date.year, date_of_birth.month, date_of_birth.day)
    except ValueError:
        birthday_this_year = date(on_date.year, 3, 1)
    if on_date < birthday_this_year:
        age -= 1
    return age


def resolve_age_band(date_of_birth: date | None, grading_date: date) -> str:
    if date_of_birth is None:
        raise ValidationError({"student": ["Student date of birth is required."]})
    age = calculate_age_on(date_of_birth, grading_date)
    for band, oldest in _AGE_BAND_MAX_AGE.items():
        if oldest is None or age <= oldest:
            return band
    raise AssertionError("_AGE_BAND_MAX_AGE has no open-ended band")


def _age_in_years_on(on_date: date) -> Func:
    # Postgres `age()` counts a 29 February birthday as reached on 1 March in
    # a common year, the same rule `calculate_age_on` applies.
    return Func(
        Value("year"),
        Func(Value(on_date), F("date_of_birth"), function="age"),
        function="date_part",
        output_field=IntegerField(),
    )


def with_age_band_on(students: QuerySet[Student], on_date: date) -> QuerySet[Student]:
    """`students` annotated with `age_band_on_date`: their band on `on_date`.

    The band `resolve_age_band` gives, worked out in the query, so a page of
    students is banded - and filtered by band - without one row at a time.
    """
    band = Case(
        *(
            When(age_in_years__lte=oldest, then=Value(band))
            for band, oldest in _AGE_BAND_MAX_AGE.items()
            if oldest is not None
        ),
        default=Value(AgeBand.AGE_18_AND_OVER),
        output_field=CharField(),
    )
    return students.annotate(age_in_years=_age_in_years_on(on_date)).annotate(
        age_band_on_date=band,
    )


def students_in_age_band(
    students: QuerySet[Student],
    band: str,
    on_date: date,
) -> QuerySet[Student]:
    """The students `resolve_age_band` would place in `band` on `on_date`."""
    # Keyword by dict: the stubs cannot see an annotation added in a helper.
    return with_age_band_on(students, on_date).filter(**{"age_band_on_date": band})
