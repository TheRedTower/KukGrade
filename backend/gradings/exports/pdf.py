"""The page every export is printed on, and the text that goes on it.

One A4 frame for every document: the club and the document's name at the top
of each page, with whose pages they are; at the foot, when and by whom the file
was made, its state (Final, Provisional) and "Page n of N". A document is a
run of parts - one per candidate's record, or one for a summary - and each part
counts its own pages, so a record read on its own says "Page 2 of 3" whatever
came before it in the file. The school's paper form keeps its own look: only
a small foot naming the grading and the day it was printed. A demo file says
so at the top and foot of every page.

Everything typed by a person reaches the page through `markup` or `plain`:
ReportLab reads `<b>` and `&` in a paragraph as markup, and the typeface has no
hanja or emoji, so text is escaped, normalised, and shows a character it cannot
draw as a visible box rather than a blank. Greyscale throughout, nothing below
9 points, so it prints cheaply and reads on any printer.
"""

from __future__ import annotations

import functools
import io
import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from django.conf import settings
from django.http import HttpResponse
from django.utils import dateformat, timezone
from django.utils.http import content_disposition_header
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

FONTS = Path(__file__).resolve().parent / "fonts"
REGULAR = "Pretendard"
# SemiBold, not Bold: headings that stand out without weighing on the page.
BOLD = "Pretendard-SemiBold"
# Drawn in place of a character the typeface does not have (hanja, emoji).
MISSING = "□"

INK = HexColor("#111111")
MUTED = HexColor("#444444")
RULE = HexColor("#888888")

PAGE_WIDTH, PAGE_HEIGHT = A4
SIDE = 15 * mm
TOP = 22 * mm
BOTTOM = 20 * mm
WIDTH = PAGE_WIDTH - 2 * SIDE

DEMO_BAND = "DEMO – MADE-UP DATA"

BODY = ParagraphStyle("body", fontName=REGULAR, fontSize=9.5, leading=13, textColor=INK)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=9, leading=12)
NOTE = ParagraphStyle("note", parent=SMALL, textColor=MUTED)
TITLE = ParagraphStyle("title", parent=BODY, fontName=BOLD, fontSize=16, leading=20)
LABEL = ParagraphStyle("label", parent=SMALL, textColor=MUTED)
STAMP = ParagraphStyle(
    "stamp", parent=BODY, fontName=BOLD, fontSize=11, leading=14, alignment=1
)
# The thinnest rule drawn: a pixel on screen, and still printed.
HAIRLINE = 0.75
HEADING = ParagraphStyle(
    "heading",
    parent=BODY,
    fontName=BOLD,
    fontSize=10.5,
    leading=14,
    spaceBefore=9,
    spaceAfter=3,
    keepWithNext=1,
)


@functools.cache
def _typeface() -> TTFont:
    """Registers Pretendard, regular and semibold, once per process.

    Reading the files takes most of a second, so it is done on the first
    export, not at start-up, and never again.
    """
    regular = TTFont(REGULAR, str(FONTS / "Pretendard-Regular.ttf"))
    pdfmetrics.registerFont(regular)
    pdfmetrics.registerFont(TTFont(BOLD, str(FONTS / "Pretendard-SemiBold.ttf")))
    pdfmetrics.registerFontFamily(
        REGULAR, normal=REGULAR, bold=BOLD, italic=REGULAR, boldItalic=BOLD
    )
    return regular


# Control characters print as nothing useful; a tab is a space; lines stay.
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def plain(value: object) -> str:
    """Typed text as it can be printed: composed accents, no control
    characters, and a box for each character the typeface cannot draw."""
    text = unicodedata.normalize("NFC", str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = _CONTROL.sub("", text)
    glyphs = _typeface().face.charToGlyph
    return "".join(
        char if char == "\n" or ord(char) in glyphs else MISSING for char in text
    )


def markup(value: object) -> str:
    """`plain` text escaped for a paragraph, its lines kept."""
    return escape(plain(value)).replace("\n", "<br/>")


def paragraph(value: object, style: ParagraphStyle = BODY) -> Paragraph:
    """Typed text as a paragraph of its own."""
    return Paragraph(markup(value), style)


def bold(value: object, style: ParagraphStyle = BODY) -> Paragraph:
    """Typed text, in bold."""
    return Paragraph(f"<b>{markup(value)}</b>", style)


def facts(rows: Sequence[tuple[str, object]], label_width: float = 38 * mm) -> Table:
    """Label and value, one pair to a line; the values are typed text."""
    table = Table(
        [[paragraph(label, LABEL), paragraph(value)] for label, value in rows],
        colWidths=[label_width, WIDTH - label_width],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ],
        ),
    )
    return table


