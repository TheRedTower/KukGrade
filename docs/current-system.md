# Current System

Describes the implementation on `dev` as verified on 2026-09-29.
This document takes precedence over every other document for what exists now.

Verified on 2026-09-29 with 678 backend tests and 231 frontend tests passing
(the frontend suite in both UTC and `TZ=America/Los_Angeles`).
Ruff, formatting, strict mypy, Django and deployment checks, migration drift,
OpenAPI schema drift, generated API types, ESLint, TypeScript, the production
build, and `npm audit --audit-level=high` are clean. CI enforces the same
checks on each push and pull request.

## Implemented

- Monorepo boundaries are `backend/`, `frontend/`, `docs/`.
- Django, DRF, PostgreSQL 17, pytest, Ruff, mypy. React, TypeScript, Vite,
  Vitest, ESLint.
- **CI** runs the full verification set on every branch push and pull request.
  Verified to fail on a deliberate error.
- **Production app packaging (2026-09-23)**: one Docker image builds React
  with same-origin `/api/` calls, bundles it with Django, and collects static
  files with WhiteNoise. `compose.prod.yml` defines one app service attached
  to external Traefik and PostgreSQL networks; it does not create either
  existing service. The container runs migrations before one threaded
  Gunicorn worker starts. `/api/ready/` checks PostgreSQL for container
  health; the public `/api/health/` remains a process liveness endpoint.
  The club name in the top bar is the `KUKGRADE_CLUB_NAME` setting, served by
  the public `/api/site/`; a session with no location shows none rather than
  an assumed venue.
  See `docs/deployment.md`. Host integration and restore verification remain.
- **Settings fail closed.** `DEBUG` defaults false; a missing
  `DJANGO_SECRET_KEY` with debug off refuses to start. HSTS (one year,
  subdomains included), SSL redirect and secure cookies default on; HSTS
  preload defaults off and is an explicit opt-in. The one exception is the reverse-proxy header
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
- Rank catalogue seeded White through PKJN, read-only - in Django admin as
  well as the API since 2026-09-26, for superusers too, so an unaudited edit
  cannot change how past records read. The syllabus catalogue is the same.
  Each rank carries its belt: `belt_colour`, plus `stripe_colour` for a
  stripe rank, which is the belt below with a stripe towards the next (Blue
  stripe is a yellow belt with a blue stripe). Every screen draws ranks with
  one `BeltSwatch` from these fields and `stripe_count`. Dahn Bo is a brown
  belt with two black stripes; the black-belt titles are plain black until
  their appearance is decided.
- Syllabus catalogue for WKSA Version 2014, read-only. Requirements are read
  through `GET /api/syllabus/requirements/effective/`
  (FDR-041/SCR-025, 2026-09-21) returns one cumulative row per Technique/Form
  item examinable through a selected rank: the latest applicable mapping at
  or before that rank supplies the effective range, the earliest supplies
  where it was introduced. Core grading areas are ordered to match the WKSA
  chart's own category sequence rather than alphabetically.
- Student model with `ACTIVE` / `INACTIVE` / `LEFT`. `LEFT` blocks grading
  registration; both non-active states are reversible and keep history.
- **Students API**: list, retrieve, create, partial update.
  `GET /api/students/` and detail exclude no fields except that list omits
  date of birth - the most sensitive field held, shown only on a record an
  instructor deliberately opened. `wksa_id` is writable on create and
  read-only afterwards, since it is the external identifier grading records
  are matched against. Filters: `status`, `current_rank_code`, `search`
  (name and WKSA ID). **Hard delete (2026-09-22, administrator-only)**:
  `DELETE /api/students/{id}/` (`students.services.delete_student`) cascades
  through every grading-session registration, assessment, outcome and
  promotion involving the student - every relationship is `PROTECT`, so
  nothing cascades automatically; the service removes each explicitly, in
  dependency order, using the same sanctioned bypass as
  `delete_candidate_assessment`. A linked `LegacyGradingRecord` is unlinked
  (student set to null), never deleted - it is independent evidence of an
  imported workbook, not the student's own record. One `STUDENT_DELETED`
  audit event records the cascade counts before the row goes.
