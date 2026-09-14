# KukGrade

KukGrade is a planned internal grading management application for Kuk Sool Won instructors, grading managers, administrators, and authorised Masters. It is intended to replace spreadsheet-based grading operations with a maintainable web application for student records, syllabus lookup, draft assessments, final grading decisions, audit history, and historical rank-change records.

Students do not directly access the application.

## Current Status

This repository has the initial runnable foundation:

- `backend/` - Django and Django REST Framework API shell.
- `frontend/` - React, TypeScript, and Vite application shell.
- `docs/` - planning, architecture, domain, testing, and workflow documentation.
- `compose.yaml` - local PostgreSQL service for development.

Authentication and role foundations exist. The first student model foundation
exists. The rank catalogue foundation exists and students now reference their
current rank. The syllabus catalogue foundation exists with read-only API
lookup for WKSA Version 2014 testing requirements by rank and age band. Student
API/UI is still deferred. The grading-session foundation now exists with
sessions, candidates, age-band snapshots, next-rank validation, and applicable
syllabus requirement lookup. Candidate assessment snapshots now preserve the
exact syllabus requirements assessed for each candidate and store per-item
`MET`, `NOT_MET`, or `NOT_ASSESSED` results. Candidate outcome records now
support proposed `PASS`, `FAIL`, or `CONDITIONAL` outcomes, informational
category summaries, and immutable final decisions by users with final grading
decision authority. Promotion, `Student.current_rank` updates and immutable rank history are now
implemented, as are role-based permissions, CI, pagination, a single error
envelope, and an exit for locked sessions. Certificates and worker
implementation remain deferred. See `docs/current-system.md` for the verified
current state.

## Confirmed Direction

- Backend: Django and Django REST Framework.
- Frontend: React and TypeScript.
- Database: PostgreSQL.
- Production deployment: Docker-based.
- Architecture: modular monolith, not microservices.
- Syllabus: data-driven and versioned.
- Historical gradings: must reference the exact immutable syllabus version used.
- Permissions: enforced by the backend, not only hidden in the frontend.
- Data: use anonymised or synthetic development data only.

## Local Development

Copy `.env.example` to `.env` for local values. Keep real secrets and production data out of the repository.

Start PostgreSQL:

```sh
docker compose up -d db
```

Install and run the backend:

```sh
cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 0.0.0.0:8000
```

Install and run the frontend:

```sh
cd frontend
npm install
npm run dev
```

The backend health endpoint is `http://localhost:8000/api/health/`. Frontend
API calls use `VITE_API_BASE_URL`, defaulting to `http://localhost:8000`.

## Rank Foundation

The `ranks` Django app stores KukGrade's ordered rank catalogue as core
reference data. Ordering is always determined by the explicit `Rank.order`
field, not by primary key or alphabetical sorting.

Seeded ranks:

1. White (`WHITE`)
2. Yellow Stripe (`YELLOW_STRIPE`)
3. Yellow (`YELLOW`)
4. Blue Stripe (`BLUE_STRIPE`)
5. Blue (`BLUE`)
6. Red Stripe (`RED_STRIPE`)
7. Red (`RED`)
8. Brown Stripe (`BROWN_STRIPE`)
9. Brown (`BROWN`)
10. Black Stripe (`BLACK_STRIPE`)
11. Dahn Bo (`DAHN_BO`)
12. JKN (`JKN`)
13. KSN (`KSN`)
14. PSBN (`PSBN`)
15. SBN (`SBN`)
16. PKJN (`PKJN`)

White through Black Stripe are categorised as `COLOURED_BELT`, Dahn Bo as
`BLACK_BELT_CANDIDATE`, and JKN through PKJN as `BLACK_BELT`. Ranks above PKJN
are deliberately deferred.

`Student.current_rank` is a required `PROTECT` foreign key to `Rank`. Student
rows do not duplicate rank name, order, or category; those values remain on the
rank catalogue. The migration path adds the field as nullable, assigns existing
students to White, and then makes the field required for new and existing rows.

Deliberately deferred rank-related work:

- promotion history.
- black-belt ranks above PKJN.

## Syllabus Foundation

The `syllabus` Django app stores the current syllabus catalogue as reference
data. `SyllabusItem` represents a stable assessable item such as `Ki Bohn Soo`,
`Ki Cho Hyung`, or `Bohng Dol-li-ki`. Item `code` is globally unique and stable;
item `name` is display text and is deliberately not globally unique so repeated
official names remain possible.

`SyllabusRequirement` maps an item to a target `Rank` and syllabus age band:

- `AGE_8_AND_UNDER`
- `AGE_9_TO_12`
- `AGE_13_TO_17`
- `AGE_18_AND_OVER`

Age bands are testing-rule bands, not stored on `Student`. Future grading-session
logic will resolve a student's band from date of birth and the relevant grading
date.

