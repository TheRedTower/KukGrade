"""Searching a list the way a person types.

Every list's search box uses this one function, so they all behave alike:

- **Every word must be found**, each in any of the list's searchable text, in any
  order ("kim alex" finds Alex Kim).
- **Accents and case do not matter** ("jose" finds José).
- **A part of a word is found** ("spr" finds Spring), as it is typed.
- **A slip of the keyboard is forgiven** ("sprng", "Ayesha" for Aisha): a longer
  word of letters also matches a similar-looking word, using PostgreSQL's trigram
  matching. A word with a digit in it (an ID, a year, a date) is matched exactly.
- **The best matches come first**, when the list has no order the person chose.

What a list offers to search is whatever its screen shows: names and IDs, but
also the words for a status or a date ("locked", "october", "2026"), so what is
on the screen can be typed into the box. Each list names that text (`fields`):
a column, or an expression that builds the text a screen shows.

The matching is the database's (`pg_trgm` and `unaccent`, turned on by migration
accounts/0009), so a list is never searched in Python and a page is still a page.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from django.contrib.postgres.lookups import Unaccent
from django.contrib.postgres.search import TrigramWordSimilarity
from django.db.models import (
    Case,
    CharField,
    ExpressionWrapper,
    F,
    FloatField,
    Func,
    Q,
    QuerySet,
    TextField,
    Value,
    When,
)
from django.db.models.expressions import Combinable
from django.db.models.functions import Cast, Coalesce, Concat, Greatest

from kukgrade.filtering import QueryFilter

type SearchField = str | Combinable

# A person types a few words; more than this is a paste, not a search.
MAX_WORDS = 8
# Below this a word is matched as typed, never by likeness: "an" is like too much.
FUZZY_FROM = 4


def _may_be_fuzzy(word: str) -> bool:
    """Only a word of letters is matched by likeness. An ID, a year or a date is
    exact: 123-4-150 is not "like" 123-4-151, it is someone else."""
    return len(word) >= FUZZY_FROM and not any(char.isdigit() for char in word)


# How alike two words must look to count. pg_trgm's word similarity runs 0 to 1:
# "jonh" and "john" score 0.4, "sprng" and "spring" 0.5, "hartly" and "hartley" 0.71.
MINIMUM_LIKENESS = 0.4


class ExactOnly:
    """Text matched as typed and never by likeness: prose, where a word being like
    another word ("student" and "students", "granted" and "granted") is noise, not
    a slip of the keyboard. Names and titles are not wrapped in it."""

    def __init__(self, field: SearchField) -> None:
        self.field = field


def _text(field: SearchField | ExactOnly) -> Combinable:
    """The field as plain, unaccented text, empty when there is none."""
    if isinstance(field, ExactOnly):
        field = field.field
    expression = F(field) if isinstance(field, str) else field
    return Unaccent(
        Coalesce(
            Cast(expression, TextField()),
            Value("", output_field=TextField()),
            output_field=TextField(),
        ),
    )


def label_of(field: str, choices: Sequence[tuple[str, str]]) -> Combinable:
    """The word a screen shows for a coded column, such as a status."""
    return Case(
        *[When(**{field: code}, then=Value(label)) for code, label in choices],
        default=Value(""),
        output_field=CharField(),
    )


def full_name_of(first: str = "first_name", last: str = "last_name") -> Combinable:
    """A person's name as one piece of text, the database's form of a model's
    `full_name`, so "alex kim" and "kim alex" are both read against the whole."""
    return Concat(first, Value(" "), last, output_field=CharField())


def date_words(field: str) -> Combinable:
    """A date as the ways it is read: "25 October 2026", "2026-10-25", "25/10/2026".

    So "october", "2026", "25 oct" and an ISO date all find it.
    """

    def formatted(pattern: str) -> Combinable:
        return Func(
            F(field),
            Value(pattern),
            function="to_char",
            output_field=CharField(),
        )

    return Concat(
        formatted("FMDD FMMonth YYYY"),
        Value(" "),
        formatted("YYYY-MM-DD"),
        Value(" "),
        formatted("DD/MM/YYYY"),
        output_field=CharField(),
    )


def squashed(field: SearchField) -> Combinable:
    """Letters and digits only, so an ID is found without its hyphens."""
    expression = F(field) if isinstance(field, str) else field
    return Func(
        Cast(expression, TextField()),
        Value("[^A-Za-z0-9]"),
        Value(""),
        Value("g"),
        function="regexp_replace",
        output_field=CharField(),
    )


def words_of(term: str) -> list[str]:
    return term.split()[:MAX_WORDS]


def apply_search(
    queryset: QuerySet[Any],
    term: str,
    fields: Sequence[SearchField | ExactOnly],
) -> QuerySet[Any]:
    """The rows matching every word of `term`, best matches first."""
    words = words_of(term)
    if not words or not fields:
        return queryset
    texts = {f"_search_text_{i}": _text(field) for i, field in enumerate(fields)}
    exact_only = {
        f"_search_text_{i}"
        for i, field in enumerate(fields)
        if isinstance(field, ExactOnly)
    }
    queryset = queryset.annotate(**texts)

    condition = Q()
    rank: Combinable | None = None
    for position, word in enumerate(words):
        wanted = Unaccent(Value(word))
        any_field = Q()
        likeness: list[Combinable] = []
        for place, alias in enumerate(texts):
            # An earlier field is the more important one: a title beats a note.
            weight = 1.0 - 0.02 * place
            any_field |= Q(**{f"{alias}__icontains": wanted})
            if _may_be_fuzzy(word) and alias not in exact_only:
                similar = TrigramWordSimilarity(word, alias)
                queryset = queryset.annotate(
                    **{f"_search_like_{position}_{alias}": similar},
                )
                any_field |= Q(
                    **{f"_search_like_{position}_{alias}__gte": MINIMUM_LIKENESS},
                )
                likeness.append(
                    ExpressionWrapper(
                        F(f"_search_like_{position}_{alias}") * Value(weight),
                        output_field=FloatField(),
                    ),
                )
            else:
                likeness.append(
                    Case(
                        When(Q(**{f"{alias}__icontains": wanted}), then=Value(weight)),
                        default=Value(0.0),
                        output_field=FloatField(),
                    ),
                )
        condition &= any_field
        best = likeness[0] if len(likeness) == 1 else Greatest(*likeness)
        rank = best if rank is None else rank + best
    queryset = queryset.filter(condition)
    # Best first, then the list's own order, which keeps ties steady.
    ranked: QuerySet[Any] = queryset.annotate(_search_rank=rank)
    return ranked.order_by("-_search_rank", *queryset.query.order_by)


def search(
    name: str,
    fields: Sequence[SearchField | ExactOnly],
    description: str = "",
) -> QueryFilter:
    """A list's search box: `?name=words`, over the text in `fields`."""

    def apply(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
        return apply_search(queryset, value, fields)

    return QueryFilter(
        name,
        apply,
        description=(
            description
            or "Every word must be found, in any order, ignoring accents and case; "
            "a part of a word counts, and a close misspelling is forgiven."
        ),
    )
