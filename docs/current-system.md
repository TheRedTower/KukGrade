# Current System

Describes the implementation on `dev` as verified on 2026-09-14. This document
takes precedence over older planning documents for what exists now.

Verified by running the tooling, not by reading the code: 350 backend tests and
16 frontend tests pass from a fresh database, Ruff, `mypy --strict`,
`makemigrations --check` and `manage.py check --deploy --fail-level WARNING`
are all clean, and CI enforces every one of them on each push.

## Implemented

- Monorepo boundaries are `backend/`, `frontend/`, `docs/`.
- Django, DRF, PostgreSQL 17, pytest, Ruff, mypy. React, TypeScript, Vite,
  Vitest, ESLint.
- **CI** runs the full verification set on every branch push and pull request.
  Verified to fail on a deliberate error.
- **Settings fail closed.** `DEBUG` defaults false; a missing
  `DJANGO_SECRET_KEY` with debug off refuses to start. HSTS, SSL redirect,
  proxy header and secure cookies default on. The browsable API is debug-only.
- **Authentication**: email-first custom user, Django sessions, CSRF.
- **Authorisation**: Django permissions are the authority primitive. `User.role`
  (`instructor`, `administrator`) decides group membership and is never
  consulted when authorising. Every viewset declares a `permission_map` per
  action; undeclared actions are denied. See `docs/permissions.md`.
- **Master authority** is three per-user permissions, in no group:
  `can_make_final_grading_decision`, `can_promote_student`,
  `can_override_locked_session`.
- **Pagination** on every list endpoint, uniformly, no exemptions.
- **One error envelope** for every error, with per-field validation messages
  reachable by the client. Unhandled 500s are enveloped too.
- Rank catalogue seeded White through PKJN, read-only.
- Syllabus catalogue for WKSA Version 2014, read-only.
- Student model with `ACTIVE` / `INACTIVE` / `LEFT`. `LEFT` blocks grading
  registration; both non-active states are reversible and keep history.
- Grading sessions, candidates, age-band snapshots, next-rank validation.
- Assessment generation copies applicable requirements into immutable snapshot
  rows. Results are `NOT_ASSESSED`, `MET`, `NOT_MET`.
- Candidate outcomes: `DRAFT` / `PROPOSED` / `FINALISED`, `PASS` / `FAIL` /
  `CONDITIONAL`. Finalised outcomes are immutable.
- **Promotion and rank history**: a finalised PASS can be promoted, updating
  `Student.current_rank` and writing an immutable `Promotion` record.
- **Locked sessions have an exit**: authorised post-lock withdrawal with a
  recorded reason, and `LOCKED -> CANCELLED` for an abandoned grading.
- **Deletion rules are model-level**, holding from `Model.delete()`,
  `QuerySet.delete()`, related managers, the shell and Django admin. Bulk
  deletes are all-or-nothing. Cancelled sessions holding recorded marking
  cannot be deleted at all.
- **Database-level integrity**: a composite foreign key stops an outcome being
  attached to another candidate's assessment; a check constraint ties an item's
  result to its assessor and timestamp. All attribution foreign keys are
  PROTECT.
- Frontend: login, logout, current-user bootstrap, and a four-state auth model
  that distinguishes "not signed in" from "could not reach the server".

## Not Implemented

- **Audit events.** Decided and accepted, not yet built. Outcome revisions are
  currently neither gated nor logged.
- **Concurrency tests.** Every locking guarantee is asserted by reading the
  code, not by running two transactions at once.
- **Student list, retrieve and create endpoints.** Only
  `/api/students/{id}/rank-history/` exists, so students are created and found
  through Django admin.
- **User management.** Administrators hold the permissions but cannot reach
  them: Django admin needs `is_staff`, which no group grants, and there is no
  user API. Granting Master authority requires a superuser.
- **Any grading screen.** The frontend is the authentication shell only.
- Syllabus versioning: deliberately deferred, see the decision log.
- Data erasure: handled manually by decision, see the decision log.
- Deployment, production image, backups.

## Deferred Or Out Of Scope

Student or parent self-service, background workers, certificates, payments,
notifications, reports and exports.
