# API Contract

Every endpoint below is implemented. All are prefixed with `/api/`, return
JSON, and use Django session authentication with CSRF protection.

This document explains the contract; `backend/schema.yml` is its
machine-readable form. The schema declares every request and response body,
including the bulk, summary, and import actions, and generates the frontend's
TypeScript types. CI fails if the schema drifts from the serializers or the
types drift from the schema. Nothing is planned here: endpoints that do not
exist yet (organisations, eligibility, certificates, reports) are listed as
deferred in `current-system.md`.

## 0. Response conventions

All list endpoints return a page envelope:

```json
{"count": 373, "next": "...?page=2", "previous": null, "results": [...]}
```

Default page size 50, `?page_size=` overridable to a maximum of 200, and an
out-of-range page returns 404. Detail endpoints and custom actions return the
object directly. See `backend/README.md` for the rationale.

List filters follow one rule on every endpoint: an absent or blank parameter
does not filter, and a value that cannot match - a non-numeric id, an unknown
choice, a malformed UUID or date, or a boolean other than `true`/`false` -
returns an empty page. Each view declares its filters once
(`query_filters`, `kukgrade/filtering.py`), and that declaration both applies
them and publishes them in `backend/schema.yml`, which is the authoritative
list; the tables below summarise it.

## 0b. Error responses

Every error response uses one envelope:

```json
{"error": {"code": "validation_error",
           "message": "The request contained invalid data.",
           "fields": {"title": ["This field may not be blank."]}}}
```

- `code` is stable and machine-readable. Current codes: `validation_error`,
  `authentication_required`, `authentication_failed`, `permission_denied`,
  `not_found`, `method_not_allowed`, `csrf_failed`, `throttled`, `error`.
- `message` is human-readable and safe to show. When a validation failure has
  exactly one message it is promoted here, because a lone message is nearly
  always a domain rule rather than a form error and should be usable as a
  toast without inspecting `fields`. Several messages leave a generic summary.
- `fields` is present **only** on `validation_error`. Keys mirror the
  serializer; errors raised at serializer level are keyed `non_field_errors`.
  Leaves are always plain strings.

Unhandled server errors (500) never reach DRF's exception handler, so they
are enveloped separately: `kukgrade.exceptions.server_error`, wired as
Django's `handler500`, returns the same `{"error": {...}}` shape with code
`server_error` and no detail about the cause - that belongs in the logs,
not the response.

## 0c. Health and readiness

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/health/ | Anonymous process liveness; returns `{"service":"kukgrade-backend","status":"ok"}`. |
| GET | /api/ready/ | Anonymous database readiness; returns `{"status":"ok"}` or `503` with `{"status":"unavailable"}`. Contains no database details. |

## 1. Authentication

| Method | Endpoint              | Description                       |
|-------|------------------------|-----------------------------------|
| POST  | /api/auth/login/       | Authenticate with email and password and establish a session |
| POST  | /api/auth/logout/      | Clear the current session |
| GET   | /api/auth/me/          | Get the current user profile       |
| PATCH | /api/auth/me/          | Update the caller's own first/last name only - not email, role or authority |
| POST  | /api/auth/change-password/ | Change the caller's own password, given their current one |

`/api/auth/login/` and `/api/auth/change-password/` are each rate-limited to
10 requests per minute per client IP (`error.code = "throttled"` past that).
No other endpoint is throttled.

`POST /api/auth/change-password/` body: `{"current_password": "...",
"new_password": "..."}`. The current password must check out first - a
hijacked session alone is not enough to lock the real owner out. The new
password runs through the same Django password validators as every other
password path in the app. Returns `204` on success; the value is never
logged or included in the audit event it writes.

`/api/auth/me/` returns `can_make_final_grading_decision`,
`can_promote_student`, `can_override_locked_session` and
`can_view_grading_audit_log` (the four grantable authorities), and the
capabilities `can_manage_users`, `can_import_data`,
`can_reconcile_imported_history`, `can_delete_students`,
`can_delete_assessments` and `can_delete_any_session`, each from the exact
permission its action checks, plus `can_read_audit_log`, the audit-log rule
itself. All are **computed on the server** rather than stored. The frontend
decides what to offer from these and never from `role`; the server remains
the enforcement boundary. `role` is `instructor` or `administrator` and
carries no authority of its own.

Login failures use a generic error and must not reveal whether an account exists. Unsafe session-authenticated requests require a CSRF token. The React frontend obtains the CSRF cookie from `/api/auth/me/` during startup and sends credentials with API requests.

## 2. Users and Roles (Admin only)

Status: implemented, list/retrieve/create/update, plus two dedicated actions.
Permission `accounts.view_user` / `add_user` / `change_user`, held only by the
Administrator group.

