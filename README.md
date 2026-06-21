# KukGrade

KukGrade is a planned internal grading management application for Kuk Sool Won instructors, grading managers, administrators, and authorised Masters. It is intended to replace spreadsheet-based grading operations with a maintainable web application for student records, syllabus lookup, draft assessments, final grading decisions, audit history, and historical rank-change records.

Students do not directly access the application.

## Current Status

This repository has the initial runnable foundation:

- `backend/` - Django and Django REST Framework API shell.
- `frontend/` - React, TypeScript, and Vite application shell.
- `docs/` - planning, architecture, domain, testing, and workflow documentation.
- `compose.yaml` - local PostgreSQL service for development.

Authentication and role foundations exist. No student, grading, syllabus, or
worker implementation exists yet.

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

The backend health endpoint is `http://localhost:8000/api/health/`. The frontend reads it through `VITE_API_BASE_URL`, defaulting to `http://localhost:8000`.

## Verification

Backend:

```sh
cd backend
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts
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
- No student, grading, syllabus, or audit implementation yet.
- No background worker implementation until there is a confirmed asynchronous workload.
- No CI or production Docker image setup yet.