Numbered technique and weapon ranges are stored on the requirement using
`start_number` and `end_number`; one item can therefore have different ranges for
different ranks or age bands. Form sections and parts, such as `(1/2)` or
`(pt.1)`, are kept in concise requirement notes until a stronger structured
model is justified.

Seed data comes from the supplied official WKSA Version 2014 Junior and
Adult/Youth Testing Requirement Charts. Hangul labels from the charts are
preserved where present. Optional black-belt material marked "May be taught, if
time allows" is kept in the item catalogue where named, but no age-band
requirement is seeded because the Adult/Youth chart does not unambiguously scope
that optional material to a testing age band. The seed does not create ranks
above JKN requirements and does not itself create grading sessions, scoring,
assessment results, attendance, or promotion history.

Current source notes:

- No chart entry is intentionally skipped because it contains Hangul.
- `Sword Techs` is kept as the chart abbreviation rather than expanded.
- `Bohng Dol-li-ki` is used as the canonical item spelling; the Adult/Youth
  chart renders the same item without one hyphen.
- Optional Adult/Youth black-belt material names `Yahng Sohn Mohk Soo`,
  `Ssahng Soo`, and `Dahn Doh Mahk Ki`; its age-band scope is unresolved, so no
  requirement mapping is seeded for those items yet.
- Grading-session candidate age bands are resolved from date of birth and the
  session grading date.

Authenticated staff can read:

- `/api/syllabus/items/`
- `/api/syllabus/items/{id}/`
- `/api/syllabus/requirements/`
- `/api/syllabus/requirements/{id}/`

Requirement lists support `rank_code` and `age_band` query parameters.

## Grading Session Foundation

The `gradings` Django app establishes the grading workflow boundary with
candidate registration, age-band snapshots, immutable assessment snapshots, and
per-item assessment results:

```text
GradingSession
    -> GradingCandidate
        -> Student
        -> testing-for Rank
        -> age-band snapshot
        -> CandidateAssessment
            -> CandidateAssessmentItem snapshot rows
        -> CandidateOutcome
            -> proposed outcome
            -> final authorised Master decision
```

`GradingSession` statuses are `DRAFT`, `OPEN`, `LOCKED`, `COMPLETED`, and
`CANCELLED`. Allowed transitions are `DRAFT -> OPEN`, `DRAFT -> CANCELLED`,
`OPEN -> LOCKED`, `OPEN -> CANCELLED`, and `LOCKED -> COMPLETED`.
`LOCKED -> OPEN` is rejected. `COMPLETED` and `CANCELLED` are terminal, and
sessions do not auto-transition from dates. Application code must use the
canonical `transition_grading_session()` service for status changes; ordinary
model saves reject direct status updates. New sessions start in `DRAFT`; clients
and admin users cannot create already-open, locked, completed, or cancelled
sessions through normal workflows.

`OPEN -> LOCKED` requires every non-withdrawn candidate to have an assessment
that is already `IN_PROGRESS` or `COMPLETED`; generating the assessment alone is
not enough. Assessment start must happen while the session is `OPEN`. `LOCKED`
sessions allow work already in progress to be finished but do not allow new
assessments to begin. Withdrawn candidates do not block locking or completion.

`GradingCandidate` statuses are `REGISTERED`, `WITHDRAWN`, and `COMPLETED`.
Candidates can only be added to draft or open sessions. Candidate deletion is
allowed only while the parent session is draft or open. Session deletion is
allowed only for draft or cancelled sessions. Candidate `student`,
`testing_for_rank`, `status`, and `notes` can only be changed while the parent
session is draft or open.

Candidate `age_band` is a historical snapshot derived from
`Student.date_of_birth` and `GradingSession.grading_date`; clients do not supply
it. Leap-day birthdays are treated as occurring on 1 March in non-leap grading
years. A session grading date cannot be changed after candidates have been
added, which avoids silently invalidating stored age-band snapshots. Candidate
creation requires `testing_for_rank` to be the next active rank after
`Student.current_rank`. This slice deliberately does not change
`Student.current_rank`, inspect prior grading results, create promotion history,
or add broad override machinery.

The assessment generation boundary starts from the active `SyllabusRequirement`
query for the candidate's testing rank and age-band snapshot, then copies those
requirements into immutable per-candidate snapshot rows.

## Assessment Foundation

Each `GradingCandidate` can have one generated `CandidateAssessment`. Generation
copies the candidate's currently applicable active syllabus requirements into
`CandidateAssessmentItem` snapshot rows. The copied fields include age band,
item code, item name, Korean name, category, sequence, required flag, numbered
range, and requirement notes. These fields remain unchanged if the live syllabus
catalogue, item names, requirement ranges, notes, active flags, or source links
change later.

