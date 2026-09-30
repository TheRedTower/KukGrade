from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db.models import (
    F,
    Func,
    IntegerField,
    QuerySet,
    Value,
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


def students_in_age_band(
    students: QuerySet[Student],
    band: str,
    on_date: date,
) -> QuerySet[Student]:
    """The students `resolve_age_band` would place in `band` on `on_date`.

    Postgres `age()` counts a 29 February birthday as reached on 1 March in
    a common year, the same rule `calculate_age_on` applies.
    """
    youngest = 0
    for candidate, oldest in _AGE_BAND_MAX_AGE.items():
        if candidate == band:
            break
        youngest = (oldest or 0) + 1
    oldest = _AGE_BAND_MAX_AGE[band]
    years = Func(
        Value("year"),
        Func(Value(on_date), F("date_of_birth"), function="age"),
        function="date_part",
        output_field=IntegerField(),
    )
    bounded = students.annotate(age_on_date=years).filter(age_on_date__gte=youngest)
    return bounded if oldest is None else bounded.filter(age_on_date__lte=oldest)