- **Bulk student-roster import** (`data_imports` app, 2026-09-21,
  administrator-only): upload a `.xlsx`/`.csv` roster, preview row-by-row
  classification (ready/needs review/skip existing), then commit - every
  created student goes through the ordinary `students.services.create_student`
  service, so validation and the normal `STUDENT_CREATED` audit event are
  identical to a hand-created student. An existing WKSA ID is always
  skipped, never updated. See `docs/data-import-and-legacy-migration.md`.
- **Historical grading-workbook migration** (2026-09-22, administrator-only):
  a second `data_imports` batch kind (`LEGACY_GRADINGS`) parses the KSW
  Colchester historical grading workbook (`.xlsx`) into `LegacyGradingRecord`
  rows - a deliberately weaker, distinct evidence model from the native
  grading workflow, never a `Promotion`, `CandidateOutcome`, or current-rank
  change. Source text (name, rank text, outcome text, comments) is preserved
  verbatim and immutable after import; only `student`, `current_rank`,
  `testing_for_rank`, and void state are ever correctable afterwards, and
  only through five explicit service functions
  (`gradings/legacy_services.py`) - never a bulk queryset write, never a
  name-to-student match applied automatically. Rank-text review works on
  distinct values across a batch, not per row, with an exact-match
  suggestion the administrator must still confirm. `GET
  /api/gradings/legacy-records/` (both roles) plus five
  administrator-only reconciliation actions
  (`link-student`/`unlink-student`/`resolve-current-rank`/
  `resolve-testing-for-rank`/`void`, gated by
  `gradings.can_reconcile_imported_history`) let an admin correct a wrong
  link or an unresolved rank without ever touching the source record. A
  voided record is excluded from active views but never physically
  deleted; a second void on the same record is refused. See
  `docs/data-import-and-legacy-migration.md`.
- **Unified student grading history**: `GET /api/students/{id}/grading-history/`
  combines finalised native outcomes with linked, non-voided legacy records
  into one source-labelled, newest-first timeline (`KUKGRADE`/`LEGACY`),
  each with its own honest date precision - an exact day for a native
  grading, a month only for a historical one unless a verified exact date
  was later added. Deliberately separate from `/rank-history/`, which is
  untouched and stays `Promotion`-only.
- Grading sessions, candidates, age-band snapshots, next-rank validation.
- **Candidates record the rank held at registration (2026-09-25)**:
  `GradingCandidate.from_rank` is set from the student's current rank when the
  candidate is created and never moves afterwards, so the completion proof and
  the promotion ledger show where the candidate started even after promotion.
  Existing rows were backfilled from each candidate's own `Promotion`, else by
  replaying the student's promotion history to the session date. The
  assessment screens no longer look the student up by a WKSA-ID substring
  search, which could return a different student.
- **Bulk operations**: `bulk-register` registers several candidates against
  one session (optionally generating their assessments in the same request);
  `bulk-generate-assessments` generates assessments for several already-
  registered candidates; `bulk-start` (on `/api/gradings/assessments/`)
  starts several already-generated assessments - a separate, deliberate
  action, never bundled into generation or registration, so bulk-starting is
  always a choice; `bulk-update-status` sets status on several candidates at
  once (built for confirming attendance - tick the no-shows, set
  `WITHDRAWN` with reason `ABSENT`, confirm; since 2026-09-26 every
  withdrawal, before or after lock, records a reason, who and when); `bulk-promote` (on `/api/gradings/outcomes/`)
  promotes several finalised PASS outcomes at once, from one candidate to a
  whole cohort. All five process rows **independently**: each runs
  its row through the domain service inside its own savepoint, and one row's failure never blocks the others. Every response
  lists what succeeded plus an `errors` map keyed by row index for what
  did not. A `bulk-register` row's `testing_for_rank` is optional and
  resolves to that student's own next active rank when omitted, so a
  mixed-belt group registers in one request with no rank picked at all.