def title_block(lines: Sequence[Flowable], stamp: str) -> Table:
    """The document's title lines, with its state stamped in a box beside
    them: FINAL RECORD, PROVISIONAL."""
    box = Table([[Paragraph(markup(stamp), STAMP)]], colWidths=[46 * mm])
    box.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1.5, INK),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )
    table = Table([[list(lines), box]], colWidths=[WIDTH - 50 * mm, 50 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ],
        ),
    )
    return table


def signature(master: str) -> Table:
    """A line for the Master to sign and one to date, the deciding Master
    named under the first once the decision is recorded."""
    signed = f"Signed · Master: {master}" if master else "Signed · Master:"
    table = Table(
        [["", "", ""], [paragraph(signed, LABEL), "", paragraph("Date", LABEL)]],
        colWidths=[WIDTH * 0.6, WIDTH * 0.08, WIDTH * 0.32],
        rowHeights=[14 * mm, None],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (0, 0), HAIRLINE, INK),
                ("LINEBELOW", (2, 0), (2, 0), HAIRLINE, INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ],
        ),
    )
    return table


def gap(height: float = 4 * mm) -> Spacer:
    return Spacer(WIDTH, height)


def day(value: date) -> str:
    """A date as the screens and the audit log write it: "25 Oct 2026"."""
    return dateformat.format(value, "j M Y")


def moment(value: datetime) -> str:
    """A time in the club's time zone: "25 Oct 2026, 11:42"."""
    return dateformat.format(timezone.localtime(value), "j M Y, H:i")


@dataclass(frozen=True)
class Part:
    """A run of pages with its own running heading and page count."""

    heading: str
    state: str
    story: Sequence[Flowable]


@dataclass(frozen=True)
class Document:
    """What one file holds: its name, what kind of document it is, who made
    it, and its parts, each starting on a new page."""

    file_name: str
    kind: str
    made_by: str
    parts: Sequence[Part]
    demo: bool = False
    # The school's own paper form: no running heading or page count, only a
    # small foot with the part's heading and the day it was printed.
    form: bool = False


class _PartStart(Flowable):
    """Marks the page a part begins on; draws nothing."""

    def __init__(self, index: int) -> None:
        super().__init__()
        self.index = index

    def wrap(self, *_args: Any) -> tuple[float, float]:
        return (0, 0)

    def draw(self) -> None:
        # Read when the page is shown, so the page knows whose it is.
        self.canv._kukgrade_part = self.index  # type: ignore[attr-defined]


class _Pages(Canvas):
    """Holds every page until the end, so each can say "Page n of N" for its
    own part, then draws the running heading and foot on all of them."""

    def __init__(
        self, *args: Any, document: Document, made_at: datetime, **kwargs: Any
    ):
        super().__init__(*args, **kwargs)
        self._document = document
        self._made_at = made_at
        self._kukgrade_part = 0
        self._held: list[tuple[dict[str, Any], int]] = []

    def showPage(self) -> None:  # noqa: N802 - ReportLab's name
        self._held.append((dict(self.__dict__), self._kukgrade_part))
        self._startPage()  # type: ignore[attr-defined]  # ReportLab's own reset

    def save(self) -> None:
        totals = Counter(part for _state, part in self._held)
        seen: Counter[int] = Counter()
        for state, part in self._held:
            self.__dict__.update(state)
            seen[part] += 1
            self._frame(self._document.parts[part], seen[part], totals[part])
            super().showPage()
        super().save()

    def _frame(self, part: Part, number: int, total: int) -> None:
        document = self._document
        self.saveState()
        self.setFillColor(MUTED)
        self.setStrokeColor(INK)
        self.setLineWidth(0.75)
        if document.demo:
            for y in (PAGE_HEIGHT - 7 * mm, 5 * mm):
                _band(self, y)
            self.setFillColor(MUTED)
            self.setStrokeColor(INK)
            self.setLineWidth(0.75)
        foot = 11 * mm
        if document.form:
            printed = day(timezone.localtime(self._made_at).date())
            _pair(self, foot, part.heading, f"Printed {printed}")
            self.restoreState()
            return
        top = PAGE_HEIGHT - 13 * mm
        _pair(
            self,
            top,
            f"{settings.CLUB_NAME} · {document.kind}",
            part.heading,
        )
        self.line(SIDE, top - 2.5 * mm, PAGE_WIDTH - SIDE, top - 2.5 * mm)
        self.line(SIDE, foot + 4 * mm, PAGE_WIDTH - SIDE, foot + 4 * mm)
        _pair(
            self,
            foot,
            f"Made {moment(self._made_at)} by {document.made_by} · {part.state}",
            f"Page {number} of {total}",
        )
        self.restoreState()


