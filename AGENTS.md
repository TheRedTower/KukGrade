# AGENTS.md - KukGrade

## Project Context

KukGrade is an internal martial-arts grading management application for Kuk Sool Won instructors, administrators, and the authorised Master. Students do not directly access the application.

The repository is past initial planning and now has a runnable Django/DRF
backend, React/TypeScript frontend, local PostgreSQL configuration, and several
implemented domain foundations. `backend/`, `frontend/`, and `docs/` are the
accepted top-level boundaries. There is no `api/` or `web/` application
directory, and no worker should be scaffolded until a real asynchronous
workload is accepted.

Before implementation, read:

- `README.md`
- `docs/README.md` - the index, which says what each document is for
- `docs/features.md` - what exists, and who may do what
- `docs/architecture.md` - how it is built and the rules the code follows
- `docs/development.md` - running it, the checks, and the conventions
- `docs/api.md` - the API conventions (`backend/schema.yml` is the contract)
- `docs/roadmap.md` - what is still to come and what needs a decision

Implemented stack: Django, Django REST Framework, React, TypeScript, Vite,
PostgreSQL, pytest, Ruff, mypy, React Testing Library, Vitest, GitHub Actions
CI, local Docker Compose for PostgreSQL, and a single-container production
image (`docs/installation.md`).

## Domain Rules

- Supported roles are Instructor and Administrator. `manager` was removed in
  2026-09 as unused. "Authorised Master" is not a role: it is the three
  per-user permissions `can_make_final_grading_decision`,
  `can_promote_student` and `can_override_locked_session`.
- An authorised Master makes the final grading decision.
- Grading outcomes are Pass, Fail, and Conditional.
- Assessment data must support category-level results and item-level
  met/not-met results. Category-level results are computed from item results,
  never stored. Per-item free text is an append-only log of comments
  (`AssessmentItemComment`), each keeping its author and time and never edited
  or deleted; it records both shortfalls and positive observations.
  `CandidateAssessment.notes` carries the overall observation for the
  assessment. There is no separate praise or positive-observation field, and
  none is planned. The old single `assessor_notes` column is no longer written.
- Every change to a mark after the first needs a written reason and is kept in
  an append-only log (`AssessmentItemResultChange`); there is no reopen. After
  the session locks only the authorised Master may correct a mark or comment,
  always with a reason, until that candidate's final decision is recorded; those
  entries carry `after_lock`. The server names the capability (`marks_open`);
  the frontend never re-derives it.
- Historical grading records must remain reproducible. A session holding a
  final decision is never deleted, by anyone; a finished session is archived
  (hidden from lists, nothing erased) instead.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Every grading assesses the cumulative syllabus: everything examinable
  through the testing rank for the candidate's age band, not only that rank's
  new material. `syllabus.services.effective_syllabus_requirements` is the one
  resolver; the syllabus screen and assessment generation both use it.
- Each grading must retain the exact syllabus it was assessed against.
  Assessment item snapshots copy the full requirement text, so a past grading
  is reconstructable and cannot be changed by a later syllabus edit. An
  explicit `SyllabusVersion` is deliberately deferred (`docs/roadmap.md`).
- Updating a syllabus must not change historical grading records.
- Never hard-code syllabus rules directly into React components. Keep syllabus and grading rules in backend/domain data and APIs.
- Student status is `ACTIVE`, `INACTIVE` or `LEFT`. `INACTIVE` is a temporary
  break and blocks nothing; `LEFT` blocks grading registration. Both are
  reversible and history is always retained.
- Missing a grading must not automatically mean that a student left.

## Reference Data

Age bands:

- 8 and under
- 9-12
- 13-17
- 18+

Ranks (as stored and shown; the black belt titles are abbreviated):

- White
- Yellow Stripe
- Yellow
- Blue Stripe
- Blue
- Red Stripe
- Red
- Brown Stripe
- Brown
- Black Stripe
- DBN (Dahn Bo Nim)
- JKN (Jo Kyo Nim)
- KSN (Kyo Sa Nim)
- PSBN (Pu Sa buhm Nim)
- SBN (Sa Buhm nim)
- PKJN (Pyung Kwahn Jung Nim)

## Security and Privacy

- Treat student details, attendance, grading comments, and outcomes as personal data.
- Apply least-privilege permissions throughout the API and UI.
- Sensitive changes must be auditable, especially syllabus changes, permission changes, final decisions, overrides, rank changes, and student status changes.
- Sensitive actions are recorded in the append-only `audit` app. Events are
  written inside the acting service's transaction and are immutable. Only
  administrators, the designated Master, and holders of
  `can_view_grading_audit_log` may read them, and user-management events are
  administrator-only (`accounts.permissions.can_view_audit_log`).
- Audit events never hold a student's name or date of birth: refer to a student
  by WKSA ID (`audit.recording.student_label`) and put `student_id` in the
  metadata; record which personal fields changed, not their values. Older events
  are cleaned with `manage.py redact_student_audit` (`docs/privacy.md`).
- Do not commit secrets, credentials, production exports, or real student data.
- Prefer explicit fixtures and anonymised test data.

## Engineering Rules

- Inspect existing code, docs, tests, and contracts before changing implementation.
- Do not add dependencies without explaining their purpose.
- Do not silently change API contracts; update docs and tests when contracts change.
- Database changes require migrations and tests.
- Every feature requires success, validation, and permission tests where applicable.
- Run relevant tests, linting, and type checking before finishing.
- Avoid unrelated changes.
- Prefer small, reviewable implementation slices.
- Confirm unresolved decisions (`docs/roadmap.md`, "Needs a decision first") with
  the owner before large scaffolding, dependency, schema, or workflow choices.
- `docs/features.md` describes what exists and `docs/roadmap.md` is the one list
  of remaining work. Update them in the same change when behaviour or scope changes.
- Every API request and response is declared in `backend/schema.yml` and the
  frontend's types are generated from it. Never hand-write an API type in the
  frontend; declare the shape in the backend and regenerate.

## Definition of Done

- The requested behaviour is implemented.
- Automated tests cover the new behaviour.
- Existing relevant tests pass.
- Formatting, linting, and type checks pass.
- Required migrations are included.
- Permission boundaries are tested.
- No unrelated files are changed.
- The final response lists changed files, commands run, and remaining risks.