- **Registrations (2026-09-28)**: `bulk-register` is the only way to register
  a candidate - there is no single-item create. While a session is `DRAFT`
  or `OPEN`, each roster row offers "Move…" (`PATCH` the registration's
  `session` to another draft or open session; refused once an assessment has
  been prepared) and "Remove" (`DELETE`, which also removes any assessment
  work and is audited). Withdrawing stays the way to record that a candidate
  did not grade.
- Assessment generation copies applicable requirements into immutable snapshot
  rows. Results are `NOT_ASSESSED`, `MET`, `NOT_MET`.
- **Locking ends grading (2026-09-26)**: results are recorded and assessments
  completed only while the session is `OPEN`, and it cannot lock until every
  non-withdrawn assessment is `COMPLETED`. Until then a completed assessment
  can be reopened for correction (`POST .../assessments/{id}/reopen/`,
  audited), from a "Reopen for correction" control on the sealed record. A
  registration always starts `REGISTERED`.
- Candidate outcomes: `DRAFT` / `PROPOSED` / `FINALISED`, `PASS` / `FAIL` /
  `CONDITIONAL`. Finalised outcomes are immutable.
- The outcome proposal drawer, cohort-exception review, student
  status/edit dialogs, single-student promotion confirmation, grading-session
  deletion confirmation, and grading-session lifecycle confirmation
  (open/lock/complete/cancel/delete) move focus to their primary or safest
  control, trap keyboard focus while open, restore focus to the launcher when
  closed, and retain the page-scroll lock during the interaction. The lifecycle
  modal's opener is a dropdown item that unmounts in the same render as the
  modal mounting; focus is moved onto the still-mounted dropdown trigger first
  so restoration lands there rather than on `document.body`. Every dialog in
  the app - including the audit event detail, attendance/withdrawal, and
  user-management create/password-reset dialogs - uses the same
  `useDialogFocus` contract; none can be closed while its request is in
  flight.
- **Accessibility pass (2026-09-20)**: every implemented route carries a
  landmark (`<section aria-labelledby>`/`aria-label`); the four that didn't
  (grading-session detail, cohort builder, promotion ledger, candidate
  assessment) were fixed. Loading states use `role="status"`; field-level
  validation errors use `role="alert"` and are wired to their input via
  `aria-describedby` (AddStudentScreen, the student edit modal, and both
  user-management dialogs); the candidate-assessment live count is
  `aria-live="polite"` (the progress ledger until 2026-09-24, the mat bar
  since). `UsersScreen`'s table now has `scope="col"` headers
  like every other table in the app. A global `prefers-reduced-motion: reduce`
  override was added (`theme.css`) - previously only one component respected
  it, leaving ~10 modal/drawer/spinner animations unguarded. Fixed four
  `grid-template-columns` rules missing `minmax(0, …)` (Overview, Create
  Grading Session, Student Detail, Build Cohort) and two non-reflowing table/
  button patterns (Promotion Ledger), which caused page-level horizontal
  overflow at narrow widths; verified page-level overflow is now zero across
  every route in light/dark at 1280px and 390px, and at the 640px viewport
  WCAG 1.4.10 treats as equivalent to 200% zoom on a 1280px display. Icon-only
  buttons, input/radio-group labelling, and colour-alone status indicators
  were audited app-wide with no violations found. Per-element contrast was
  measured for the four grading surfaces in slice 8 (below); elsewhere it has
  been checked visually only.
- **Promotion and rank history**: a finalised PASS can be promoted, updating
  `Student.current_rank` and writing an immutable `Promotion` record.