| Method | Endpoint                      | Description                                   |
|--------|------------------------------|-----------------------------------------------|
| GET    | /api/users/                  | List users; filters `role`, `is_active`, `search`. Excludes the "Deleted User" placeholder account. |
| POST   | /api/users/                  | Create a user; requires `password`, validated against Django's password validators |
| GET    | /api/users/{id}/             | Retrieve a user                               |
| PATCH  | /api/users/{id}/             | Update user details (not `password` - see below) |
| DELETE | /api/users/{id}/             | Hard-delete, gated to `accounts.delete_user` (Administrator group only). Refuses self-deletion. Reassigns every PROTECT attribution (grading sessions created, candidates withdrawn, assessments generated, outcomes proposed/decided, items assessed, promotions recorded, audit events) to a seeded "Deleted User" placeholder account rather than nulling it, then deletes the row. Records `USER_DELETED`. See `accounts.services.delete_platform_user` and the 2026-09-21 decision log entry. |
| PUT    | /api/users/{id}/             | 405; not exposed (`PATCH` covers every real edit) |
| PATCH  | /api/users/{id}/authority/    | Grant or revoke the four sensitive permissions, as booleans in the same shape as `/api/auth/me/`. An administrator cannot change their own authority. |
| POST   | /api/users/{id}/set-password/ | Reset a user's password; validated the same way as creation |

`is_staff` and `is_superuser` are read-only through this API - it cannot hand
out Django admin access. `role` is `instructor` or `administrator`; changing
it moves the user between the corresponding permission groups. There is no
`/api/roles/` endpoint: roles are the two fixed values above, not a managed
resource. Responses include read-only `date_joined` and nullable `last_login`
timestamps. There is no invite flow; account creation uses a temporary
password and marks it for mandatory change at first sign-in.

## 3. Students

List, retrieve, create, update, and an administrator-only delete.

| Method | Endpoint                                   | Description                                      |
|-------|---------------------------------------------|--------------------------------------------------|
| GET   | /api/students/                              | List students; filters `status`, `current_rank_code`, `age_band`, `search` |
| POST  | /api/students/                              | Create a student profile                         |
| GET   | /api/students/{id}/                         | Retrieve a student profile                       |
| PATCH | /api/students/{id}/                         | Update student details                          |
| DELETE | /api/students/{id}/                        | Administrator-only hard delete, cascading through every registration/assessment/outcome/promotion involving the student; unlinks (never deletes) a linked legacy record. Requires `students.delete_student`. |
| PUT   | /api/students/{id}/                         | 405; not exposed                                 |
| GET   | /api/students/{id}/rank-history/            | Current rank plus every promotion record         |
| GET   | /api/students/{id}/grading-history/         | Finalised native outcomes + linked, non-voided legacy records, source-labelled |

The list representation omits `date_of_birth`; the detail representation
includes it. `wksa_id` is writable on create and read-only afterwards. See
`docs/current-system.md` for the rationale.

`DELETE` (2026-09-22) is deliberately routine, not a rare erasure path -
see the 2026-09-22 decision log entry. It differs from most deletions in
this app in that nothing is preserved for the deleted student's own
grading records (contrast the assessment hard-delete below, or
`delete_platform_user`, which reassign attribution to a placeholder
instead of erasing it) - a linked `LegacyGradingRecord` is the one
exception, since it is independent evidence of an imported workbook, not
the student's own record.

`grading-history` (2026-09-22) is deliberately distinct from
`rank-history`: it combines finalised native `CandidateOutcome`s with
linked, non-voided `LegacyGradingRecord`s (see section 11) into one
newest-first list, each item tagged `"source": "KUKGRADE"` or `"LEGACY"`
with its own `date_precision` (`"DAY"` or `"MONTH"`). `rank-history` is
untouched and stays `Promotion`-only - a legacy Pass is never merged into
it.

## 4. Ranks

The seeded, read-only rank catalogue; ranks are maintained by migration.

| Method | Endpoint                                  | Description                                       |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | /api/ranks/                                | List active ranks in progression order            |
| GET    | /api/ranks/{id}/                           | Retrieve one rank                                 |

## 5. Syllabus Catalogue

Read-only lookup of the seeded WKSA Version 2014 syllabus. Syllabus writes
and version management are deferred.

| Method | Endpoint                              | Description                                      |
|--------|----------------------------------------|--------------------------------------------------|
| GET    | /api/syllabus/items/                   | List active syllabus items                       |
| GET    | /api/syllabus/items/{id}/              | Retrieve a syllabus item                         |
| GET    | /api/syllabus/requirements/            | List active requirements, attached directly to one rank |
| GET    | /api/syllabus/requirements/{id}/       | Retrieve a syllabus requirement                  |
| GET    | /api/syllabus/requirements/effective/  | Cumulative Technique/Form requirements examinable through a rank - see below |

Requirement list filters:

