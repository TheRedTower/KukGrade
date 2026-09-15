# Current System

Describes the implementation on `dev` as verified on 2026-09-15. This document
takes precedence over older planning documents for what exists now.

Verified by running the tooling, not by reading the code: 405 backend tests and
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
- **Students API**: list, retrieve, create, partial update.
  `GET /api/students/` and detail exclude no fields except that list omits
  date of birth - the most sensitive field held, shown only on a record an
  instructor deliberately opened. `wksa_id` is writable on create and
  read-only afterwards, since it is the external identifier grading records
  are matched against. Filters: `status`, `current_rank_code`, `search`
  (name and WKSA ID). No delete: every relationship to a student is PROTECT
  and history is retained by decision.
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
- **Users API**: list, retrieve, create, partial update, plus two dedicated
  actions. `PATCH /api/users/{id}/authority/` grants or revokes the three
  sensitive permissions as booleans in the same shape `/api/auth/me/`
  returns them, and refuses a user changing their own authority.
  `POST /api/users/{id}/set-password/` resets a password, validated by
  Django's configured password validators. `is_staff` and `is_superuser`
  are never writable through the API. No delete: every attribution
  foreign key is `PROTECT`.
- **Audit log**: append-only `audit` app recording session, candidate,
  assessment, item, outcome and promotion actions. Written inside the acting
  service's transaction, so no event survives a rolled-back action. Outcome
  revisions carry the previous proposal, which is what makes a disagreement
  visible. Immutable from model, queryset, admin and HTTP. Readable and
  filterable by any signed-in user.
- Frontend: login, logout, current-user bootstrap, and a four-state auth model
  that distinguishes "not signed in" from "could not reach the server".
- **One end-to-end HTTP test** drives the entire grading workflow - login,
  student, session, candidate, assessment generation and marking, outcome
  proposal, finalisation and promotion, rank history - taking every
  identifier from the previous response, the way a real frontend must.

## Not Implemented


- **Concurrency tests.** Every locking guarantee is asserted by reading the
  code, not by running two transactions at once.
- **Any grading screen.** The frontend is the authentication shell only.
- Syllabus versioning: deliberately deferred, see the decision log.
- Data erasure: handled manually by decision, see the decision log.
- Deployment, production image, backups.

## Deferred Or Out Of Scope

Student or parent self-service, background workers, certificates, payments,
notifications, reports and exports.