- **Locked sessions have an exit**: authorised post-lock withdrawal with a
  recorded reason, and `LOCKED -> CANCELLED` for an abandoned grading.
- **Deletion rules are model-level**, holding from `Model.delete()`,
  `QuerySet.delete()`, related managers, the shell and Django admin. Bulk
  deletes are all-or-nothing. A non-draft, non-cancelled session cannot be
  deleted by an instructor at all. **An administrator may delete a grading
  session in any status (2026-09-22, extended from cancelled-only)**,
  including `LOCKED`/`COMPLETED` sessions holding finalised outcomes and
  promotions: `delete_grading_session` pre-flight validates every
  candidate's promotion (refusing, all-or-nothing, if a later, different
  session's promotion has already superseded it), reverts each affected
  student's `current_rank`, and strips `Promotion`/`CandidateOutcome` rows
  before the ordinary cascade removes the rest - the `SESSION_DELETED`
  audit event, with `reverted_student_ranks` in its metadata, is the trail.
  Django admin has full parity with the API here (2026-09-23 fix): the
  admin's deletion validator now receives the logged-in user, and its
  actual delete routes through the same `delete_grading_session()`.
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
  actions. `PATCH /api/users/{id}/authority/` grants or revokes the four
  sensitive permissions as booleans in the same shape `/api/auth/me/`
  returns them, and refuses a user changing their own authority.
  `POST /api/users/{id}/set-password/` resets a password, validated by
  Django's configured password validators. `is_staff` and `is_superuser`
  are not part of the API.
