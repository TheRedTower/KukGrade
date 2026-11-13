"""The page every export is printed on (gradings.exports.pdf)."""

from __future__ import annotations

import io
from datetime import UTC, date, datetime

import pytest
from django.test import override_settings
from pypdf import PdfReader

from gradings.exports import pdf

MADE = datetime(2026, 10, 25, 10, 5, tzinfo=UTC)


def pages(content: bytes) -> list[str]:
    return [page.extract_text() for page in PdfReader(io.BytesIO(content)).pages]


def document(*parts: pdf.Part, demo: bool = False) -> pdf.Document:
    return pdf.Document(
        file_name="2026-10-25 Spring grading – Summary.pdf",
        kind="Grading record",
        made_by="KSN Jane Smith",
        parts=parts,
        demo=demo,
    )


def part(heading: str, lines: int, state: str = "Final record") -> pdf.Part:
    return pdf.Part(
        heading=heading,
        state=state,
        story=[pdf.paragraph(f"{heading} line {n}") for n in range(lines)],
    )


def test_typed_text_prints_composed_and_boxes_what_the_typeface_lacks() -> None:
    assert pdf.plain("José") == "José"
    assert pdf.plain("a\x00b\x1bc\td\r\ne") == "abc d\ne"
    assert pdf.plain("예의 기초짜기") == "예의 기초짜기"
    assert pdf.plain("國術 😀") == f"{pdf.MISSING}{pdf.MISSING} {pdf.MISSING}"


def test_typed_markup_prints_as_the_words_typed() -> None:
    typed = "<b>not bold</b> & <font size=40>big</font>\nsecond line"

    assert pdf.markup(typed) == (
        "&lt;b&gt;not bold&lt;/b&gt; &amp; &lt;font size=40&gt;big&lt;/font&gt;"
        "<br/>second line"
    )
    [text] = pages(
        pdf.build(
            document(
                pdf.Part(
                    "Jane",
                    "Final record",
                    [
                        pdf.paragraph(typed),
                    ],
                )
            ),
            made_at=MADE,
        )
    )
    assert "<b>not bold</b> & <font size=40>big</font>" in text
    assert "second line" in text


def test_a_word_too_long_for_a_line_is_broken_inside_the_page() -> None:
    word = "x" * 400

    [text] = pages(
        pdf.build(document(pdf.Part("Jane", "Final", [pdf.paragraph(word)])))
    )

    broken = [line for line in text.splitlines() if set(line) == {"x"}]
    assert len(broken) > 1
    assert sum(map(len, broken)) == len(word)


def test_each_part_counts_its_own_pages_under_its_own_heading() -> None:
    long_part = part("Priya Nair · 123-4-171", 90)
    short_part = part("Sam Okafor · 123-4-088", 3, state="Provisional")

    texts = pages(pdf.build(document(long_part, short_part), made_at=MADE))

    assert len(texts) == 3
    assert "Page 1 of 2" in texts[0] and "Priya Nair · 123-4-171" in texts[0]
    assert "Page 2 of 2" in texts[1] and "Priya Nair · 123-4-171" in texts[1]
    assert "Page 1 of 1" in texts[2] and "Sam Okafor · 123-4-088" in texts[2]
    assert "Sam Okafor · 123-4-088 line 0" in texts[2]
    assert "· Provisional" in texts[2] and "· Final record" in texts[0]


@override_settings(CLUB_NAME="KSW Colchester")
def test_every_page_names_the_club_the_document_its_maker_and_when() -> None:
    [text] = pages(pdf.build(document(part("Jane", 2)), made_at=MADE))

    assert "KSW Colchester · Grading record" in text
    # 25 Oct 2026 is the day London leaves summer time: 10:05 UTC is 10:05.
    assert "Made 25 Oct 2026, 10:05 by KSN Jane Smith · Final record" in text


