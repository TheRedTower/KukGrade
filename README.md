# KukGrade

KukGrade is an internal grading management application for Kuk Sool Won
instructors, administrators, and authorised Masters. It replaces
spreadsheet-based grading with a maintainable web application for student
records, syllabus lookup, grading sessions and assessments, final grading
decisions, promotion and rank history, user management, and an append-only
audit log.

Students do not directly access the application.

## Current Status

The backend is complete for the core grading domain: authentication and
permissions, students, ranks, syllabus, grading sessions and candidates,
assessment snapshots, candidate outcomes, promotion and rank history, user
management, audit logging, and bulk data import (student roster and
historical KSW Colchester grading-workbook migration into a separate,
immutable `LegacyGradingRecord` model). Administrator-only hard-delete
tooling (user accounts, completed assessments, students with full cascade,
and grading sessions in any status) covers corruption/test-data cleanup and
routine record removal without weakening the audit trail. The frontend
implements the main
instructor workflow: overview, student records, syllabus browsing,
grading-session and cohort management, assessment preparation and marking,
outcome decisions, and promotion. Session detail includes bulk no-show
confirmation before locking and reasoned, authority-gated candidate
withdrawal after locking. The Audit route provides a paginated, filterable
event browser with event detail for administrators and the designated
Master. The Users route is an administrator-only staff-account workspace for
creation, account updates, role/status management, Master authority, and
password resets. Administrator-only import screens handle student-roster and
historical-grading uploads, review, and reconciliation. Offline/PWA support
and a production deployment target remain to be set up. A single-container
production image and Compose definition are available; see `docs/deployment.md`.

This is a summary. **`docs/current-system.md` is the authoritative,
continuously-verified description of what exists on `dev` right now** - it
states exactly which tools were run to confirm each claim, and takes
precedence over this file and over any planning document if they disagree.
`backend/README.md` covers backend configuration and domain rules in detail;
`docs/api_contract.md` is the endpoint-by-endpoint API reference.

Repository layout:

- `backend/` - Django and Django REST Framework API.
- `frontend/` - React, TypeScript, and Vite application.
- `docs/` - planning, architecture, domain, and decision documentation.
- `compose.yaml` - local PostgreSQL service for development.
- `compose.prod.yml` - one-service production application definition.

## Confirmed Direction

- Backend: Django and Django REST Framework.
- Frontend: React and TypeScript.
- Database: PostgreSQL.
- Production deployment: one Docker app container behind existing Traefik,
  using an existing PostgreSQL container; not yet deployed.
- Architecture: modular monolith, not microservices.
- Syllabus: data-driven. Historical gradings must reference the exact
  syllabus content used - fulfilled today by copying requirements into
  immutable per-candidate snapshot rows at assessment generation; a dedicated
  versioned-syllabus entity is deferred by decision, see
  `docs/decision_log.md`.
- Permissions: enforced by the backend as the authority primitive, never only
  in the frontend.
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

## Verification

Backend:

```sh
cd backend
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings data_imports
```

Frontend:

```sh
cd frontend
npm run test
npm run lint
npm run typecheck
```

CI runs the full set above, plus `manage.py check`,
`makemigrations --check --dry-run`, `check --deploy --fail-level WARNING`,
the frontend build, and a dependency audit, on every push and pull request.

## Documentation Map

Start here for what is true today:

- `docs/current-system.md` - the verified current state; takes precedence
  over every other document.
- `backend/README.md` - backend configuration, pagination, and per-app domain
  rules (sessions, candidates, assessments, outcomes, promotion).
- `docs/api_contract.md` - the endpoint-by-endpoint API reference, including
  which sections are implemented versus target/deferred.
- `docs/data-import-and-legacy-migration.md` - bulk student-roster import and
  historical KSW Colchester grading-workbook migration.
- `docs/permissions.md` - roles, the Django-permission authority model, and
  sensitive-action authority.
- `docs/decision_log.md` - dated decisions and their reasoning; the record of
  *why*, not just *what*.
- `docs/audits/` - independent audit findings and their remediation status.

Earlier planning documents remain for background and are not authoritative
where they disagree with the above: `docs/product-requirements.md`,
`docs/architecture.md`, `docs/domain-model.md`, `docs/syllabus-model.md`,
`docs/testing-strategy.md`, `docs/development-workflow.md`,
`docs/action_plan.md`, `docs/data_model.md`, and `docs/grading_app_planning.md`.

## Non-Goals For The Current Foundation

- No production secrets, real student data, or production exports.
- No certificates, payments, notifications, or correction/reopening workflow.
- No offline/PWA support yet; the frontend is online-first.
- No background worker until there is a confirmed asynchronous workload.
- No production host connection or verified database restore yet.