- **Hard-delete for admin cleanup (2026-09-21)**: `DELETE /api/users/{id}/`
  and `DELETE /api/gradings/assessments/{id}/` are genuine hard deletes, for
  corruption or test-data cleanup rather than routine correction, gated to
  Administrator-only permissions and refusing self-deletion. Every
  attribution foreign key stays `PROTECT` in principle - `delete_platform_user`
  keeps that promise by reassigning every reference (grading sessions,
  candidates, assessments, outcomes, promotions, audit events) to a seeded
  "Deleted User" placeholder account rather than nulling or cascading it
  away, and `delete_candidate_assessment` cascades through the assessment's
  outcome/promotion (reverting the student's rank) rather than leaving them
  orphaned, refusing when a later promotion has already superseded it. Both
  bypass immutability guards on `Promotion`, finalised `CandidateOutcome`
  and `AuditEvent` deliberately, at one documented call site each, rather
  than by omission. See the 2026-09-21 decision log entry. **Since
  2026-09-26 the audit trail keeps the person**: every event copies the
  actor's email and name when written (`actor_email`, `actor_name`), so
  re-pointing `actor` to the placeholder no longer hides who acted, and the
  `USER_DELETED` event records the deleted account's email, name and role
  alongside who deleted it. The placeholder is hidden from the Users API and
  Django admin, and the model refuses to make it active from any path, so it
  can never be signed into.
- **Self-service account updates**: `PATCH /api/auth/me/` lets a signed-in
  user change their own first/last name only - email, role and authority
  stay administrator-only; the account menu's "Edit your name" form calls it
  and updates the signed-in user in place. `POST /api/auth/change-password/` lets a user
  change their own password, given their current one; throttled the same
  way login is, validated by the same password validators as every other
  password path, and never logs the value. Both are audited as the user's
  own action.
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
  administrators, holders of Master (final-decision) authority, and (since
  2026-09-21) any instructor individually granted the fourth sensitive
  permission, `can_view_grading_audit_log`** - a plain instructor holding
  none of the three gets 403, in both the API (`CanViewAuditLog`) and Django
  admin (`AuditEventAdmin.has_view_permission`/`has_module_permission`).
  Administrators read it through the Administrator group's
  `audit.view_auditevent` grant (since 2026-09-26; previously their role was
  checked directly); the Instructor group carries no such grant. For all
  three, user-management events (`USER_CREATED`, `USER_UPDATED`,
  `USER_AUTHORITY_CHANGED`, `USER_DELETED`) are additionally administrator-only
  - logistics, same as the Users API itself - so a Master or a
  `can_view_grading_audit_log` holder who is not an administrator still
  cannot see them; the existing `accounts.view_user` exclusion filter scopes
  the new permission automatically, with no separate filtering logic needed.
- **An administrator can never hold Master authority (2026-09-16)**:
  granting `can_make_final_grading_decision` to an administrator is refused
  (`PATCH /api/users/{id}/authority/`), and promoting a user who already
  holds it to administrator is refused too (`PATCH /api/users/{id}/`,
  `role`). Any number of instructors may hold it at once - a second Master
  is a normal outcome, not an exception (2026-09-25) - but an administrator
  never can; administrators hold every other capability, including the
  other two sensitive permissions.
- **The UI never decides from role (2026-09-26)**: `/api/auth/me/` reports
  each administrator capability from the permission its action checks, and
  whether the audit log is readable from the backend rule itself. Routes
  (one `RequireAccess` guard) and controls read those flags, so the UI cannot
  offer what the server will refuse.
- **Frontend authentication and shell**: login, logout, current-user bootstrap,
  responsive navigation, profile/password controls, and a four-state auth model
  that distinguishes "not signed in" from "could not reach the server". The
  login form distinguishes wrong credentials, CSRF failure, throttling, a
  server error, and a dropped connection - it does not tell a rate-limited
  user their password is wrong.
- **Routing is React Router** (`BrowserRouter`), replacing an earlier
  hand-rolled `pushState`/`popstate` pair - see the 2026-09-14 decision log
  entry. `RequireAuth` gates every route but `/login` on a signed-in session;
  loading and connection-error states render in place, on whatever path was
  requested, rather than redirecting - a dropped connection is not evidence
  the viewer is signed out.
- **Server state is TanStack Query**, replacing a hand-rolled effect and
  attempt-counter in `auth.tsx` - see the 2026-09-14 decision log entry.
  The session bootstrap is a `useQuery` on `GET /api/auth/me/`; login and
  logout are mutations that write straight into that query's cache on
  success, rather than each keeping its own copy of "am I signed in" state.
  Retries are off by default (`retry: false`): a 401/403 is a meaningful
  answer the instant it arrives, not a transient failure to paper over, and
  each `<App />` mount gets its own `QueryClient` rather than a module-level
  singleton, so one screen's cached session can never leak into another's.
- **Implemented frontend workflows**: operational overview, student list,
  student creation and detail/edit, administrator-only bulk student-roster
  import (upload, column mapping pre-filled from the file's own headers,
  row-by-row review with inline correction, commit), the syllabus cumulative
  current-knowledge ledger (FDR-041/SCR-025), grading-session list,
  create/detail/lifecycle controls, cohort registration, assessment snapshot
  preparation, item-level marking, outcome proposal and final decision, and
  the promotion ledger. The administrator-only historical-import wizard
  (upload the workbook, review rank-mapping suggestions per distinct source
  value - never auto-applied, commit) and the historical-records
  reconciliation screen (filter by link/void status; link to a student
  found by name/WKSA-ID search, unlink, resolve either rank, or void with a
  required reason) sit off the Gradings list header, administrator-only.
  A student's "Grading history" card shows the unified native-plus-historical
  timeline with `KukGrade`/`Historical` source badges and Did-Not-Attend
  rendered distinctly from Fail, rather than being derived from Promotions
  alone; the adjacent Rank history timeline's base node now reads "Initial
  rank recorded in KukGrade" instead of implying `student.created_at` is a
  join date.
  The access-controlled Audit route provides server-side action, entity, date
  and keyword filtering, pagination, and complete event detail without any
  mutation control; reachable by administrators, the designated Master, and
  any instructor granted `can_view_grading_audit_log`. The administrator-only
  Users workspace provides account creation, server-side search/role/status
  filters, account detail updates, the four independent authority controls,
  password reset, user-specific audit history, and a destructive account
  deletion action with a confirmation dialog. A candidate assessment can
  likewise be hard-deleted by an administrator, cascading through its
  outcome/promotion with a confirmation dialog. Session detail offers explicit
  bulk-first controls to prepare every missing assessment and then start every
  prepared assessment, bulk selection of candidates who did not attend before
  locking, and reasoned locked-session withdrawal only for a user with override
  authority. Individual assessment actions remain available for exceptions,
  and withdrawn records retain their reason, note, actor and timestamp.
- **Mat-side scoring is the Single Column Run (2026-09-24)**: SCR-026/FDR-042
  replaced SCR-019's dual-pane workspace. There is no category sub-rail -
  `CandidateAssessmentScreen` renders every requirement in one scroll in
  syllabus order, under sticky category headers that carry their own required
  progress. Requirement rows are divider-led rather than cards (FDR-008), and
  scoring offers two verdict targets: `NOT_ASSESSED` is an undo, not a peer, so
  it is a `Clear` that confirms inline and names the assessor and time it
  erases (FDR-045) - the `candidate_item_assessor_matches_result` constraint
  nulls both, and they cannot be restored. Assessor attribution renders on
  every scored row, not only failures; per-item notes are a textarea rather
  than a single-line input; and the live required count plus the completion
  action sit in a persistent mat bar. A `COMPLETED` assessment offers no
  scoring, note or clear affordance.
- **Completion review is the Certificate Proof (2026-09-24)**: SCR-027/FDR-043
  replaced SCR-020's dual-card ledger. `AssessmentCompletionScreen` renders the
  record as the document it becomes - candidate and rank transition, a core
  grading areas strip, a ledger per non-core category, every recorded
  `assessor_notes` value with its result and attribution, the assessment note,
  and a seal line that stays blank until the record is sealed. Provenance
  (`generated_at`, `generated_by_email`) and the served counts sit in a side
  column; there are no percentages. Two constraints drive the design: every
  note renders, not only those on `NOT_MET` items, because `assessor_notes`
  carries positive observations too; and the assessment note stays editable
  while unsealed, because completion is the only point at which
  `CandidateAssessment.notes` can be written and the 1A scoring screen has no
  overall-note control. Sealing requires an explicit proofread
  acknowledgement. A sealed record shows its seal and offers no write path.
  `CORE_CATEGORY_CODES` now lives in `syllabusCategories.ts`, shared with
  `SyllabusScreen`, so the syllabus and the permanent record cannot disagree
  about which categories are core areas.
- **Final decisions are the Cohort Adjudication Board (2026-09-28)**:
  SCR-028/FDR-044 replaced SCR-022's slide-over. `CohortAdjudicationScreen`
  (`/gradings/:id/decisions`) lists every non-withdrawn candidate with the
  served counts from each assessment's `overall` on the assessment list (one
  request for the cohort; only the row in focus fetches its full summary), the instructor
  proposal and an inline Pass / Conditional / Fail, beside a detail pane for
  the row in focus (`?candidate=` selects it). Decisions stage and then write
  one candidate at a time; a failed row keeps its error and stays staged, and
  only failed rows retry (FDR-028). A Conditional needs re-test requirements.
  If any of the four requests fails, the board says so and offers a retry
  rather than rendering an empty cohort. The detail pane shows every recorded `assessor_notes` value, as the proof
  sheet does. Controls appear only on a `LOCKED` session for a user with
  `can_make_final_grading_decision`; everyone else gets a read-only board.
