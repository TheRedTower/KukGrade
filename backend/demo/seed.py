"""The made-up club the demo site shows.

Everything is built through the same services the application uses, so the
audit log, the assessment snapshots and the promotion ledger are the real
thing. Only two shortcuts are taken, both for speed: the bulk "all met"
result on an assessment that nobody is meant to look at closely, and
backdating of the finished gradings (the services stamp "now").

Dates are relative to today so the demo never looks stale, and the gradings
are built oldest first because a student may hold only one unsettled
registration at a time.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import Permission
from django.core.management.base import CommandError
from django.db import models, transaction
from django.utils import timezone

from accounts.models import User
from accounts.services import set_user_authority
from audit.models import AuditAction, AuditEvent
from audit.recording import record
from data_imports.models import ImportBatch
from demo.personas import DEMO_PASSWORD, PERSONA_EMAILS, PERSONAS
from gradings.assessment_services import (
    bulk_start_candidate_assessments,
    update_candidate_assessment,
    update_candidate_assessment_item,
)
from gradings.legacy_services import link_legacy_record_to_student
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    LegacyRecordKind,
    Promotion,
)
from gradings.outcome_services import (
    create_candidate_outcome,
    finalise_candidate_outcome,
    promote_candidate,
    propose_candidate_outcome,
)
from gradings.services import (
    apply_candidate_update,
    bulk_register_candidates,
    create_grading_session,
    transition_grading_session,
)
from ranks.models import Rank
from students.models import Student
from students.services import create_student

Status = GradingSession.Status
Result = CandidateAssessmentItem.Result
Verdict = CandidateOutcome.Outcome

DEMO_ONLY_MESSAGE = "Demo data can only be built when KUKGRADE_DEMO_MODE is on."
REAL_USERS_MESSAGE = (
    "This database has accounts that are not the demo's own, so it is not "
    "touched. Demo mode is for a database that holds only made-up data."
)

# First name, last name, age today, current rank. Ordered so that picking "the
# first student at a rank" is deterministic, and so each age band is spread
# across the ranks it normally holds.
ROSTER: tuple[tuple[str, str, int, str], ...] = (
    # 8 and under
    ("Leo", "Hartley", 6, "WHITE"),
    ("Maya", "Okafor", 7, "WHITE"),
    ("Noah", "Lindqvist", 6, "WHITE"),
    ("Isla", "Brennan", 8, "YELLOW_STRIPE"),
    ("Theo", "Marchetti", 7, "YELLOW_STRIPE"),
    ("Ruby", "Nakamura", 8, "YELLOW"),
    ("Oscar", "Fenwick", 7, "YELLOW"),
    ("Freya", "Adeyemi", 8, "BLUE_STRIPE"),
    # 9-12
    ("Ethan", "Caldwell", 9, "WHITE"),
    ("Priya", "Raman", 10, "WHITE"),
    ("Jack", "Sorensen", 9, "YELLOW_STRIPE"),
    ("Zara", "Whitfield", 11, "YELLOW_STRIPE"),
    ("Mateo", "Alvarez", 10, "YELLOW"),
    ("Amelia", "Doyle", 12, "YELLOW"),
    ("Harvey", "Ng", 11, "BLUE_STRIPE"),
    ("Lily", "Moreau", 12, "BLUE_STRIPE"),
    ("Samir", "Haddad", 10, "BLUE"),
    ("Chloe", "Barrett", 12, "BLUE"),
    ("Dylan", "Osei", 11, "RED_STRIPE"),
    ("Elena", "Petrova", 12, "RED"),
    # 13-17
    ("Kai", "Tanaka", 13, "YELLOW"),
    ("Grace", "Holloway", 14, "YELLOW"),
    ("Aaron", "Mbeki", 15, "BLUE_STRIPE"),
    ("Sophie", "Lang", 14, "BLUE_STRIPE"),
    ("Daniel", "Reyes", 16, "BLUE"),
    ("Hannah", "Cole", 15, "BLUE"),
    ("Marcus", "Ellery", 17, "RED_STRIPE"),
    ("Nadia", "Rahimi", 16, "RED"),
    ("Joel", "Prescott", 17, "RED"),
    ("Tessa", "Wren", 15, "BROWN_STRIPE"),
    # 18 and over
    ("Rachel", "Ashworth", 24, "WHITE"),
    ("Tom", "Gallagher", 31, "WHITE"),
    ("Anita", "Joshi", 28, "YELLOW_STRIPE"),
    ("Ben", "Kowalski", 35, "YELLOW_STRIPE"),
    ("Clara", "Voss", 42, "YELLOW"),
    ("Hugo", "Santos", 29, "YELLOW"),
    ("Imogen", "Pryce", 38, "BLUE_STRIPE"),
    ("Femi", "Balogun", 33, "BLUE_STRIPE"),
    ("Greta", "Lund", 45, "BLUE"),
    ("Victor", "Almeida", 27, "BLUE"),
    ("Sarah", "Whelan", 36, "RED_STRIPE"),
    ("Dev", "Kapoor", 30, "RED_STRIPE"),
    ("Monica", "Reeve", 41, "RED"),
    ("Paul", "Instone", 52, "RED"),
    ("Yuki", "Sato", 26, "BROWN_STRIPE"),
    ("Callum", "Fraser", 34, "BROWN_STRIPE"),
    ("Rosa", "Delgado", 39, "BROWN"),
    ("Martin", "Oyelaran", 47, "BROWN"),
    ("Helen", "Strand", 44, "BLACK_STRIPE"),
    ("Jonas", "Weber", 37, "DAHN_BO"),
    ("Lucia", "Ferrante", 32, "DAHN_BO"),
)

# Away from the club: a break, and one who has left. Neither can be picked for a
# grading (a break blocks nothing in the app; the demo just does not use them).
INACTIVE = (
    ("Owen", "Pascoe", 19, "YELLOW"),
    ("Beth", "Lacey", 40, "BLUE"),
)
LEFT = (("Rory", "Gillan", 23, "YELLOW_STRIPE"),)

POSITIVE_NOTES = (
    "Strong, clear and well timed.",
    "Good focus; kept form under pressure.",
    "Confident and well controlled.",
    "Excellent spirit throughout.",
    "Crisp technique, good balance.",
)
SHORTFALL_NOTES = (
    "Stance too narrow; needs more practice on balance.",
    "Hesitated and lost the sequence part way through.",
    "Kick not reaching target height yet.",
    "Timing uneven; rushed the second half.",
    "Needs to keep the guard up between techniques.",
)
OVERALL_NOTES = (
    "A solid grading with good effort throughout.",
    "Worked hard and showed real improvement since last time.",
    "Good attitude; a few areas to tidy up before the next grading.",
    "Consistent and well prepared.",
)


@dataclass
class Club:
    administrator: User
    instructor: User
    master: User
    busy: set[int] = field(default_factory=set)
    today: date = field(default_factory=timezone.localdate)


def assert_safe_to_build() -> None:
    """Refuse unless this is demo mode on a database of only demo accounts.

    Reset empties the students, gradings and audit tables; seeding publishes a
    password. Neither may ever happen on a club's real data, so a real
    database stops the start-up instead of being wiped.
    """
    if not settings.DEMO_MODE:
        raise CommandError(DEMO_ONLY_MESSAGE)
    others = User.objects.exclude(email__in=PERSONA_EMAILS).exclude(
        email="deleted-user@kukgrade.internal",
    )
    if others.exists():
        raise CommandError(REAL_USERS_MESSAGE)


def already_built() -> bool:
    return Student.objects.exists()


def local(day: date, hour: int = 12) -> datetime:
    return datetime.combine(
        day,
        time(hour),
        tzinfo=ZoneInfo(settings.TIME_ZONE),
    )


def ensure_personas() -> dict[str, User]:
    """The shared accounts, created on first use and otherwise left as they
    are, so a browser that is already signed in stays signed in across a reset.
    """
    accounts: dict[str, User] = {}
    for persona in PERSONAS:
        user = User.objects.filter(email=persona.email).first()
        if user is None:
            user = User.objects.create_user(
                persona.email,
                DEMO_PASSWORD,
                first_name=persona.first_name,
                last_name=persona.last_name,
                role=persona.role,
            )
        accounts[persona.key] = user
    return accounts


def grant_authority(accounts: dict[str, User]) -> None:
    """Record the Master's authority the way an administrator would, so the
    audit log shows who granted it. Cleared first so a reset records it again.
    """
    administrator = accounts["administrator"]
    for persona in PERSONAS:
        user = accounts[persona.key]
        record(
            AuditAction.USER_CREATED,
            user,
            f"Account created for {user.email}.",
            actor=administrator,
        )
        if persona.authority:
            user.user_permissions.remove(
                *Permission.objects.filter(
                    codename__in=[
                        "can_make_final_grading_decision",
                        "can_promote_student",
                        "can_override_locked_session",
                        "can_view_grading_audit_log",
                    ],
                ),
            )
            accounts[persona.key] = set_user_authority(
                user,
                administrator,
                **persona.authority,
            )


def birthday(today: date, age: int, index: int) -> date:
    """A date of birth giving `age` today, spread across the year."""
    base = today.replace(day=1) - timedelta(days=365 * age + (index * 37) % 300)
    return base


def create_students(club: Club) -> None:
    ranks = {rank.code: rank for rank in Rank.objects.all()}
    rows = [(*row, Student.Status.ACTIVE) for row in ROSTER]
    rows += [(*row, Student.Status.INACTIVE) for row in INACTIVE]
    rows += [(*row, Student.Status.LEFT) for row in LEFT]
    for index, (first, last, age, rank_code, status) in enumerate(rows, start=1):
        create_student(
            wksa_id=f"123-4-{index:03d}",
            first_name=first,
            last_name=last,
            date_of_birth=birthday(club.today, age, index),
            current_rank=ranks[rank_code],
            status=status,
            actor=club.administrator,
        )


def pick(club: Club, rank_code: str) -> Student:
    """The first active student at `rank_code` who is not in another grading."""
    found = (
        Student.objects.filter(
            status=Student.Status.ACTIVE,
            current_rank__code=rank_code,
        )
        .exclude(pk__in=club.busy)
        .order_by("pk")
        .first()
    )
    if found is None:
        msg = f"The demo roster has no free student at {rank_code}."
        raise CommandError(msg)
    club.busy.add(found.pk)
    return found


def open_cohort(
    club: Club,
    *,
    title: str,
    day: date,
    location: str,
    ranks: Sequence[str],
) -> tuple[GradingSession, list[GradingCandidate], list[CandidateAssessment]]:
    """A draft grading with its cohort registered and assessments generated."""
    session = create_grading_session(
        title=title,
        grading_date=day,
        location=location,
        notes="",
        created_by=club.instructor,
    )
    chosen = [pick(club, code) for code in ranks]
    created, errors = bulk_register_candidates(
        session=session,
        rows=[{"student": student} for student in chosen],
        actor=club.instructor,
        generate_assessments=True,
    )
    if errors:
        msg = f"The demo cohort for '{title}' could not be registered: {errors}"
        raise CommandError(msg)
    candidates = [candidate for candidate, _ in created]
    assessments = [built for _, built in created if built is not None]
    return session, candidates, assessments


def judge(
    assessment: CandidateAssessment,
    assessor: User,
    *,
    not_met: int = 0,
    share: float = 1.0,
    praised: int = 1,
) -> None:
    """Record results on an in-progress assessment.

    All but a few items are set in one write; the few that are not met (and a
    handful of met ones, so there are comments of both kinds) go through the
    service, which writes their audit events and keeps their notes.
    """
    items = list(assessment.items.filter(required=True).order_by("position", "pk"))
    items = items[: max(not_met + 4, round(len(items) * share))]
    for index, item in enumerate(items[:not_met]):
        update_candidate_assessment_item(
            item,
            result=Result.NOT_MET,
            assessor_notes=SHORTFALL_NOTES[index % len(SHORTFALL_NOTES)],
            assessor=assessor,
        )
    remaining = items[not_met:]
    for index, item in enumerate(remaining[:praised]):
        update_candidate_assessment_item(
            item,
            result=Result.MET,
            assessor_notes=POSITIVE_NOTES[index % len(POSITIVE_NOTES)],
            assessor=assessor,
        )
    CandidateAssessmentItem.objects.filter(
        pk__in=[item.pk for item in remaining[praised:]],
    ).update(result=Result.MET, assessor=assessor, assessed_at=timezone.now())


def complete(assessment: CandidateAssessment, assessor: User, note: str) -> None:
    update_candidate_assessment(assessment, notes=note, actor=assessor)
    update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.COMPLETED,
        actor=assessor,
    )


def assess_fully(
    assessments: Sequence[CandidateAssessment],
    club: Club,
    shortfalls: Sequence[int],
) -> None:
    """Start and complete each assessment; `shortfalls[i]` items are not met."""
    bulk_start_candidate_assessments(assessments=assessments, actor=club.instructor)
    for index, assessment in enumerate(assessments):
        judge(assessment, club.instructor, not_met=shortfalls[index])
        complete(
            assessment,
            club.instructor,
            OVERALL_NOTES[index % len(OVERALL_NOTES)],
        )


@dataclass(frozen=True)
class Decision:
    """What the instructor recommends and what the Master decides."""

    recommended: str | None
    final: str | None = None
    promote: bool = False
    requirements: str = ""


def decide(
    candidates: Sequence[GradingCandidate],
    decisions: Sequence[Decision],
    club: Club,
) -> None:
    for candidate, decision in zip(candidates, decisions, strict=True):
        outcome = create_candidate_outcome(candidate, club.instructor)
        if decision.recommended is None:
            continue
        outcome = propose_candidate_outcome(
            outcome,
            decision.recommended,
            "Recommendation after reviewing the full assessment.",
            club.instructor,
        )
        if decision.final is None:
            continue
        outcome = finalise_candidate_outcome(
            outcome,
            decision.final,
            (
                "Agreed with the recommendation."
                if decision.final == decision.recommended
                else "Decision differs from the recommendation after review."
            ),
            decision.requirements,
            club.master,
        )
        if decision.promote:
            promote_candidate(outcome, club.master)


def backdate(session: GradingSession, after_audit_id: int) -> None:
    """Move a finished grading's records to its own date.

    The services stamp "now". The queryset update is the same bypass the
    application's own clean-up services use for the guarded tables.
    """
    start = local(session.grading_date)
    events = AuditEvent.objects.filter(pk__gt=after_audit_id).order_by("pk")
    for offset, pk in enumerate(events.values_list("pk", flat=True)):
        models.QuerySet.update(
            AuditEvent.objects.filter(pk=pk),
            occurred_at=start + timedelta(seconds=offset * 30),
        )
    candidates = GradingCandidate.objects.filter(session=session)
    assessments = CandidateAssessment.objects.filter(candidate__in=candidates)
    models.QuerySet.update(
        assessments,
        generated_at=start - timedelta(days=7),
    )
    models.QuerySet.update(
        assessments.filter(started_at__isnull=False),
        started_at=start,
    )
    models.QuerySet.update(
        assessments.filter(completed_at__isnull=False),
        completed_at=start + timedelta(hours=2),
    )
    models.QuerySet.update(
        CandidateAssessmentItem.objects.filter(
            assessment__in=assessments,
            assessed_at__isnull=False,
        ),
        assessed_at=start + timedelta(hours=1),
    )
    outcomes = CandidateOutcome.objects.filter(candidate__in=candidates)
    models.QuerySet.update(
        outcomes.filter(proposed_at__isnull=False),
        proposed_at=start + timedelta(hours=3),
    )
    models.QuerySet.update(
        outcomes.filter(decided_at__isnull=False),
        decided_at=start + timedelta(hours=4),
    )
    models.QuerySet.update(
        Promotion.objects.filter(grading_candidate__in=candidates),
        promoted_at=start + timedelta(hours=5),
    )


def finished_grading(
    club: Club,
    *,
    title: str,
    days_ago: int,
    plan: Sequence[tuple[str, Decision, int]],
) -> GradingSession:
    """A completed grading: assessed, decided, promoted and closed."""
    marker = (
        AuditEvent.objects.order_by("-pk").values_list("pk", flat=True).first() or 0
    )
    session, candidates, assessments = open_cohort(
        club,
        title=title,
        day=club.today - timedelta(days=days_ago),
        location="Riverside Dojang",
        ranks=[rank for rank, _, _ in plan],
    )
    transition_grading_session(session, Status.OPEN, club.instructor)
    assess_fully(assessments, club, [shortfalls for _, _, shortfalls in plan])
    transition_grading_session(session, Status.LOCKED, club.master)
    decide(candidates, [decision for _, decision, _ in plan], club)
    transition_grading_session(session, Status.COMPLETED, club.master)
    for candidate in candidates:
        club.busy.discard(candidate.student_id)
    backdate(session, marker)
    return session


def history(club: Club) -> None:
    p = Decision(Verdict.PASS, Verdict.PASS, promote=True)
    finished_grading(
        club,
        title="Autumn Grading",
        days_ago=190,
        plan=[
            ("WHITE", p, 0),
            ("WHITE", p, 0),
            ("YELLOW_STRIPE", p, 0),
            ("YELLOW", Decision(Verdict.FAIL, Verdict.FAIL), 6),
            ("BLUE_STRIPE", p, 0),
            ("BLUE", p, 0),
            ("RED", p, 0),
            ("BROWN", p, 0),
        ],
    )
    finished_grading(
        club,
        title="Winter Grading",
        days_ago=95,
        plan=[
            ("WHITE", p, 0),
            ("YELLOW_STRIPE", p, 0),
            (
                "YELLOW",
                Decision(
                    Verdict.CONDITIONAL,
                    Verdict.CONDITIONAL,
                    requirements=(
                        "Show the first form again to an instructor within "
                        "four weeks, with a steadier stance."
                    ),
                ),
                3,
            ),
            # The instructor recommended a fail; the Master passed it.
            ("BLUE_STRIPE", Decision(Verdict.FAIL, Verdict.PASS, promote=True), 2),
            ("RED_STRIPE", p, 0),
            ("RED_STRIPE", p, 0),
            ("BROWN_STRIPE", p, 0),
            ("BLACK_STRIPE", p, 0),
        ],
    )


def awaiting_decision(club: Club) -> GradingSession:
    """Locked: assessed, with recommendations waiting for the Master."""
    marker = (
        AuditEvent.objects.order_by("-pk").values_list("pk", flat=True).first() or 0
    )
    session, candidates, assessments = open_cohort(
        club,
        title="Spring Grading",
        day=club.today - timedelta(days=12),
        location="Riverside Dojang",
        ranks=[
            "WHITE",
            "YELLOW_STRIPE",
            "YELLOW",
            "BLUE_STRIPE",
            "BLUE",
            "RED_STRIPE",
            "RED",
            "BROWN",
        ],
    )
    # One did not turn up: attendance is settled before any work starts.
    absent, candidates = candidates[-1], candidates[:-1]
    apply_candidate_update(
        absent,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        withdrawal_note="Did not attend on the day.",
        actor=club.instructor,
    )
    assessments = assessments[:-1]
    transition_grading_session(session, Status.OPEN, club.instructor)
    assess_fully(assessments, club, [0, 0, 5, 0, 1, 0, 8])
    transition_grading_session(session, Status.LOCKED, club.master)
    decide(
        candidates,
        [
            Decision(Verdict.PASS),
            Decision(Verdict.PASS),
            Decision(Verdict.FAIL),
            Decision(Verdict.PASS),
            Decision(Verdict.CONDITIONAL),
            Decision(None),
            Decision(None),
        ],
        club,
    )
    backdate(session, marker)
    return session


def in_progress(club: Club) -> GradingSession:
    """Open today: some candidates not started, some part way, some done."""
    session, candidates, assessments = open_cohort(
        club,
        title="Summer Grading",
        day=club.today,
        location="Riverside Dojang",
        ranks=[
            "WHITE",
            "WHITE",
            "YELLOW_STRIPE",
            "YELLOW",
            "YELLOW",
            "BLUE_STRIPE",
            "BLUE",
            "RED_STRIPE",
            "RED",
            "BROWN_STRIPE",
        ],
    )
    transition_grading_session(session, Status.OPEN, club.instructor)
    # Withdrawn through an injury before they begin.
    apply_candidate_update(
        candidates[1],
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.INJURY,
        withdrawal_note="Sprained ankle, will return next grading.",
        actor=club.instructor,
    )
    started = [assessments[i] for i in (0, 2, 3, 4, 5, 6, 7)]
    bulk_start_candidate_assessments(assessments=started, actor=club.instructor)
    # Part way: a third, then half, then a few items, with comments both ways;
    # the last started assessment is left untouched.
    judge(assessments[2], club.instructor, not_met=2, share=0.3, praised=3)
    judge(assessments[3], club.instructor, not_met=1, share=0.5, praised=3)
    judge(assessments[4], club.instructor, not_met=0, share=0.15, praised=3)
    # Finished, waiting for the session to be locked.
    for index in (5, 6):
        judge(assessments[index], club.instructor, not_met=1, praised=2)
        complete(assessments[index], club.instructor, OVERALL_NOTES[index % 4])
    return session


def upcoming(club: Club) -> GradingSession:
    """A draft for next month; the rest of the roster is not in it yet."""
    session, _, _ = open_cohort(
        club,
        title="Autumn Grading (planned)",
        day=club.today + timedelta(days=24),
        location="Riverside Dojang",
        ranks=["WHITE", "YELLOW", "BLUE", "RED", "DAHN_BO"],
    )
    return session


def legacy_records(club: Club) -> None:
    """A little imported history, some linked to students and some not."""
    batch = ImportBatch.objects.create(
        kind=ImportBatch.Kind.LEGACY_GRADINGS,
        status=ImportBatch.Status.COMMITTED,
        original_filename="Riverside gradings 2019-2023.xlsx",
        sha256="0" * 64,
        file_size=1,
        uploaded_by=club.administrator,
        committed_by=club.administrator,
        committed_at=timezone.now(),
    )
    rows = (
        ("Leo H.", "WHITE", "YELLOW_STRIPE", "PASS", 2023, 3),
        ("Maya O.", "WHITE", "YELLOW_STRIPE", "PASS", 2023, 3),
        ("Priya R.", "YELLOW_STRIPE", "YELLOW", "CONDITIONAL", 2022, 11),
        ("Kai T.", "YELLOW", "BLUE_STRIPE", "PASS", 2022, 11),
        ("Aaron M.", "BLUE_STRIPE", "BLUE", "FAIL", 2022, 6),
        ("Greta L.", "BLUE", "RED_STRIPE", "PASS", 2021, 11),
        ("J. Smith", "YELLOW", "BLUE_STRIPE", "PASS", 2021, 6),
        ("Sam Ito", "WHITE", "YELLOW_STRIPE", "PASS", 2020, 11),
    )
    ranks = {rank.code: rank for rank in Rank.objects.all()}
    records = []
    for number, (name, current, testing, outcome, year, month) in enumerate(
        rows, start=1
    ):
        records.append(
            LegacyGradingRecord.objects.create(
                source_batch=batch,
                record_kind=LegacyRecordKind.GRADING_RESULT,
                source_sheet=f"{month:02d}-{year}",
                source_locator=f"{month:02d}-{year}!R{number}",
                cycle_year=year,
                cycle_month=month,
                source_name=name,
                source_current_rank_text=ranks[current].name,
                current_rank=ranks[current],
                source_testing_for_rank_text=ranks[testing].name,
                testing_for_rank=ranks[testing],
                source_outcome_text=outcome.title(),
                outcome=outcome,
            ),
        )
    # Linked by an administrator to the matching student; the rest are
    # left for a visitor to try the linking screen on.
    for record_, first in zip(
        records[:5], ("Leo", "Maya", "Priya", "Kai", "Aaron"), strict=True
    ):
        student = Student.objects.filter(first_name=first).first()
        if student is not None:
            link_legacy_record_to_student(record_, student, actor=club.administrator)


@transaction.atomic
def build(*, today: date | None = None) -> None:
    """Build the whole demo club in an empty database."""
    assert_safe_to_build()
    accounts = ensure_personas()
    club = Club(
        administrator=accounts["administrator"],
        instructor=accounts["instructor"],
        master=accounts["master"],
        today=today or timezone.localdate(),
    )
    marker = (
        AuditEvent.objects.order_by("-pk").values_list("pk", flat=True).first() or 0
    )
    grant_authority(accounts)
    club.master = accounts["master"]
    create_students(club)
    # The club's own setting-up happened long before the first grading shown.
    long_ago = local(club.today - timedelta(days=400))
    models.QuerySet.update(
        AuditEvent.objects.filter(pk__gt=marker),
        occurred_at=long_ago,
    )
    history(club)
    awaiting_decision(club)
    in_progress(club)
    upcoming(club)
    legacy_records(club)
