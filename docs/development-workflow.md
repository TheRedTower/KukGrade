# Development Workflow

## Current Stage

KukGrade has a runnable Django/DRF backend and React/TypeScript frontend for the
core grading workflow, local PostgreSQL Compose, CI, generated API types,
permissions, audit logging, promotion, and rank history. The Audit browser is
implemented, as is the administrator Users account-management workspace.
Production deployment and offline/PWA support are not implemented.

Dated audit documents are snapshots. Verify their findings against the current
branch before treating them as work. Do not scaffold a worker until a real
asynchronous workload is accepted.

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

## Implementation Sequence

1. Keep the core workflow green and contracts/documentation aligned.
2. Keep the implemented paginated, filterable Audit event browser aligned with
   its append-only backend contract.
3. Keep the implemented administrator account, role, authority, and
   password-reset flows aligned with the Users API.
4. Complete accessibility review and split the shared frontend stylesheet by
   stable feature boundary.
5. Define and implement production deployment, backup/restore, readiness, and
   monitoring.
6. Decide offline requirements before implementing any PWA/synchronisation
   architecture.
7. Add reports, exports, certificates, notifications, or worker tasks only
   after their product scope is accepted.

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
uv run mypy kukgrade health accounts audit ranks students syllabus gradings
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

Future documentation must define exact production image, deployment, backup,
restore, readiness, and rollback commands before production use.

## Unresolved Decisions

- Docker image layout and deployment target.
- Backup/restore ownership and retention.
- Whether offline grading is required and, if so, its conflict policy.
- Syllabus version publication and selection policy (currently deferred).
- Reporting/export scope and retention.