- **The proposal drawer shows the board's evidence (2026-09-29)**: FDR-047
  restyled `OutcomeProposalDrawer` to the board's language. The "Sealed
  assessment" section is one component, `SealedAssessmentEvidence`, rendered
  by both the drawer and the board's detail pane, so the proposing instructor
  and the Master read the same served counts and every recorded note. The
  Pass / Conditional / Fail choice (`OUTCOME_CHOICES`) and its styles
  (`OutcomeControls.css`) are shared the same way. The drawer no longer
  recounts items or shows a percentage (FDR-046). The summary and item
  queries live once in `queries.ts`.
- **Dark, responsive and accessibility pass (2026-09-29)**: slice 8 measured
  the four grading surfaces (mat-side scoring, completion proof, the board and
  the proposal drawer) in a browser in light and dark at desktop, tablet and
  phone widths: text contrast per element, target sizes, horizontal overflow
  and every keyboard focus stop. Status text now meets 4.5:1 on its surface in
  both themes (`--color-warning` and `--color-success` darker in light,
  `--color-success` and `--color-danger` lighter in dark); filled status
  buttons use `--color-on-success` / `--color-on-danger`; focus outlines are
  the solid `--color-accent-strong` (at least 3:1 on every surface) rather
  than the translucent `--color-focus-ring`, which stays for input halos.
  Mat-side row tools and breadcrumbs are 44px targets. The chosen Pass /
  Conditional / Fail segment carries a check mark, not colour alone. On a
  phone the board's rows become cards so the decision controls stay on
  screen; choosing a row there moves focus to the detail pane, and after
  recording, focus moves to the result message.
