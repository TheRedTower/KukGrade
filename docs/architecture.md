# Architecture

## Confirmed Direction

- KukGrade will be a modular monolith.
- The backend will use Django and Django REST Framework.
- The frontend will use React and TypeScript.
- The database will be PostgreSQL.
- Production deployment will be Docker-based.
- Backend APIs must enforce permissions.
- The syllabus and grading rules must be stored as backend/domain data and exposed through APIs.
- React components must not hard-code syllabus rules.

## Repository Boundaries

- `backend/` - Django and Django REST Framework application.
- `frontend/` - React and TypeScript application.
- `docs/` - planning, architecture, domain, testing, and workflow documentation.

The asynchronous worker boundary is deferred until there is a confirmed workload.

## Proposed Backend Modules

The Django project should be structured as a modular monolith with clear domain modules rather than separate services:

- identity and access: users, roles, branch or organisation access, authentication.
- organisations: organisation and branch data.
- students: student profiles, statuses, and historical rank-related records.
- ranks: rank reference data and progression pathways.
- syllabus: versioned syllabus definitions, categories, criteria, age bands.
- gradings: sessions, candidates, examiner assignments, assessments, final decisions.
- audit: append-only audit events for sensitive changes.
- reporting: read-only summaries and exports if reporting is accepted for the relevant release.

Module names are proposals and can change during scaffolding.

## Proposed Frontend Shape

The React app should consume the DRF API and treat the backend as the source of truth for:

- permissions and visible actions.
- syllabus content and grading criteria.
- assessment structure.
- final decision rules.
- audit-sensitive workflow state.

Frontend screens and routes should be derived from confirmed workflows. Exact UI structure is unresolved.

## Data And State

- PostgreSQL is the system of record.
- Django migrations must define schema changes.
- Historical grading data must reference the immutable syllabus version selected for that grading.
- The selected syllabus version must be locked for a grading before assessment item results are recorded.
- Draft assessments may be updated until submitted or locked by confirmed workflow rules.
- Final decisions and audit events should be append-oriented. Changes after finalisation require explicit permission checks and audit records.

## Deployment Direction

Production should run through Docker images or containers for:

- Django API.
- React frontend.
- PostgreSQL as the configured production database.
- Optional worker only after asynchronous workloads are confirmed.

The current Docker Compose file is local-development-only PostgreSQL. Production image layout remains unresolved.

## Unresolved Decisions

- Frontend styling approach.
- Whether audit logging is implemented with custom models only or supported by a package.
- Whether reports are API-only at first or include frontend screens in V1.
- Production Docker image layout and deployment target.