def test_times_follow_the_clubs_clock_through_the_year() -> None:
    assert pdf.moment(datetime(2026, 7, 1, 10, 0, tzinfo=UTC)) == "1 Jul 2026, 11:00"
    assert pdf.moment(datetime(2026, 12, 1, 10, 0, tzinfo=UTC)) == "1 Dec 2026, 10:00"
    assert pdf.day(date(2026, 10, 5)) == "5 Oct 2026"


def test_a_demo_file_says_so_at_the_top_and_foot_of_every_page() -> None:
    demo = pages(pdf.build(document(part("Jane", 90), demo=True), made_at=MADE))
    real = pages(pdf.build(document(part("Jane", 90)), made_at=MADE))

    assert len(demo) == 2
    assert all(text.count(pdf.DEMO_BAND) == 2 for text in demo)
    assert not any(pdf.DEMO_BAND in text for text in real)


def test_the_same_document_made_at_the_same_moment_is_the_same_file() -> None:
    first = pdf.build(document(part("Jane", 5)), made_at=MADE)

    assert pdf.build(document(part("Jane", 5)), made_at=MADE) == first


def test_the_file_is_titled_by_its_name_and_made_by_kukgrade() -> None:
    reader = PdfReader(io.BytesIO(pdf.build(document(part("Jane", 1)), made_at=MADE)))

    assert reader.metadata is not None
    assert reader.metadata.title == "2026-10-25 Spring grading – Summary"
    assert reader.metadata.author == "KukGrade"


def test_a_heading_is_never_left_alone_at_the_foot_of_a_page() -> None:
    # Wherever the page ends, the heading and the line after it share a page.
    for filler in range(48, 60):
        story = [pdf.paragraph(f"filler {n}") for n in range(filler)]
        story += [pdf.paragraph("Techniques", pdf.HEADING), pdf.paragraph("first row")]
        texts = pages(
            pdf.build(document(pdf.Part("Jane", "Final", story)), made_at=MADE)
        )
        [where] = [text for text in texts if "Techniques" in text]
        assert "first row" in where, filler


@pytest.mark.parametrize(
    ("title", "document_name", "name", "expected"),
    [
        (
            "October grading – Juniors",
            "Records (12)",
            "",
            "2026-10-25 October grading – Juniors – Records (12).pdf",
        ),
        (
            "October grading – Juniors",
            "Record",
            "José Smith",
            "2026-10-25 October grading – Juniors – Record – José Smith.pdf",
        ),
        (
            'Juniors/Adults: "A" <B> | C?*\\',
            "Summary",
            "",
            "2026-10-25 Juniors-Adults- -A- -B- - C--- – Summary.pdf",
        ),
        (
            "  Spring\n  grading\t ",
            "Summary",
            "",
            "2026-10-25 Spring grading – Summary.pdf",
        ),
    ],
)
def test_file_names_read_plainly_and_sort_by_date(
    title: str, document_name: str, name: str, expected: str
) -> None:
    assert pdf.file_name(date(2026, 10, 25), title, document_name, name) == expected


def test_a_very_long_title_is_shortened_in_the_file_name() -> None:
    named = pdf.file_name(date(2026, 10, 25), "A" * 300, "Summary")

    assert named == f"2026-10-25 {'A' * pdf.TITLE_LENGTH} – Summary.pdf"


def test_the_file_downloads_under_its_name_and_is_never_cached() -> None:
    answer = pdf.response(
        pdf.Document(
            file_name="2026-10-25 Spring – Record – José.pdf",
            kind="Grading record",
            made_by="KSN Jane Smith",
            parts=[],
        ),
        b"%PDF-",
    )

    assert answer["Content-Type"] == "application/pdf"
    assert answer["Content-Disposition"] == (
        "attachment; filename*=utf-8''2026-10-25%20Spring%20%E2%80%93%20Record"
        "%20%E2%80%93%20Jos%C3%A9.pdf"
    )
    assert answer["Cache-Control"] == "no-store"
