# Development Workflow

## Current Stage

KukGrade has a runnable Django/DRF backend, React/TypeScript frontend, local
PostgreSQL foundation, authentication/session foundation, and implemented
student, rank, syllabus, grading session, assessment snapshot, and candidate
outcome foundations.

The repository is in an audit remediation phase. Do not start unrelated product
features until the relevant remediation stages in
`docs/audits/remediation-status.md` are complete. Do not scaffold a worker,
audit subsystem, CI, production Docker images, or broad new workflows until the
relevant decisions are confirmed.

## Confirmed Working Rules

- Inspect existing docs, code, tests, and contracts before changing implementation.
- Prefer small, reviewable implementation slices.
- Avoid unrelated changes.
- Do not add dependencies without explaining their purpose.
- Do not silently change API contracts.
- Update docs and tests when contracts change.
- Keep asynchronous worker implementation dormant until there is a real asynchronous workload.
- Use anonymised or synthetic data during development.
- Do not commit secrets, credentials, production exports, or real student data.

## Proposed Implementation Sequence

1. Confirm unresolved foundation decisions in `docs/decision_log.md`.
2. Scaffold the Django and DRF backend in `backend/`. Done.
3. Add PostgreSQL-backed local configuration. Done.
4. Add the first backend tests and minimal startup verification. Done.
5. Scaffold the React and TypeScript frontend in `frontend/`. Done.
6. Add frontend API client conventions and first tests. Done.
7. Implement identity and permissions foundations. Done for authentication and reusable role permissions; audit remains pending.
8. Implement student records. Initial `Student` model is done; student API/UI remains pending.
9. Implement ranks and syllabus versioning. Rank catalogue is done; explicit
   syllabus versioning is pending.
10. Implement grading sessions, draft assessments, final decisions, and
    confirmed historical rank-change behavior. Grading sessions, assessment
    snapshots, and final decisions are done; promotion/rank history is not
    merged on `dev` and must be re-audited before acceptance.
11. Add reporting, certificates, imports, notifications, and worker tasks only after the core workflow is stable.

## Documentation Workflow

Before implementation work that affects behavior or structure:

- check this documentation set.
- check `docs/decision_log.md`.
- confirm unresolved decisions that affect the work.
- update the relevant docs when behavior or contracts change.

## Definition Of Done For Implementation Slices

- Requested behavior is implemented.
- Relevant tests are added or updated.
- Permission boundaries are tested.
- Audit behavior is tested for sensitive changes.
- Migrations are included for database changes.
- Relevant existing tests pass.
- Formatting, linting, and type checks pass where tooling exists.
- No unrelated files are changed.
- Final response lists changed files, commands run, and remaining risks.

## Commands

Backend commands:

```sh
cd backend
uv sync --frozen
uv run python manage.py migrate
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py check
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts ranks students syllabus gradings
uv run python manage.py runserver 0.0.0.0:8000
```

Frontend commands:

```sh
cd frontend
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
npm run dev
```

Local database:

```sh
docker compose up -d db
cd backend
uv run python manage.py migrate
```

PostgreSQL-backed integration test workflow:

```sh
docker compose up -d db
cd backend
uv run pytest
```

The local Compose database binds PostgreSQL to `127.0.0.1` only and stores data
under `.local/postgres/`, which is ignored by Git. Use `.env` for local
overrides and keep production database credentials out of this repository.

Future documentation should define exact commands for:

- CI.
- production Docker build and run.

## Unresolved Decisions

- Frontend styling approach.
- CI provider and required checks.
- Docker image layout and deployment target.
- V1 role/action permission matrix.
- Syllabus version publication and selection policy.
- Audit retention and visibility policy.
