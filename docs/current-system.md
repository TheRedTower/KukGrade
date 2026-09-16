# Current System

Describes the implementation on `dev` as verified on 2026-09-15. This document
takes precedence over older planning documents for what exists now.

Verified by running the tooling, not by reading the code: 455 backend tests and
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
  `DJANGO_SECRET_KEY` with debug off refuses to start. HSTS, SSL redirect and
  secure cookies default on. The one exception is the reverse-proxy header
  (`DJANGO_BEHIND_TLS_PROXY`), which defaults **off** even in production and
  must be opted into explicitly - trusting it without a proxy that actually
  strips it lets a client spoof an already-secure request. The browsable API
  is debug-only. PostgreSQL only; a SQLite fallback used to exist and could
  not actually run this application, so it was removed rather than fixed.
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
- **Bulk operations**: `bulk-register` registers several candidates against
  one session (optionally generating their assessments in the same request);
  `bulk-generate-assessments` generates assessments for several already-
  registered candidates; `bulk-start` (on `/api/gradings/assessments/`)
  starts several already-generated assessments - a separate, deliberate
  action, never bundled into generation or registration, so bulk-starting is
  always a choice; `bulk-update-status` sets status on several candidates at
  once (built for confirming attendance - tick the no-shows, set
  `WITHDRAWN`, confirm). All four process rows **independently**: each runs
  the same domain service as its single-item endpoint inside its own
  savepoint, and one row's failure never blocks the others. Every response
  lists what succeeded plus an `errors` map keyed by row index for what
  did not. A `bulk-register` row's `testing_for_rank` is optional and
  resolves to that student's own next active rank when omitted, so a
  mixed-belt group registers in one request with no rank picked at all.
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
  PROTECT. `Promotion` and a finalised `CandidateOutcome` refuse
  `QuerySet.update()` as well as `save()`/`delete()` - the one path that
  could previously rewrite an immutable record from a shell.
- **Row locking is consistent**: every `select_for_update()` in
  `gradings/services.py` locks only its own row (`of=("self",)`), never a
  joined session, student or rank row picked up incidentally through
  `select_related`.
- **Users API**: list, retrieve, create, partial update, plus two dedicated
  actions. `PATCH /api/users/{id}/authority/` grants or revokes the three
  sensitive permissions as booleans in the same shape `/api/auth/me/`
  returns them, and refuses a user changing their own authority.
  `POST /api/users/{id}/set-password/` resets a password, validated by
  Django's configured password validators. `is_staff` and `is_superuser`
  are never writable through the API. No delete: every attribution
  foreign key is `PROTECT`.
- **Audit log**: append-only `audit` app recording session, candidate,
  assessment, item, outcome, promotion, student and user actions. Written
  inside the acting service's transaction, so no event survives a
  rolled-back action. Django admin routes every write through the same
  services the API uses, so an admin-created or admin-edited record is
  audited and attributed identically. Outcome revisions carry the previous
  proposal, and a locked-session withdrawal that discards an undecided
  proposal carries what it said, before it is deleted - both are what make
  a disagreement or an overridden decision visible after the fact.
  Immutable from model, queryset, admin and HTTP. **Readable only by
  administrators and holders of Master (final-decision) authority** - a
  plain instructor gets 403, in both the API (`CanViewAuditLog`) and Django
  admin (`AuditEventAdmin.has_view_permission`/`has_module_permission`); no
  group carries the `view_auditevent` permission for this reason. Even for
  those two, user-management events (`USER_CREATED`, `USER_UPDATED`,
  `USER_AUTHORITY_CHANGED`) are administrator-only - logistics, same as the
  Users API itself, so a Master who is not an administrator still cannot
  see them.
- **Master authority is administrator-exclusive by design**: granting
  `can_make_final_grading_decision` to an administrator is refused
  (`POST /api/users/{id}/authority/`), and promoting a user who already
  holds it to administrator is refused too
  (`PATCH /api/users/{id}/`, `role`). Confirmed policy is exactly one
  designated Master, never an administrator; administrators hold every
  other capability, including the other two sensitive permissions.
- Frontend: login, logout, current-user bootstrap, and a four-state auth model
  that distinguishes "not signed in" from "could not reach the server". The
  login form distinguishes wrong credentials, CSRF failure, throttling, a
  server error, and a dropped connection - it does not tell a rate-limited
  user their password is wrong.
- **One end-to-end HTTP test** drives the entire grading workflow - login,
  student, session, candidate, assessment generation and marking, outcome
  proposal, finalisation and promotion, rank history - taking every
  identifier from the previous response, the way a real frontend must.
- **Concurrency tests** (`gradings/test_concurrency.py`, marked
  `concurrency`) prove five locking guarantees under a genuine multi-thread
  race rather than by reading the code: exactly one snapshot, one outcome,
  one finalisation and one promotion survive a race, and two competing
  session transitions never leave a mixed state.
- **Login is rate-limited**: `ScopedRateThrottle` at 10/min, scoped so no
  other endpoint is affected. A failed attempt is logged with the email
  only; no log line in the codebase ever includes a password or a raw
  request body. Counters live in Django's default per-process cache, which
  is correct for the single-process deployment this runs as - the 10/min
  bound holds as stated. If that ever becomes multi-process, the throttle
  needs a shared cache (Redis) or the bound loosens to 10/min per process;
  see the 2026-09-15 decision log entry.
- **Password validation is consistent everywhere an account can be
  created**: the users API, `SetPasswordSerializer`, and the Django admin
  add-user form all run the full configured validator set, including
  `UserAttributeSimilarityValidator` against the account's own email.
- **Sensitive actions cannot silently lose their authority class**: a
  permission-completeness test pins `finalise`, `promote` and `withdraw` to
  the per-user permission class each requires, independent of the ordinary
  `permission_map` check.

## Not Implemented

- **Any grading screen.** The frontend is the authentication shell only.
- Syllabus versioning: deliberately deferred, see the decision log.
- Data erasure: handled manually by decision, see the decision log.
- Deployment, production image, backups.

## Deferred Or Out Of Scope

Student or parent self-service, background workers, certificates, payments,
notifications, reports and exports.