- **API dates are parsed through one module (2026-09-24)**: `frontend/src/dates.ts`
  detects date-only values (`grading_date`, `Promotion.effective_date`,
  `Student.date_of_birth`, `GradingHistoryItem.date`) and splits them into
  local year/month/day, while timestamps (`created_at`, `promoted_at`,
  `generated_at`, `completed_at`) keep normal parsing so they render in the
  reader's own timezone. `new Date("2026-10-15")` is UTC midnight, so west of
  UTC date-only values previously rendered as the previous day - in
  `PromotionLedgerScreen` and `StudentDetailScreen`. The student's age band
  is the API's own `age_band_display`, never recomputed in the browser, and
  the age-band controls on the syllabus and cohort-builder screens read their
  bands and programmes from `/api/syllabus/age-bands/`. CI
  runs the frontend suite a second time with `TZ=America/Los_Angeles`, because
  the UTC runner cannot observe this class of bug: with the defect
  reintroduced, UTC passes and the non-UTC run fails 5 tests. Every screen
  formats through `dates.ts` - `formatShortDate`, `formatLongDate`,
  `formatDateTime`, `formatShortDateTime`, `formatTime`, `formatDayMonth`,
  `formatSessionDate` or `formatApiDate`, with "today"/"yesterday" decided by
  `calendarDaysAgo` - with no per-screen formatter of its own, and "today" for a date input or a
  comparison with a date-only value is `todayIsoDate()` (local), never
  `toISOString()` (UTC).
- **Frontend list correctness**: workflow views collect every API page when
  they need a complete cohort or reference set. User-facing Students and
  Gradings lists use server-side pagination; grading-session status, year, and
  title/location search are applied by the API rather than to one page in the
  browser.
- **Design tokens for the "Quiet Command" visual direction** live in
  `frontend/src/theme.css` as CSS custom properties (`--color-*`,
  `--font-sans`) - see `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md`,
  FDR-001 through FDR-004 and FDR-012. Styling is one stylesheet per feature
  area on those tokens, with `App.css` holding only the shell and shared
  primitives; a few literal colours remain (status tints). Belt colours are
  the `--belt-*` tokens, fixed across themes because they are physical belts. Dark
  mode follows `prefers-color-scheme` by default; an
  explicit Light/Dark/System choice sets
  `[data-theme]` on `<html>` instead, applied before first paint by an inline
  script in `index.html` so a stored choice does not flash the system default.