def _fit(text: str, width: float, size: float, font: str = REGULAR) -> str:
    """`text` shortened with an ellipsis until it fits `width`."""
    if pdfmetrics.stringWidth(text, font, size) <= width:
        return text
    while text and pdfmetrics.stringWidth(f"{text}…", font, size) > width:
        text = text[:-1]
    return f"{text.rstrip()}…"


def _pair(canvas: Canvas, y: float, left: str, right: str, size: float = 9) -> None:
    """One line across the page: `left` at the start, `right` at the end."""
    right = _fit(plain(right), WIDTH / 2, size)
    room = WIDTH - pdfmetrics.stringWidth(right, REGULAR, size) - 6 * mm
    canvas.setFont(REGULAR, size)
    canvas.drawString(SIDE, y, _fit(plain(left), room, size))
    canvas.drawRightString(PAGE_WIDTH - SIDE, y, right)


def _band(canvas: Canvas, y: float) -> None:
    """The demo's warning, ruled above and below, across the page."""
    canvas.setFillColor(INK)
    canvas.setStrokeColor(INK)
    canvas.setFont(BOLD, 9)
    canvas.drawCentredString(PAGE_WIDTH / 2, y, DEMO_BAND)
    canvas.line(SIDE, y + 3.5 * mm, PAGE_WIDTH - SIDE, y + 3.5 * mm)
    canvas.line(SIDE, y - 1.5 * mm, PAGE_WIDTH - SIDE, y - 1.5 * mm)


def build(document: Document, *, made_at: datetime | None = None) -> bytes:
    """The document as a PDF file, made in memory.

    Invariant, so the same record made at the same moment is the same file:
    nothing in it depends on when ReportLab ran, only on what it printed.
    """
    _typeface()
    buffer = io.BytesIO()
    template = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=SIDE,
        rightMargin=SIDE,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title=document.file_name.removesuffix(".pdf"),
        author="KukGrade",
        creator="KukGrade",
        lang="en",
        invariant=True,
    )
    frame = Frame(SIDE, BOTTOM, WIDTH, PAGE_HEIGHT - TOP - BOTTOM, id="page")
    template.addPageTemplates([PageTemplate(id="page", frames=[frame])])
    story: list[Flowable] = []
    for index, part in enumerate(document.parts):
        if index:
            story.append(PageBreak())
        story.append(_PartStart(index))
        story.extend(part.story)
    template.build(
        story,
        canvasmaker=functools.partial(
            _Pages, document=document, made_at=made_at or timezone.now()
        ),
    )
    return buffer.getvalue()


# What a file name cannot hold on Windows, macOS or Linux, and control codes.
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
TITLE_LENGTH = 80


def _safe(text: str, length: int = TITLE_LENGTH) -> str:
    cleaned = _UNSAFE.sub("-", " ".join(plain(text).split()))
    return cleaned[:length].rstrip()


def file_name(grading_date: date, title: str, document: str, name: str = "") -> str:
    """A name a person reads and a folder sorts by date:
    "2026-10-25 October grading – Juniors – Record – Jane Smith.pdf"."""
    parts = [f"{grading_date.isoformat()} {_safe(title)}", document]
    if name:
        parts.append(_safe(name))
    return " – ".join(parts) + ".pdf"


def response(document: Document, content: bytes) -> HttpResponse:
    """The file as a download. Never cached: it holds personal data."""
    answer = HttpResponse(content, content_type="application/pdf")
    disposition = content_disposition_header(True, document.file_name)
    answer["Content-Disposition"] = disposition or "attachment"
    answer["Cache-Control"] = "no-store"
    return answer