Assessment generation is allowed only while the parent session is `DRAFT` or
`OPEN`. Assessments move `NOT_STARTED -> IN_PROGRESS -> COMPLETED`; starting an
assessment is an explicit lifecycle transition allowed only while the session is
`OPEN`. Result entry is allowed for `IN_PROGRESS` assessments while the session
is `OPEN` or `LOCKED`, so locked sessions can finish work already in progress
but cannot start new assessments. Completion requires every required item to be
`MET` or `NOT_MET`; optional items may remain `NOT_ASSESSED`. Completing an
assessment marks the candidate `COMPLETED`, but does not calculate a final
grading outcome and does not change `Student.current_rank`.

Session locking now requires every non-withdrawn candidate to have an
`IN_PROGRESS` or `COMPLETED` assessment. Session completion requires every
non-withdrawn candidate to have a completed assessment and finalised outcome.
Withdrawn candidates do not block locking or completion. Deletion of candidates
with generated snapshots is limited to draft, not-started assessments.

## Candidate Outcomes

Each completed candidate assessment can have one explicit `CandidateOutcome`.
Outcome creation is a separate action after assessment completion; completing an
assessment does not automatically create or infer a pass, fail, or conditional
decision.

Outcome status values are `DRAFT`, `PROPOSED`, and `FINALISED`. A proposal
records the proposed `PASS`, `FAIL`, or `CONDITIONAL` outcome, proposer,
timestamp, and optional notes. Proposals may be revised before finalisation.
Finalisation is allowed only while the parent session is `LOCKED`, only after a
proposal exists, and only by a user with the existing
`gradings.can_make_final_grading_decision` Django permission. Final outcomes
may agree with or override the proposal.

For `CONDITIONAL`, `conditional_requirements` is required and blank-only text is
rejected. For `PASS` or `FAIL`, conditional requirements must be blank. Finalised
outcomes are immutable and block ordinary outcome deletion, candidate
withdrawal, candidate deletion, and assessment deletion. `QuerySet.update()` is
treated as an unsupported low-level maintenance path, matching the existing
session status convention.

Category summaries are calculated on demand from `CandidateAssessmentItem`
snapshot rows. They use the copied category values from the assessment snapshot,
count required and optional items separately, and do not infer an automatic
final decision.

Authenticated staff can use:

- `/api/gradings/sessions/`
- `/api/gradings/sessions/{id}/`
- `/api/gradings/candidates/`
- `/api/gradings/candidates/{id}/`
- `/api/gradings/candidates/{id}/generate-assessment/`
- `/api/gradings/assessments/`
- `/api/gradings/assessments/{id}/`
- `/api/gradings/assessment-items/`
- `/api/gradings/assessment-items/{id}/`
- `/api/gradings/candidates/{id}/create-outcome/`
- `/api/gradings/outcomes/`
- `/api/gradings/outcomes/{id}/`
- `/api/gradings/outcomes/{id}/propose/`
- `/api/gradings/outcomes/{id}/finalise/`
- `/api/gradings/outcomes/{id}/summary/`

Session filters: `status`, `grading_date`, `grading_date_from`,
`grading_date_to`. Candidate filters: `session`, `student_wksa_id`,
`testing_for_rank_code`, `age_band`, and `status`.

## Verification

Backend:

```sh
cd backend
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings
```

Frontend:

```sh
cd frontend
npm run test
npm run lint
npm run typecheck
```

## Documentation Map

- `docs/product-requirements.md` - product goals, users, confirmed requirements, proposed scope, and unresolved product decisions.
- `docs/architecture.md` - modular monolith architecture, application boundaries, deployment direction, and deferred worker guidance.
- `docs/domain-model.md` - domain concepts, proposed entities, grading lifecycle, historical-data protections, and modeling questions.
- `docs/syllabus-model.md` - versioned syllabus model, rank and age band handling, and historical reproducibility rules.
- `docs/permissions.md` - roles, backend permission enforcement, sensitive actions, and audit requirements.
- `docs/testing-strategy.md` - expected test coverage and test data rules before implementation starts.
- `docs/development-workflow.md` - repository workflow, sequencing, and definition of done.

Existing planning inputs remain available in `docs/action_plan.md`, `docs/api_contract.md`, `docs/data_model.md`, `docs/decision_log.md`, and `docs/grading_app_planning.md`. Where older docs mention outcomes such as defer or reassess, reconcile that wording before implementation; the confirmed grading outcomes are Pass, Fail, and Conditional.

## Non-Goals For The Current Foundation

- No production secrets, real student data, or production exports.
- No student list/create API or UI, no user-management API, no audit event
  implementation, no certificates, payments, notifications, or
  correction/reopening workflow yet. Rank updates and promotion history are
  implemented.
- No background worker implementation until there is a confirmed asynchronous workload.
- No production Docker image or deployment setup yet. CI is implemented.