- **Login matches the SCR-008 concept screen**: a permanent two-panel layout
  (ink brand panel, form panel) rather than a single centered card - the
  other auth states (loading, connection failure) keep the old centered
  layout, since those screens are still unstarted design work. The brand
  panel hides below 56rem width; the form remains fully usable at phone
  width. Password has a show/hide toggle. Verified visually in light, dark
  and phone-width via local Playwright screenshots against the dev server.
- **Theme toggle**: an animated three-way Light/System/Dark control
  (`frontend/src/useTheme.ts`) on the login screen, persisted to
  `localStorage` (`kukgrade-theme`) and reusable by the future Settings page
  without a token rewrite. "System" (the default) tracks
  `prefers-color-scheme` live, including a change to the OS setting while the
  page is open. Login also says "Welcome back" only once this browser has
  ever seen a signed-in session (`kukgrade-has-signed-in` in `localStorage`,
  set on first successful authentication) - "Sign in" otherwise, since
  "Welcome back" implies a return visit that has not actually happened yet.
- **Frontend API types are generated**, not hand-written: `npm run
  generate:types` runs `openapi-typescript` against `backend/schema.yml` into
  `frontend/src/api/schema.ts`, and every type in `frontend/src/api.ts` is an
  alias onto it - see the 2026-09-14 decision log entry. Every custom action
  declares its real request and response (`@extend_schema`), and the bulk,
  summary, and import actions serialize through those same declared
  serializers, so the schema cannot describe a shape the API does not send.
  The schema splits request and response components
  (`COMPONENT_SPLIT_REQUEST`), so request payloads such as `StudentRequest`
  and `PatchedStudentRequest` are generated too, without the read-only fields
  a response carries.
  CI regenerates both the schema and the types and fails if either differs
  from what is committed. List-filter parameters are generated too: each view declares its filters
  once and the same declaration filters the queryset and documents the
  schema. The only hand-written API shapes are the error
  envelope, which `custom_exception_handler` builds outside DRF's
  serializer path, and the page envelope.
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
  Production sits behind Cloudflare and then Traefik, so the throttle trusts
  two proxy hops (`DJANGO_NUM_PROXIES=2`) to find the visitor's address.
- **Sessions end after two hours without a request** (`SESSION_COOKIE_AGE`,
  with `SESSION_SAVE_EVERY_REQUEST` sliding it forward). Nothing in the
  frontend polls, so an idle tab does not keep a session alive. Any request
  answered "not signed in" returns the viewer to sign-in (`AuthProvider`
  watches every query and mutation), not only the startup session check.
  Signing out, or being signed out, also drops every cached response, so
  the next person on that browser never sees the previous person's students
  or gradings.
- **Password validation is consistent everywhere an account can be
  created**: the users API, `SetPasswordSerializer`, and the Django admin
  add-user form all run the full configured validator set, including
  `UserAttributeSimilarityValidator` against the account's own email.
- **Sensitive actions cannot silently lose their authority class**: a
  permission-completeness test pins `finalise`, `promote` and `withdraw` to
  the per-user permission class each requires, independent of the ordinary
  `permission_map` check.

## Known Gaps

- Per-element contrast, target sizes and focus were measured on the four
  grading surfaces only; the rest of the app has been checked visually. The
  session screen's breadcrumb, banner button, search and filter are under
  44px.
- `frontend/src/App.test.tsx` still holds about 6,000 lines of screen tests
  that belong in per-screen files.
- The historical-workbook adapter has only been exercised on synthetic
  workbooks; a rehearsal on a sanitised copy of the real file is required
  before a production import.

## Not Implemented

- Offline/PWA storage and synchronisation; the frontend is online-first.
- Syllabus versioning: deliberately deferred, see the decision log.
- Data erasure: handled manually by decision, see the decision log.
- Production host integration, scheduled backups, and verified restore.

## Deferred Or Out Of Scope

Student or parent self-service, background workers, certificates, payments,
notifications, reports and exports.
