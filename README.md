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
confirmation before locking, moving or removing a registration while the
session is draft or open, and reasoned, authority-gated candidate
withdrawal after locking. The Audit route provides a paginated, filterable
event browser with event detail for administrators and the designated
Master. The Users route is an administrator-only staff-account workspace for
creation, account updates, role/status management, Master authority, and
password resets. Administrator-only import screens handle student-roster and
historical-grading uploads, review, and reconciliation. Offline/PWA support
and a live production host remain to be set up. A single-container production
image (with its own PostgreSQL, or using an existing one) and Compose files for
running it directly or behind a proxy or tunnel are available; see
`docs/deployment.md`.

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
- `compose.prod.yml` - the owner's production host (existing Traefik and
  PostgreSQL).
- `deploy/` - Compose files and one `.env` for running the image anywhere.

## Confirmed Direction

- Backend: Django and Django REST Framework.
- Frontend: React and TypeScript.
- Database: PostgreSQL.
- Production deployment: one Docker container, carrying its own PostgreSQL or
  using an existing one; the owner's host runs it behind existing Traefik and
  PostgreSQL. Not yet deployed.
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

On a fresh database, run `uv run python manage.py issue_setup_code` once and
enter the code it prints on the site's setup page to create the first
administrator. `createsuperuser` is switched off.

Install and run the frontend:

```sh
cd frontend
npm install
npm run dev
```

The backend health endpoint is `http://localhost:8000/api/health/`. Frontend
API calls use `VITE_API_BASE_URL`, defaulting to `http://localhost:8000`.

## Verification

```sh
cd backend && uv run pytest && uv run ruff check . && uv run mypy kukgrade health accounts audit ranks students syllabus gradings data_imports
cd frontend && npm run test && npm run lint && npm run typecheck
```

`docs/development-workflow.md` has the complete list - including the
migration, deployment-settings, OpenAPI-schema and generated-type drift
checks - and CI runs all of it on every push and pull request.

## Documentation Map

- `docs/current-system.md` - what exists today, how it was verified, and the
  known gaps; takes precedence over every other document.
- `docs/api_contract.md` - the HTTP contract, endpoint by endpoint;
  `backend/schema.yml` is its machine-readable form.
- `backend/README.md` - how the backend code is organised and configured.
- `docs/permissions.md` - roles, the Django-permission authority model, and
  sensitive-action authority.
- `docs/data-import-and-legacy-migration.md` - bulk student-roster import and
  historical KSW Colchester grading-workbook migration.
- `docs/deployment.md` - the production image and how to run it.
- `docs/decision_log.md` - dated decisions and their reasoning.
- `docs/README.md` - the full index, including the product, architecture,
  and planning documents.

## Non-Goals For The Current Foundation

- No production secrets, real student data, or production exports.
- No certificates, payments or notifications. Corrections are possible only
  before a session locks (a completed assessment can be reopened while the
  session is open); there is no correction workflow after lock yet.
- No offline/PWA support yet; the frontend is online-first.
- No background worker until there is a confirmed asynchronous workload.
- No production host connection or verified database restore yet.
