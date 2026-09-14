# AGENTS.md - KukGrade

## Project Context

KukGrade is an internal martial-arts grading management application for Kuk Sool Won instructors, grading managers, administrators, and authorised Masters. Students do not directly access the application.

The repository is past initial planning and now has a runnable Django/DRF
backend, React/TypeScript frontend, local PostgreSQL configuration, and several
implemented domain foundations. `backend/`, `frontend/`, and `docs/` are the
accepted top-level boundaries. There is no `api/` or `web/` application
directory, and no worker should be scaffolded until a real asynchronous
workload is accepted.

Before implementation, read:

- `README.md`
- `docs/README.md`
- `docs/current-system.md`
- `docs/action_plan.md`
- `docs/decision_log.md`
- `docs/product-requirements.md`
- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/permissions.md`
- `docs/testing-strategy.md`
- `docs/development-workflow.md`
- `docs/data_model.md`
- `docs/api_contract.md`
- `docs/grading_app_planning.md`

Implemented stack: Django, Django REST Framework, React, TypeScript, Vite,
PostgreSQL, pytest, Ruff, mypy, React Testing Library, Vitest, GitHub Actions
CI, and local Docker Compose for PostgreSQL. Production Docker images and
deployment are not implemented.
Treat `docs/api_contract.md`, `docs/data_model.md`, and
`docs/grading_app_planning.md` as older target/legacy planning inputs unless
they have been reconciled with `docs/current-system.md` and accepted decisions.

## Domain Rules

- Supported roles are Instructor and Administrator. `manager` was removed in
  2026-09 as unused. "Authorised Master" is not a role: it is the three
  per-user permissions `can_make_final_grading_decision`,
  `can_promote_student` and `can_override_locked_session`.
- An authorised Master makes the final grading decision.
- Grading outcomes are Pass, Fail, and Conditional. If existing docs mention defer or reassess, reconcile the wording before implementation.
- Assessment data must support category-level results, item-level met/not-met results, comments, and positive observations.
- Historical grading records must remain reproducible.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Each grading must retain the exact syllabus it was assessed against.
  Assessment item snapshots copy the full requirement text, so a past grading
  is reconstructable and cannot be changed by a later syllabus edit. An
  explicit `SyllabusVersion` is deliberately deferred - see the decision log.
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

Ranks:

- White
- Yellow stripe
- Yellow
- Blue stripe
- Blue
- Red stripe
- Red
- Brown stripe
- Brown
- Black stripe
- Dahn Bo Nim
- Jo Kyo Nim
- Kyo Sa Nim
- Pu Sa buhm Nim
- Sa Buhm nim
- Pyung Kwahn Jung Nim

## Security and Privacy

- Treat student details, attendance, grading comments, and outcomes as personal data.
- Apply least-privilege permissions throughout the API and UI.
- Sensitive changes must be auditable, especially syllabus changes, permission changes, final decisions, overrides, rank changes, and student status changes.
- Sensitive actions are recorded in the append-only `audit` app. Events are
  written inside the acting service's transaction, are immutable, and are
  readable by any signed-in user.
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
- Confirm unresolved decisions in `docs/decision_log.md` before large scaffolding, dependency, schema, or workflow choices.
- Keep `worker/` dormant until there is a real asynchronous workload.
- `docs/current-system.md` is the current-state source of truth, and
  `docs/backend-completion-spec.md` specifies the remaining backend work.
  `docs/audits/2026-09-13-independent-repository-audit.md` is a dated snapshot;
  do not treat its open findings as current without checking.

## Definition of Done

- The requested behaviour is implemented.
- Automated tests cover the new behaviour.
- Existing relevant tests pass.
- Formatting, linting, and type checks pass.
- Required migrations are included.
- Permission boundaries are tested.
- No unrelated files are changed.
- The final response lists changed files, commands run, and remaining risks.
