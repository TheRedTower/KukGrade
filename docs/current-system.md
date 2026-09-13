# Current System

This document describes the implementation present on `dev` at audit baseline
`464670da59721833c5f1b00ffee87f8eb9da5e0b`. It is the current-state companion
to the product requirements and decision log. Older planning documents remain
useful target context, but this document takes precedence for what exists now.

## Implemented

- Monorepo boundaries are `backend/`, `frontend/`, and `docs/`.
- Backend uses Django, Django REST Framework, PostgreSQL, pytest, Ruff, and
  mypy.
- Frontend uses React, TypeScript, Vite, React Testing Library, Vitest, ESLint,
  and `tsc`.
- Local development has a PostgreSQL service in `compose.yaml`.
- Authentication uses a custom email-first user model, Django sessions, and
  CSRF protection.
- Public health endpoint: `/api/health/`.
- Auth endpoints: `/api/auth/login/`, `/api/auth/logout/`, `/api/auth/me/`.
- Rank catalogue is seeded from White through PKJN and exposed read-only at
  `/api/ranks/`.
- Student model exists with WKSA ID, names, date of birth, binary active flag,
  and required `current_rank`.
- Syllabus item and requirement catalogue exists for WKSA Version 2014 source
  data, exposed read-only at `/api/syllabus/items/` and
  `/api/syllabus/requirements/`.
- Grading sessions and candidates exist with lifecycle validation, candidate
  age-band snapshots, and next-active-rank validation.
- Candidate assessment generation copies applicable active syllabus
  requirement data into assessment item snapshot rows.
- Assessment item results support `NOT_ASSESSED`, `MET`, and `NOT_MET`.
- Candidate outcomes support `DRAFT`, `PROPOSED`, and `FINALISED` states with
  `PASS`, `FAIL`, and `CONDITIONAL` outcomes.
- Final outcome finalisation requires the Django permission
  `gradings.can_make_final_grading_decision`.
- Outcome summaries are calculated from assessment item snapshots.
- Frontend currently implements the authentication shell, protected app shell,
  login, logout, and current-user bootstrap.

## Confirmed But Pending

- Explicit `SyllabusVersion` provenance and published-version immutability.
- Least-privilege role/action enforcement beyond authentication and final
  decision permission.
- Append-only audit events for sensitive changes.
- Student status values `active`, `inactive`, and `left`.
- Promotion/rank-history workflow on `dev`.
- Category-level entered assessment judgements, category comments, positive
  observations, cohort/global comments, and prior-comment workflows.
- Frontend student, syllabus, grading session, assessment, outcome, report, and
  administration screens.
- CI and production hardening.

## Known Audit Gaps

The repository audit found important gaps that must be remediated before the
system is treated as secure or historically authoritative:

- State-gated deletion can be bypassed outside API validators.
- Assessment lifecycle and snapshot immutability are not fully enforced at the
  model, admin, queryset, or database boundary.
- Most grading endpoints currently use `IsAuthenticated` only.
- Syllabus version provenance is absent.
- Audit logging is absent.
- Aggregate mutations need consistent parent-row locking and concurrency tests.
- `User.can_make_final_grading_decision` is a legacy boolean while runtime
  authority uses a Django permission.
- Production settings and CI are not ready.

Track remediation status in `docs/audits/remediation-status.md`.

## Deferred Or Out Of Scope

- Student or parent self-service access.
- Worker/background tasks.
- Certificates.
- Payments.
- Notifications.
- Reports and exports.
- Production Docker image layout and deployment configuration.