- `rank_code`: rank catalogue code, such as `YELLOW` or `DAHN_BO`.
- `age_band`: one of `AGE_8_AND_UNDER`, `AGE_9_TO_12`, `AGE_13_TO_17`, or
  `AGE_18_AND_OVER`.

`SyllabusItem` represents the stable assessable item. `SyllabusRequirement`
maps that item to a target rank and age band, including `required`, `sequence`,
`start_number`, `end_number`, and concise notes. Numbered technique and weapon
ranges are stored on the requirement, not encoded into duplicate item records.
Form sections or parts from the source charts are currently preserved as notes.

### Effective (cumulative) requirements - FDR-041 / SCR-025

`GET /api/syllabus/requirements/effective/?rank_code=...&age_band=...`
(both required) returns one row per `TECHNIQUE_SET`/`FORM` item examinable
through the selected rank, not just what that rank's own requirement rows
list. For an item mapped at more than one rank at or before the selection,
the highest-order (most recent) mapping supplies the effective range/notes;
the lowest-order mapping supplies where it was first introduced - see
`syllabus.services.effective_syllabus_requirements`. Paginated like every
other list endpoint. Fields beyond the plain-list shape: `notation` (chart
notation such as `Chart notation: (1/2).` normalised to `Part 1 of 2`),
`introduced_rank_code`/`introduced_rank_name`, `effective_since_rank_code`/
`effective_since_rank_name`, and `is_new_at_rank` (true when the effective
row's rank is the selected rank itself). 400 with `rank_code`/`age_band`
field errors when either is missing or invalid. The six universal core
grading areas (Etiquette, Fundamentals, Hand techniques, Kicking, Falling,
Breaking) are not part of this endpoint - they come from
`/api/syllabus/items/`, ordered to match the WKSA chart's own category
sequence rather than alphabetically.

## 6. Grading Sessions

Sessions and candidates, plus assessment generation and the bulk actions.
Promotion is never automatic - see section 8.

| Method | Endpoint                              | Description                                      |
|-------|----------------------------------------|--------------------------------------------------|
| GET   | /api/gradings/sessions/                | List grading sessions; filters `status`, `grading_date_from`, `grading_date_to`, `search` (title/location) |
| POST  | /api/gradings/sessions/                | Create a grading session                         |
| GET   | /api/gradings/sessions/{id}/           | Retrieve a grading session                       |
| PUT   | /api/gradings/sessions/{id}/           | Replace a grading session                        |
| PATCH | /api/gradings/sessions/{id}/           | Update a grading session                         |
| DELETE| /api/gradings/sessions/{id}/           | Instructor: only DRAFT or CANCELLED, and a CANCELLED session with recorded assessment work is refused. Administrator: any status, including LOCKED/COMPLETED - cascades through finalised outcomes and promotions, reverting affected students' ranks, pre-flight validated all-or-nothing |
| GET   | /api/gradings/candidates/              | List grading candidates                          |
| POST  | /api/gradings/candidates/              | Add a candidate to a draft or open session       |
| GET   | /api/gradings/candidates/{id}/         | Retrieve a grading candidate                     |
| PUT   | /api/gradings/candidates/{id}/         | Replace a grading candidate                      |
| PATCH | /api/gradings/candidates/{id}/         | Update session, testing-for rank, status or notes; `student` is fixed after registration |
| DELETE| /api/gradings/candidates/{id}/         | Delete only while parent session is DRAFT or OPEN|
| POST  | /api/gradings/candidates/{id}/generate-assessment/ | Generate immutable assessment snapshot |
| POST  | /api/gradings/candidates/{id}/create-outcome/ | Create a draft outcome after completion |
| POST  | /api/gradings/candidates/{id}/withdraw/ | Withdraw from a *locked* session with a reason; requires `gradings.can_override_locked_session` |
| POST  | /api/gradings/candidates/bulk-register/ | Register several candidates against one session in a single request, optionally generating their assessments too |
| POST  | /api/gradings/candidates/bulk-generate-assessments/ | Generate assessment snapshots for several candidates in a single request |
| POST  | /api/gradings/candidates/bulk-update-status/ | Set status (e.g. confirm attendance) on several candidates in a single request |

Every candidate response carries `from_rank`, `from_rank_code` and
`from_rank_name`: the rank the student held when registered, snapshotted on
the candidate and read-only. It does not move when the student is later
promoted, so a sealed assessment or a promotion ledger always shows where the
candidate actually started.

A candidate is always created `REGISTERED`: a `POST` with any other `status`,
or with a `withdrawal_reason`, is a `400`. A registration's `student` never
changes: sending a different one is a `400` (remove the candidate and
register the right student instead). Setting
`status` to `WITHDRAWN` requires `withdrawal_reason` (`INJURY`, `WITHDREW`,
`ABSENT`, `ADMIN_ERROR`) and accepts an optional `withdrawal_note`; the
withdrawal records who made it and when, and is audited as
`CANDIDATE_WITHDRAWN`. Setting a withdrawn candidate back to `REGISTERED`
clears all four withdrawal fields.

Bulk endpoints process every row **independently**, not all-or-nothing: each
row is validated and saved through the same domain service as its
single-item counterpart, in its own savepoint. One row failing does not stop
the others - registering ten students does not fail all ten because one of
them was already registered. Every bulk endpoint returns `200` with the same
two-key shape: the list of what succeeded, and an `errors` map keyed by the
zero-based index of each row that failed (e.g.
`{"1": ["Student is already registered for this session."]}`). A caller
always knows exactly which rows landed and which did not, and why.

`POST /api/gradings/candidates/bulk-register/` body:

```json
{
  "session": 4,
  "candidates": [
    {"student": 12},
    {"student": 15, "notes": "left knee strapped"},
    {"student": 20, "testing_for_rank": 6}
  ],
  "generate_assessments": false
}
```

A row's `testing_for_rank` is optional. When omitted it resolves to that
student's own next active rank - the same rank the single-item endpoint would
insist on anyway - so a mixed-belt group (some blue belts, a couple of white
belts, one brown stripe) registers in one request with no rank picked at all;
there is no rank that would even apply to the whole batch. It can still be
set explicitly per row to catch an out-of-turn request early.

When `generate_assessments` is `true`, each successfully registered
candidate also has its assessment generated immediately, in the same
savepoint as the registration - a row that registers but fails to generate
does not leave a candidate with no assessment behind, but a different row's
generation failure never blocks this row's registration.

Returns `200`:

```json
{
  "created": [
    {"candidate": { /* same shape as GET .../candidates/{id}/ */ }, "assessment": null},
    {"candidate": { ... }, "assessment": { /* same shape as generate-assessment */ }}
  ],
  "errors": {"2": ["Testing-for rank must be the next active rank after the student's current rank."]}
}
```

`POST /api/gradings/candidates/bulk-generate-assessments/` body:

```json
{"candidates": [101, 102, 103]}
```

Returns `200` with `{"created": [...generated assessments...], "errors": {...}}`.

`POST /api/gradings/candidates/bulk-update-status/` body:

```json
{"candidates": [101, 102], "status": "WITHDRAWN", "withdrawal_reason": "ABSENT"}
```

`withdrawal_reason` is required when `status` is `WITHDRAWN`; the whole
request is refused without it. The frontend's no-show action sends `ABSENT`.

Built for confirming attendance in bulk: tick the candidates who did not show
up, set `WITHDRAWN`, and confirm - the rest are left untouched. Uses the same
guard as a normal `PATCH` (status changes only while the parent session is
draft or open), applied per candidate, so one candidate's session already
being locked does not block the others. Returns `200` with
`{"updated": [...candidates...], "errors": {...}}`.

Session fields:

- `title`: required human-readable title.
- `grading_date`: required date.
- `status`: `DRAFT`, `OPEN`, `LOCKED`, `COMPLETED`, or `CANCELLED`; defaults to
  `DRAFT`.
- `location`: optional human-readable location.
- `notes`: optional notes.
- `created_by`: read-only; assigned from the authenticated user.

`grading_date` can be changed only before candidates are added. Once a session
has candidates, its date is fixed so stored candidate age-band snapshots do not
become silently inconsistent.

Session lifecycle:

- `DRAFT -> OPEN`
- `DRAFT -> CANCELLED`
- `OPEN -> LOCKED`
- `OPEN -> CANCELLED`
- `LOCKED -> COMPLETED`
- `LOCKED -> CANCELLED`: the locked-session exit. Requires
  `gradings.can_override_locked_session` and a non-blank
  `cancellation_reason` - an abandoned grading has to say why, since
  candidates have already been assessed by this point.

`CANCELLED` and `COMPLETED` are terminal. Sessions do not auto-transition based
on dates. Locking a session requires every non-withdrawn candidate to have an
assessment that is already `IN_PROGRESS` or `COMPLETED`; generation alone is
insufficient. Assessment start must happen while the session is `OPEN`. Locked
sessions can finish work already in progress but cannot start new assessments.
Completing a locked session requires every non-withdrawn candidate to have a
completed assessment and finalised candidate outcome. Withdrawn candidates do
not block locking or session completion. `LOCKED -> OPEN` is rejected now that
assessment records exist. Server code must use the canonical
`transition_grading_session()` domain service for status changes; ordinary model
saves reject direct status updates, and queryset `update()` is treated as a
low-level maintenance escape hatch, not an application workflow API. New
sessions start in `DRAFT`; API clients cannot create sessions directly in
`OPEN`, `LOCKED`, `COMPLETED`, or `CANCELLED`.

Session filters:

- `status`
- `grading_date`
- `grading_date_from`
- `grading_date_to`
- `search` (title or location)

A filter value that cannot match anything - an unknown status, a malformed
date or id - returns an empty page rather than an error. This holds for every
list endpoint.

Candidate fields:

- `session`: grading session id.
- `student`: student id.
- `testing_for_rank`: rank id.
- `age_band`: read-only snapshot derived from student date of birth and session
  grading date.
- `status`: `REGISTERED`, `WITHDRAWN`, or `COMPLETED`; defaults to
  `REGISTERED`.
- `notes`: optional notes.
- Locked-session withdrawal metadata is read-only on ordinary candidate
  responses: `withdrawal_reason`, `withdrawal_reason_display`,
  `withdrawal_note`, `withdrawn_by`, `withdrawn_by_email`,
  `withdrawn_by_name`, and `withdrawn_at`. These fields are populated only by
  the dedicated withdrawal action; routine draft/open no-show withdrawal has
  blank/null attribution metadata.

Candidate filters:

- `session`
- `student_wksa_id`
- `testing_for_rank_code`
- `age_band`
- `status`

Candidate creation rejects locked, completed, and cancelled sessions; duplicate
student/session pairs; invalid testing-for ranks; and missing student date of
birth. The testing-for rank must be the next active rank after the student's
current rank. Registering a candidate does not itself change
`Student.current_rank` - that happens only on promotion, once the outcome is
finalised as `PASS` (see section 8).

Candidate `student`, `testing_for_rank`, `status`, and `notes` can be changed
only while the parent session is `DRAFT` or `OPEN`. `age_band` is not client
writable. Once an assessment snapshot exists, `student`, `testing_for_rank`, and
`session` cannot be changed. Candidate `COMPLETED` is controlled by assessment
completion and cannot be spoofed through the candidate API. Candidates with
assessment snapshots can be deleted only while the session is `DRAFT` and the
assessment is `NOT_STARTED`.

Assessment generation uses active `SyllabusRequirement` rows for the candidate
testing rank and age-band snapshot in deterministic sequence order, then copies
the requirement and item display data into immutable candidate-specific
snapshot rows.

## 7. Assessments

| Method | Endpoint                                             | Description                                          |
|-------|-------------------------------------------------------|------------------------------------------------------|
| GET   | /api/gradings/assessments/                            | List generated candidate assessments                 |
| GET   | /api/gradings/assessments/{id}/                       | Retrieve assessment detail and informational counts  |
| PATCH | /api/gradings/assessments/{id}/                       | Update lifecycle status or notes only                |
| POST  | /api/gradings/assessments/                            | 405; use candidate generation action                 |
| POST  | /api/gradings/assessments/bulk-start/                 | Start several assessments in a single request        |
| GET   | /api/gradings/assessments/{id}/summary/               | Overall and per-category rollup for one assessment, at any status. Same service and response shape as `/api/gradings/outcomes/{id}/summary/`, but reachable before a `CandidateOutcome` exists - see the 2026-09-23 decision log entry and FDR-046. Gated to `gradings.view_candidateassessment`. |
| DELETE| /api/gradings/assessments/{id}/                       | Hard-delete, gated to `gradings.delete_candidateassessment` (Administrator group only, for corruption/test-data cleanup). Cascades through the assessment's outcome and promotion if either exists, reverting the student's rank; refuses when a later promotion has already superseded it. Records `ASSESSMENT_DELETED`. See `gradings.services.delete_candidate_assessment` and the 2026-09-21 decision log entry. |
| GET   | /api/gradings/assessment-items/                       | List generated assessment snapshot items             |
| GET   | /api/gradings/assessment-items/{id}/                  | Retrieve assessment item snapshot and result         |
| PATCH | /api/gradings/assessment-items/{id}/                  | Update `result` and `assessor_notes` only            |
| POST  | /api/gradings/assessment-items/                       | 405; arbitrary snapshot rows rejected                |
| DELETE| /api/gradings/assessment-items/{id}/                  | 405; correction workflow deferred                    |

Assessment status values are `NOT_STARTED`, `IN_PROGRESS`, and `COMPLETED`.
Allowed lifecycle transitions are `NOT_STARTED -> IN_PROGRESS` and
`IN_PROGRESS -> COMPLETED`; direct `NOT_STARTED -> COMPLETED` is rejected.
`NOT_STARTED -> IN_PROGRESS` is allowed only while the session is `OPEN`.
Completed assessments and their items are immutable - the `DELETE` above is
a distinct, administrator-only hard-delete for cleanup, not a correction
path.

`POST /api/gradings/assessments/bulk-start/` body:

```json
{"assessments": [201, 202, 203]}
```

A separate, deliberate action - not bundled into `bulk-generate-assessments`
or `bulk-register`, so a caller chooses whether to start assessments in bulk
or not, rather than it happening as a side effect of generating them. Same
independent-rows shape as every other bulk endpoint: each assessment starts
through the same validation as the single-item `PATCH`, in its own
savepoint, so one assessment that cannot start (already started, session no
longer open) does not block the rest. Returns `200` with
`{"started": [...assessments...], "errors": {...}}`.

Assessment-item result values are `NOT_ASSESSED`, `MET`, and `NOT_MET`. The
server rejects item result changes until the parent assessment is explicitly
started. Result changes and completion are allowed only while the session is
`OPEN`; a session cannot lock until every non-withdrawn assessment is
`COMPLETED`. `POST /api/gradings/assessments/{id}/reopen/` returns a
`COMPLETED` assessment to `IN_PROGRESS` (and its candidate to `REGISTERED`)
while the session is still `OPEN`, keeping every item result and its
attribution; it is audited as `ASSESSMENT_REOPENED` and needs
`gradings.change_candidateassessment`. The server sets `assessor` to
`request.user` and `assessed_at` when a result changes to `MET` or `NOT_MET`.
Resetting an item to `NOT_ASSESSED` before completion clears assessor metadata.
Result values are not aggregated into an overall candidate outcome.

Assessment list filters:

- `candidate`
- `session`
- `student_wksa_id`
- `testing_for_rank_code`
- `status`

Assessment-item list filters:

- `assessment`
- `candidate`
- `session`
- `item_code`
- `category`
- `result`
- `required`

Assessment detail includes candidate id, student name, WKSA ID, testing-for
rank code and name, candidate age-band snapshot, lifecycle timestamps, notes,
generator attribution, and informational item counts. Counts report total,
required, met, not met, and not assessed items only; no pass/fail/conditional
outcome is produced.

## 8. Outcomes and Promotions

| Method | Endpoint                                      | Description                                  |
|--------|-----------------------------------------------|----------------------------------------------|
| GET    | /api/gradings/outcomes/                       | List candidate outcomes                      |
| POST   | /api/gradings/outcomes/                       | 405; use candidate create-outcome action     |
| GET    | /api/gradings/outcomes/{id}/                  | Retrieve outcome detail                      |
| PATCH  | /api/gradings/outcomes/{id}/                  | 405; not a direct-write resource - use propose/finalise |
| DELETE | /api/gradings/outcomes/{id}/                  | 405; correction workflow deferred            |
| PATCH  | /api/gradings/outcomes/{id}/propose/          | Propose or revise PASS/FAIL/CONDITIONAL      |
| PATCH  | /api/gradings/outcomes/{id}/finalise/         | Final authorised Master decision             |
| GET    | /api/gradings/outcomes/{id}/summary/          | Informational assessment summaries. Identical payload to `/api/gradings/assessments/{id}/summary/`; both now declare `CandidateAssessmentSummary` rather than the viewset's own serializer. |
| POST   | /api/gradings/outcomes/{id}/promote/          | Promote a finalised PASS; requires `gradings.can_promote_student` |
| POST   | /api/gradings/outcomes/bulk-promote/           | Promote several finalised PASS outcomes in one request |
| GET    | /api/gradings/promotions/                     | List promotion records (rank history)        |
| GET    | /api/gradings/promotions/{id}/                | Retrieve one promotion record                |
| PUT, PATCH, DELETE | /api/gradings/promotions/{id}/    | 405; promotions are immutable and undeletable once created |

Outcome status values are `DRAFT`, `PROPOSED`, and `FINALISED`. Outcome values
are `PASS`, `FAIL`, and `CONDITIONAL`. Outcome creation is explicit after a
candidate has a completed assessment in a locked session; assessment completion
does not automatically create or infer an outcome.

Proposal records are explicit human recommendations. Proposal fields are
server-controlled for `proposed_by` and `proposed_at`, and proposals may be
revised before finalisation. Finalisation requires a proposed outcome, a
completed assessment, a locked parent session, and a user with
the `gradings.can_make_final_grading_decision` Django permission. The final
outcome may differ from the proposal. `decided_by` and `decided_at` are
server-controlled.

For `CONDITIONAL`, `conditional_requirements` is mandatory and blank-only text
is rejected. For `PASS` and `FAIL`, conditional requirements must be blank.
Finalised outcomes are immutable; ordinary delete, direct PATCH, direct model
status spoofing, and admin edits are rejected. `QuerySet.update()` remains an
unsupported low-level maintenance path.

Outcome list filters:

- `session`
- `candidate`
- `student_wksa_id`
- `testing_for_rank_code`
- `status`
- `proposed_outcome`
- `final_outcome`
- `proposed_by`
- `decided_by`

Outcome detail exposes candidate, student name, WKSA ID, testing rank, session,
assessment status, proposed decision, final decision, timestamps, attribution,
notes, and conditional requirements. Clients cannot write `status`, candidate,
assessment, actor, or timestamp fields directly.

The summary action groups `CandidateAssessmentItem` rows by copied snapshot
category, in the syllabus chart's category order. It returns `overall` and
per-category counts for total, required, met, not met, not assessed,
required-met, required-not-met, required-not-assessed, all-required-assessed,
and all-required-met; each category carries its code and its display label
(`category`, `category_display`). It does not return an inferred final
outcome.

### Promotion

`POST /api/gradings/outcomes/{id}/promote/` promotes a candidate whose outcome
is a finalised `PASS`. It requires the `gradings.can_promote_student` Django
permission - a separate authority from
`gradings.can_make_final_grading_decision`, so a Master who decided the
outcome does not automatically get to promote it, and vice versa. The request
body accepts only an optional `notes`; `effective_date` is
server-controlled and always equals the grading session's date, never a
client-supplied value. A second promotion attempt on the same outcome or the
same grading candidate is rejected - each can be promoted at most once. On
success it creates a `Promotion` record and updates `Student.current_rank`.

`Promotion` records are immutable and undeletable once created (`PUT`,
`PATCH`, `DELETE` all 405). `GET /api/gradings/promotions/` and
`/{id}/` read them back; `GET /api/students/{id}/rank-history/` (section 3)
returns a student's current rank plus every promotion in one call, which is
the more convenient read for a single student's history.

`POST /api/gradings/outcomes/bulk-promote/` promotes several outcomes in one
request - any quantity, from one to an entire cohort - independently per
row, same shape as the other bulk endpoints (see section 6): each outcome
runs through the same `promote_candidate()` validation as the single-item
action, in its own savepoint, so one outcome that is not eligible (not
finalised, not a `PASS`, already promoted) does not block the rest. Requires
the same `gradings.can_promote_student` authority. Body:

```json
{"outcomes": [201, 202, 203]}
```

Returns `200` with `{"promoted": [...promotion records...], "errors": {...}}`.

Promotion list filters:

- `student`
- `student_wksa_id`
- `from_rank_code`
- `to_rank_code`
- `session`
- `effective_date`
- `effective_date_from`
- `effective_date_to`
- `promoted_by`

## 9. Audit

Status: implemented, read-only. Access is restricted by `CanViewAuditLog` to
administrators, holders of Master final-decision authority, and (since
2026-09-21) any instructor individually granted the per-user
`gradings.can_view_grading_audit_log` permission - a fourth sensitive
permission alongside the three Master ones, granted the same way via
`PATCH /api/users/{id}/authority/`. An instructor holding none of the three
is refused. Administrators read it through the Administrator group's
`audit.view_auditevent`; the Instructor group has no such grant.

**Exception: user-management events are administrator-only.** `USER_CREATED`,
`USER_UPDATED`, `USER_AUTHORITY_CHANGED` and `USER_DELETED` are additionally
filtered to callers holding `accounts.view_user` - the same permission that
gates `/api/users/` itself. An instructor cannot open the Users API at all,
so reading who was created, edited, granted Master authority, or deleted
through the audit log instead would be the same information through a side
door; logistics is an administrator concern, matching the boundary drawn
everywhere else in this API. This is also what scopes a
`can_view_grading_audit_log` holder to grading/syllabus events and away from
user management - they hold that permission but not `accounts.view_user`, so
the same filter excludes them automatically with no separate logic. A direct
`GET` on an excluded event's id answers 404, the same as any other object
outside the caller's queryset.

| Method | Endpoint                    | Description                          |
|--------|------------------------------|---------------------------------------|
| GET    | /api/audit-events/           | List audit events, newest first       |
| GET    | /api/audit-events/{id}/      | Retrieve one audit event              |

Every event has `actor` (nullable - null only for a system action),
`actor_email` and `actor_name` (who acted, copied when the event was written;
empty for a system action), `action`, `entity_type` and `entity_id` (plain strings, not a foreign key, so
a record outlives the schema it describes), `occurred_at`, a human-readable
`summary`, and `metadata` (a `{"before": {...}, "after": {...}}` object for a
revision, `{}` otherwise). The model is append-only: no admin, API, queryset
or shell path can update or delete a row. The one exception is deleting a
user, which re-points `actor` to the deleted-user placeholder; `actor_email`
and `actor_name` are untouched, so the event still names who acted. The
`search` filter matches those two fields.

Filters:

- `action`
- `entity_type`
- `entity_id`
- `actor`
- `occurred_from`
- `occurred_to`
- `search` (summary, entity type/id, or actor name/email)

**Written by admin too.** Django admin routes its writes through the same
service functions as the API (`GradingSessionAdmin`, `GradingCandidateAdmin`,
`StudentAdmin`, `UserAdmin`), so a session, candidate, student or user
created or edited through admin is audited and attributed to whoever is
signed in, exactly as if it had gone through the API.

## 10. Data Imports (Admin only)

Status: implemented for both batch kinds - student-roster import
(2026-09-21) and historical grading-workbook migration (2026-09-22). See
`docs/data-import-and-legacy-migration.md`.

| Method | Endpoint                                        | Description                                      |
|--------|--------------------------------------------------|---------------------------------------------------|
| GET    | /api/data-imports/batches/                        | List import batches, newest first                |
| POST   | /api/data-imports/batches/                        | Upload a source file (`multipart/form-data`: `kind`, `file`); requires `data_imports.add_importbatch` |
| GET    | /api/data-imports/batches/{id}/                   | Retrieve one batch                                |
| POST   | /api/data-imports/batches/{id}/preview/           | Re-parse the stored file and classify it; nothing is committed; requires `data_imports.view_importbatch` |
| POST   | /api/data-imports/batches/{id}/commit/            | Re-validate and commit, all-or-nothing; requires `data_imports.can_commit_import` |
| POST   | /api/data-imports/batches/{id}/cancel/            | Delete the temp file, mark the batch cancelled; requires `data_imports.change_importbatch` |

`kind` is `STUDENT_ROSTER` (`.xlsx`/`.csv`) or `LEGACY_GRADINGS` (`.xlsx`
only). `preview`/`commit` request/response shape depends on `kind`:

Creating a batch returns the batch plus three one-shot fields that are not
stored: `already_imported_warning` (the same file was already committed),
`detected_headers` (a roster's own header row), and `suggested_mapping` (a
best-effort column mapping to pre-fill, never applied automatically).

- **`STUDENT_ROSTER`**: request body `column_mapping` (target field ->
  source header, required fields
  `wksa_id`/`first_name`/`last_name`/`date_of_birth`/`current_rank`) and an
  optional `corrections` map (`{"<row_number>": {"<field>": "<value>"}}`)
  for fixing a `REVIEW_REQUIRED` row without re-uploading the file. Preview
  response rows carry `outcome` (`READY`/`REVIEW_REQUIRED`/`SKIP_EXISTING`),
  per-row `issues`, and (for `SKIP_EXISTING`) the existing student's
  identity for comparison - the existing record is never modified.
- **`LEGACY_GRADINGS`**: request body `rank_mappings`
  (`{"<source rank text>": "<Rank.code or null>"}`, one entry per *distinct*
  value across the batch, not per row - `null`/omitted means "leave
  unresolved" and never blocks a row from committing). Preview response
  carries `total`/`grading_result`/`auxiliary_note`/`did_not_attend`
  counts, `unresolved_current_rank`/`unresolved_testing_for_rank`/
  `unresolved_outcome` counts, `warnings` (e.g. an unrecognised sheet),
  `rank_suggestions` (`source_text`, `suggested_rank_id`,
  `suggested_rank_code` - an exact-match suggestion only, never applied
  automatically), and the full parsed `rows` for display. Commit creates
  one `LegacyGradingRecord` per row (see section 11) - never a `Student`, a
  `Promotion`, or a `CandidateOutcome`.

No `DELETE` on a batch, and no endpoint downloads the raw source file back -
it is a server-side-only artefact between upload and commit/cancel/expiry.

## 11. Legacy Grading Records

Status: implemented (2026-09-22). Read access matches native grading
visibility (both roles); the five reconciliation actions are
Administrator-only (`gradings.can_reconcile_imported_history`).

| Method | Endpoint                                                    | Description                                      |
|--------|---------------------------------------------------------------|---------------------------------------------------|
| GET    | /api/gradings/legacy-records/                                  | List, newest cycle first; filters `student`, `linked`, `voided`, `record_kind`, `source_batch` |
| GET    | /api/gradings/legacy-records/{id}/                              | Retrieve one record                               |
| POST   | /api/gradings/legacy-records/{id}/link-student/                | Body `{"student": <id>}`; links to a `Student`    |
| POST   | /api/gradings/legacy-records/{id}/unlink-student/               | No body; refused if not currently linked          |
| POST   | /api/gradings/legacy-records/{id}/resolve-current-rank/         | Body `{"rank": <id or null>}`                     |
| POST   | /api/gradings/legacy-records/{id}/resolve-testing-for-rank/     | Body `{"rank": <id or null>}`                     |
| POST   | /api/gradings/legacy-records/{id}/void/                        | Body `{"reason": "<text>"}`; reason required, refused if already voided |

No ordinary `POST`/`PATCH`/`DELETE` on this resource - a record is created
only by an `LEGACY_GRADINGS` batch commit, and every field except
`student`/`current_rank`/`testing_for_rank`/the void fields is immutable
after creation (source text is preserved verbatim; a model-level `clean()`
rejects any other change). Physical deletion is never possible through any
path - void is the only removal, and it is itself one-shot. Each action
records its own audit event (`LEGACY_GRADING_LINKED`/`_UNLINKED`/
`_RANK_RESOLVED`/`_VOIDED`) and never touches the record's source fields.

