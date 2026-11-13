"""Grading sheets: the school's paper grading form, filled in for each
registered candidate, printed when a grading is prepared.

One page per candidate, always exactly one: the candidate's name and WKSA ID,
the rank they hold and the testing date on the lines; the six core grading
areas their age band's chart examines through the rank they are testing for,
each with a Pass and a Fail box; and a Subject and Comments table in two tall
blocks filling the rest of the page. The marks are made on paper and never
typed into the app. No grey fills, and no version number: the form is frozen.
Headed as the paper form is, with a small foot naming the grading and the day
it was printed; a demo sheet still says so at the top and foot.
"""

from __future__ import annotations

from functools import cache
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Table, TableStyle

from accounts.models import User
from audit.models import AuditAction
from audit.recording import student_label
from gradings.exports import pdf
from gradings.exports.making import (
    Exported,
    audit_export,
    chosen_candidates,
    made_by,
    snapshot,
)
from gradings.models import GradingCandidate, GradingSession
from ranks.models import Rank
from syllabus.models import CORE_CATEGORIES
from syllabus.services import effective_syllabus_requirements

KIND = "Grading sheet"
NOT_OPEN = "Grading sheets are printed before a grading is locked."
WITHDRAWN = "This candidate has been withdrawn."

FORM_TITLE = ParagraphStyle(
    "form-title", parent=pdf.TITLE, alignment=1, fontSize=18, leading=22
)
FORM_CLUB = ParagraphStyle("form-club", parent=pdf.BODY, alignment=1, fontSize=11)
CENTRED = ParagraphStyle("centred", parent=pdf.SMALL, alignment=1)
HEADER = ParagraphStyle("form-header", parent=pdf.BODY, fontName=pdf.BOLD)
# A box to tick, as on the paper form.
BOX = "□"


def sheets_can_be_printed(session: GradingSession) -> bool:
    """Draft or open: the grading is still being prepared or held."""
    return session.roster_open


def sheet_can_be_printed(candidate: GradingCandidate) -> bool:
    """Registered, not withdrawn, in a grading still being prepared or held."""
    return (
        sheets_can_be_printed(candidate.session)
        and candidate.status != GradingCandidate.Status.WITHDRAWN
    )


def _refusal(candidate: GradingCandidate) -> str | None:
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        return WITHDRAWN
    return None


def export_sheets(
    session: GradingSession,
    candidate_ids: list[int],
    actor: User,
) -> Exported:
    """A grading sheet for each candidate chosen, as one PDF, all or
    nothing; one audit event for the file."""
    with snapshot():
        current = GradingSession.objects.get(pk=session.pk)
        if not sheets_can_be_printed(current):
            raise ValidationError({"session": [NOT_OPEN]})
        candidates = chosen_candidates(
            current,
            candidate_ids,
            GradingCandidate.objects.select_related(
                "student", "from_rank", "testing_for_rank"
            ),
            _refusal,
        )
        core = cache(_core_areas)
        document = pdf.Document(
            file_name=pdf.file_name(
                current.grading_date, current.title, "Grading sheets"
            ),
            kind=KIND,
            made_by=made_by(actor),
            parts=[
                pdf.Part(
                    heading=current.title,
                    # A blank form has no state; its foot is the form's own.
                    state="",
                    story=_sheet(
                        current,
                        candidate,
                        core(candidate.testing_for_rank, candidate.age_band),
                    ),
                )
                for candidate in candidates
            ],
            demo=settings.DEMO_MODE,
            form=True,
        )
        content = pdf.build(document, made_at=timezone.now())
        if len(candidates) == 1:
            held = f"Grading sheet for {student_label(candidates[0].student)}"
        else:
            held = f"Grading sheets for {len(candidates)} candidates"
        audit_export(
            AuditAction.GRADING_SHEETS_PRINTED,
            current,
            f"{held} printed from grading session '{current.title}'.",
            candidates,
            actor,
        )
    return Exported(document, content)


def _core_areas(rank: Rank, age_band: str) -> list[tuple[str, str]]:
    """The core areas the age band's chart examines through `rank`, by name
    and Korean name, in syllabus order - from the syllabus, never written
    here."""
    return [
        (row.requirement.item.name, row.requirement.item.korean_name)
        for row in effective_syllabus_requirements(rank=rank, age_band=age_band)
        if row.requirement.item.category in CORE_CATEGORIES
    ]


def _sheet(
    session: GradingSession,
    candidate: GradingCandidate,
    core: list[tuple[str, str]],
) -> list[Flowable]:
    student = candidate.student
    story: list[Flowable] = [
        pdf.paragraph("Grading Form", FORM_TITLE),
        pdf.paragraph(settings.CLUB_NAME, FORM_CLUB),
        pdf.gap(6 * mm),
        _lines(
            [
                ("Student's Name", f"{student.full_name} · {student.wksa_id}"),
                ("Current Rank", candidate.from_rank.name),
                ("Testing date", pdf.day(session.grading_date)),
            ]
        ),
        pdf.gap(6 * mm),
    ]
    if core:
        story += [_core_boxes(core), pdf.gap(6 * mm)]
    story.append(_Comments())
    return story


def _lines(rows: list[tuple[str, str]]) -> Table:
    """Each label with its value written on a line, as on the paper form."""
    label_width = 34 * mm
    table = Table(
        [
            [pdf.paragraph(label, pdf.LABEL), pdf.paragraph(value)]
            for label, value in rows
        ],
        colWidths=[label_width, pdf.WIDTH - label_width],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("LINEBELOW", (1, 0), (1, -1), pdf.HAIRLINE, pdf.INK),
                ("LEFTPADDING", (0, 0), (0, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ],
        ),
    )
    return table


def _core_boxes(core: list[tuple[str, str]]) -> Table:
    """The core areas side by side, each with a Pass and a Fail box."""
    width = pdf.WIDTH / len(core)
    heads = [
        [pdf.bold(name, CENTRED), pdf.paragraph(korean, CENTRED)]
        for name, korean in core
    ]
    boxes = [pdf.paragraph(f"P {BOX}    F {BOX}", CENTRED)] * len(core)
    table = Table([heads, boxes], colWidths=[width] * len(core))
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), pdf.HAIRLINE, pdf.INK),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 1), (-1, 1), 6),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
            ],
        ),
    )
    return table


class _Comments(Flowable):
    """Subject and Comments, in two tall blocks filling what is left of the
    page, so the sheet is always one page whatever stood above it."""

    _SUBJECT = 40 * mm

    def wrap(self, avail_width: float, avail_height: float) -> tuple[float, float]:
        header = 8 * mm
        # A point short of the room, so rounding never pushes it over.
        block = (avail_height - 2 * header - 1) / 2
        rows: list[list[object]] = []
        for _block in range(2):
            rows += [
                [pdf.paragraph("Subject", HEADER), pdf.paragraph("Comments", HEADER)],
                ["", ""],
            ]
        self._table = Table(
            rows,
            colWidths=[self._SUBJECT, avail_width - self._SUBJECT],
            rowHeights=[header, block] * 2,
        )
        self._table.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), pdf.HAIRLINE, pdf.INK),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ],
            ),
        )
        width, height = self._table.wrap(avail_width, avail_height)
        self.width, self.height = width, height
        return width, height

    def draw(self) -> None:
        self._table.drawOn(self.canv, 0, 0)

    def split(self, *_args: Any) -> list[Flowable]:
        # Never split: it is sized to the page it lands on.
        return []
