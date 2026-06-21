# AGENTS.md - KukGrade

## Project Context

KukGrade is an internal martial-arts grading management application for Kuk Sool Won instructors, grading managers, administrators, and authorised Masters. Students do not directly access the application.

The repository is currently in the planning stage. `api/`, `web/`, and `worker/` are intended boundaries, not completed applications. Before scaffolding or implementation, read:

- `README.md`
- `docs/README.md`
- `docs/action_plan.md`
- `docs/decision_log.md`
- `docs/data_model.md`
- `docs/api_contract.md`
- `docs/grading_app_planning.md`

Planned stack: Django, Django REST Framework, React, TypeScript, PostgreSQL, pytest, React Testing Library with Vitest or Jest, and Docker for production deployment.

## Domain Rules

- Supported roles are Instructor, Manager, Administrator, and authorised Master.
- An authorised Master makes the final grading decision.
- Grading outcomes are Pass, Fail, and Conditional. If existing docs mention defer or reassess, reconcile the wording before implementation.
- Assessment data must support category-level results, item-level met/not-met results, comments, and positive observations.
- Historical grading records must remain reproducible.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Each grading must retain the exact syllabus version used at the time.
- Updating a syllabus must not change historical grading records.
- Never hard-code syllabus rules directly into React components. Keep syllabus and grading rules in backend/domain data and APIs.
- Student status must support active, inactive, and left.
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

## Definition of Done

- The requested behaviour is implemented.
- Automated tests cover the new behaviour.
- Existing relevant tests pass.
- Formatting, linting, and type checks pass.
- Required migrations are included.
- Permission boundaries are tested.
- No unrelated files are changed.
- The final response lists changed files, commands run, and remaining risks.
