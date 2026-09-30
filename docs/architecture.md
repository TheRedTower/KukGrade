# Architecture

## Shape

- A modular monolith: one Django/DRF backend, one React/TypeScript frontend,
  one PostgreSQL database. No microservices, no worker until a real
  asynchronous workload is accepted.
- The backend enforces every permission; the frontend only reflects them.
- Syllabus and grading rules live in backend data and services, exposed
  through the API. React components never hard-code them.
- Repository boundaries: `backend/`, `frontend/`, `docs/`.

## Backend apps

| App | Owns |
| --- | --- |
| `kukgrade` | Settings, URL routing, the error envelope, pagination, shared query-parameter filters, serving the built frontend |
| `accounts` | Email-first staff users, role groups, per-user authority permissions, the permission classes every view uses |
| `audit` | The append-only `AuditEvent` log and the one `record()` function that writes it |
| `ranks` | The seeded rank catalogue |
| `students` | Students, their status, and their rank and grading history reads |
| `syllabus` | Syllabus items, per-rank/age-band requirements, and the cumulative resolver behind both the syllabus screen and assessment generation |
| `gradings` | Sessions, candidates, assessment snapshots, outcomes, promotions, and imported `LegacyGradingRecord`s |
| `data_imports` | Import batches: student-roster import and the historical-workbook adapter |
| `health` | Liveness (`/api/health/`) and database readiness (`/api/ready/`) |

Every state change goes through a service function (`<app>/services.py`)
that validates it, writes it inside a transaction, and records its audit
event in that same transaction. Views, serializers, and Django admin all
call those services, so the rules and the audit trail are identical however
a change arrives. Models additionally refuse the most important illegal
states themselves - session status changes, deletion rules, and changes to
finalised outcomes, promotions, audit events and imported source text - so
the shell and bulk querysets cannot bypass those. Assessment snapshot and
completion rules are enforced by the services, serializers and admin, not by
the models (see `backend/README.md`).

Concurrent grading writes follow one lock protocol, `gradings/locking.py`:
a grading session's row lock is taken first and coordinates everything inside
that session; students, the one row two sessions share, are locked after it in
ascending id; validation runs only against rows re-read under those locks. A
service never saves the instance it was handed - it applies the requested
fields to the locked row. Student and user edits lock their own row the same
way.

## Frontend

React with React Router and TanStack Query. API types are generated from
`backend/schema.yml` into `frontend/src/api/schema.ts`; `frontend/src/api.ts`
aliases them and holds the fetch functions. Styling is plain CSS, one
stylesheet per feature area, on the design tokens in `frontend/src/theme.css`.

## Data

- PostgreSQL is the system of record; Django migrations define the schema.
- A grading keeps the exact syllabus it was assessed against: generating an
  assessment copies every requirement's text into immutable per-candidate
  snapshot rows, so a later syllabus edit cannot change a past grading.
- Finalised outcomes, promotions, and audit events are immutable. Imported
  historical records keep their source text immutable and are voided, never
  deleted.

## Deployment

One production image contains the Django API, the built React frontend, and
its static files. `compose.prod.yml` defines only that app service, joined to
the host's existing Traefik and PostgreSQL containers through external Docker
networks. `compose.yaml` is local-development PostgreSQL only. See
`deployment.md`.
