# API Contract

Every endpoint below is implemented. All are prefixed with `/api/`, return
JSON, and use Django session authentication with CSRF protection.

This document explains the contract; `backend/schema.yml` is its
machine-readable form. The schema declares every request body and every
success response, including the bulk, summary, and import actions, and
generates the frontend's TypeScript types. Error responses are not modelled
per endpoint: they all share the envelope in section 0b. CI fails if the
schema drifts from the serializers or the types drift from the schema. Nothing
is planned here: endpoints that do not exist yet (organisations, eligibility,
certificates, reports) are listed as deferred in `current-system.md`.

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
returns an empty page. A parameter the list does not declare at all - a
misspelling, or a filter that has been removed - is refused with a `400`
naming it, rather than ignored, which returned the unfiltered list; `page`,
`page_size` and `format` are accepted on every list. Each view declares its filters once
(`query_filters`, `kukgrade/filtering.py`), and that declaration both applies
them and publishes them in `backend/schema.yml`, which is the authoritative
list; the tables below summarise it.

Responses carry only the fields a screen reads. Anything the app does not
display or act on (a duplicate of another field, a denormalised name, an
attribution id) is left out and added back when a screen needs it; the
attribution itself stays in the database and the audit log. `schema.yml` is
the authoritative field list for every response, and the frontend types are
generated from it.

## 0b. Error responses

Every error response uses one envelope - including an unknown `/api/` URL,
which answers `404` with code `not_found`. The one deliberate exception is
`GET /api/ready/`, whose `503` is `{"status": "unavailable"}` for the
monitor that polls it:

```json
{"error": {"code": "validation_error",
           "message": "The request contained invalid data.",
           "fields": {"title": ["This field may not be blank."]}}}
```

- `code` is stable and machine-readable. Current codes: `validation_error`,
  `authentication_required`, `authentication_failed`, `permission_denied`,
  `password_change_required`, `not_found`, `method_not_allowed`,
  `csrf_failed`, `throttled`, `server_error`, `error`.
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

## 0c. Health, readiness and site settings

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | /api/health/ | Anonymous process liveness; returns `{"service":"kukgrade-backend","status":"ok"}`. |
| GET | /api/ready/ | Anonymous database readiness; returns `{"status":"ok"}` or `503` with `{"status":"unavailable"}`. Contains no database details. |
| GET | /api/setup/ | Anonymous: `{"setup_needed": bool}`, true until the deployment's first administrator exists. Sets the CSRF cookie the setup page needs. |
| POST | /api/setup/ | Anonymous, CSRF-checked, rate-limited like login: `{code, email, first_name?, last_name?, password}` creates the first administrator - a superuser - and signs them in (`201`, the current user). `code` is the one-time setup code from the server's log; a wrong, expired or already-used code, a password outside the policy, or any request once an administrator exists is a `400` field error. See `accounts/setup.py`. |
| GET | /api/site/ | Anonymous site settings: `club_name` from `KUKGRADE_CLUB_NAME` (default "Kuk Sool Won"), shown in the top bar, `time_zone` - the club's IANA zone from `TZ` (default `Europe/London`), in which the screens show times and decide what day it is - and `password_policy` - `{min_length, max_length, character_rules: [{code, label, pattern}], checked_on_save: [label]}`, the policy every password path enforces, which the password forms render as a checklist, and `wksa_id` - `{hint, forms: [{code, label, pattern, example}]}`, the two forms a WKSA ID may take and the rule in a sentence (the same one a refused ID is told), the student example using `KUKGRADE_SCHOOL_PREFIX` (default `206-2`). |
| GET | /api/about/ | Signed in. What is running, for the About page: `version` (one number, written in `kukgrade/version.py` and kept equal to `pyproject.toml` and `frontend/package.json` by a test), `commit` and `built_at` (from the `KUKGRADE_BUILD_COMMIT` and `KUKGRADE_BUILD_TIME` build arguments in `docs/deployment.md`; blank and null when run from a checkout), `time_zone` (the club's) and `database` (`ok` or `unavailable`). |

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
"new_password": "..."}`, each read exactly as sent - never trimmed, as
sign-in does not trim either. The current password must check out first - a
hijacked session alone is not enough to lock the real owner out. The new
password runs through the same Django password validators as every other
password path in the app. Returns `204` on success; the value is never
logged or included in the audit event it writes. The caller stays signed in -
the session's auth hash is refreshed, so picking a new password does not eject
them to the sign-in screen. Every *other* session for that account is ended.

### Forced password change

`must_change_password` is set whenever somebody other than the owner set the
account's password: creation, and `POST /api/users/{id}/set-password/`. While
it is set, the account may reach only `/api/auth/login/`, `/api/auth/me/`,
`/api/auth/change-password/`, `/api/auth/logout/`, `/api/health/`,
`/api/ready/`, `/api/site/` and the frontend shell. Every other endpoint answers `403` with
`error.code = "password_change_required"`, whatever the method. A successful
`POST /api/auth/change-password/` clears the flag and restores normal access.
Enforced by `accounts.middleware.ForcePasswordChangeMiddleware`, so it holds
for direct API callers and not only for the browser client. The Django admin
site is closed too: every admin page but signing out answers `403` with a page
saying to change the password in KukGrade first.

The admin site has no password form for your own account: its "Change
password" page and its reset page for your own user both point to the account
menu, so `/api/auth/change-password/` is the one way to change your own
password. Its reset page for anyone else takes no password - it asks to
confirm, then shows a generated temporary password once, as `set-password`
does, and so does its add-user page.

### Temporary passwords

Creation and `set-password` take no password: the server generates a
temporary one that passes the password policy, stores only its hash, and
returns it exactly once as `temporary_password` in an
`IssuedTemporaryPassword` body, sent with `Cache-Control: no-store`. It is
never logged, audited or served again; issuing another replaces it.

A temporary password expires `KUKGRADE_TEMPORARY_PASSWORD_HOURS` (default 24)
after it is issued, shown as `temporary_password_expires_at` on the managed
user (null for a password its owner chose). Once it has passed, the account
cannot sign in - through the API or the Django admin site - and a session
already open stops being signed in. The refusal is the same generic error as a
wrong password. An administrator issuing a new one is the way back; the
owner choosing their own password clears the expiry. Enforced by
`accounts.backends.AccountBackend`.

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
| POST   | /api/users/                  | Create a user. No `password`: returns `201` with the account and its generated `temporary_password`, once (see "Temporary passwords") |
| GET    | /api/users/{id}/             | Retrieve a user                               |
| PATCH  | /api/users/{id}/             | Update user details (not `password` - see below) |
| DELETE | /api/users/{id}/             | Hard-delete, gated to `accounts.delete_user` (Administrator group only). Refuses self-deletion. Reassigns every PROTECT attribution (grading sessions created, candidates withdrawn, assessments generated, outcomes proposed/decided, items assessed, promotions recorded, audit events) to a seeded "Deleted User" placeholder account rather than nulling it, then deletes the row. Records `USER_DELETED`. See `accounts.services.delete_platform_user` and the 2026-09-21 decision log entry. |
| PUT    | /api/users/{id}/             | 405; not exposed (`PATCH` covers every real edit) |
| PATCH  | /api/users/{id}/authority/    | Grant or revoke the four sensitive permissions, as booleans in the same shape as `/api/auth/me/`. An administrator cannot change their own authority. |
| POST   | /api/users/{id}/set-password/ | Reset another user's password: no request body; returns `200` with the account and a new generated `temporary_password`, once. Their previous password, temporary or not, stops working. Refused with 400 (`fields.user`) for your own account - change it with `/api/auth/change-password/` - and, unless you are a superuser, for an account that can use the Django admin site |

`is_staff` and `is_superuser` are not part of this API - it cannot hand out
Django admin access. An account that has it (a superuser's, or one a
superuser gave `is_staff`) is changed only by a superuser: any edit,
authority change, password reset or delete of it by anyone else is a `400`
(`fields.user`, "Only a superuser can change this account."). Nobody changes
their own `role` or `is_active` (`400`, "You cannot change your own role or
account status."). Each account carries `manageable`: whether the caller may
change it. `role` is `instructor` or `administrator`; changing
it moves the user between the corresponding permission groups. There is no
`/api/roles/` endpoint: roles are the two fixed values above, not a managed
resource. Responses include read-only `date_joined`, nullable `last_login`
and nullable `temporary_password_expires_at` timestamps. There is no invite
flow; account creation issues a generated temporary password that must be
changed at first sign-in.

## 3. Students

List, retrieve, create, update, and an administrator-only delete.

| Method | Endpoint                                   | Description                                      |
|-------|---------------------------------------------|--------------------------------------------------|
| GET   | /api/students/                              | List students; filters `status` (comma-separated), `current_rank_code`, `current_rank`, `age_band`, `eligible_for_session` (not Left, not yet a candidate of that session, and not registered for another grading that has not reached its result), `source_import` (only the students that import added), `search`. Each row's `age_band`, and the `age_band` filter, are on that session's grading date when `eligible_for_session` is given - as registration works it out - and today otherwise. Each row carries `current_grading`: `{session, session_title, stage, stage_display}` for the registration that has not reached its result (`stage` one of `REGISTERED`, `BEING_ASSESSED`, `ASSESSED`, `AWAITING_DECISION`, `AWAITING_PROMOTION`), or null. |
| POST  | /api/students/                              | Create a student profile                         |
| GET   | /api/students/{id}/                         | Retrieve a student profile                       |
| PATCH | /api/students/{id}/                         | Update student details                          |
| DELETE | /api/students/{id}/                        | Administrator-only hard delete, cascading through every registration/assessment/outcome/promotion involving the student; unlinks (never deletes) a linked legacy record. Requires `students.delete_student`. |
| PUT   | /api/students/{id}/                         | 405; not exposed                                 |
| GET   | /api/students/{id}/rank-history/            | Every promotion record, as `{"promotions": [...]}` |
| GET   | /api/students/{id}/grading-history/         | Finalised native outcomes + linked, non-voided legacy records, source-labelled |

The list representation omits `date_of_birth`; the detail representation
includes it. The list carries `can_be_graded` (false only for `LEFT`), which
the cohort builder filters on rather than re-deriving the rule. `wksa_id` must be a student ID (`NNN-N-NNN`, such as `206-2-150`) or a black belt ID
(`A-NNNNN`, such as `A-20819`); surrounding space is dropped and the `A`
upper-cased, and anything else is a `wksa_id` field error. A student at a
black belt rank (JKN and above) must hold a black belt ID. After creation the
ID changes through `PATCH` in two ways: a student ID to the black belt ID
WKSA hands out, or a mistyped ID of either form corrected (2026-10-20); a
black belt ID never goes back to a student ID. `wksa_id_can_change` on the
detail says whether the change to a black belt ID is still to come. A
corrected ID is not kept - it was never the student's, and may be someone
else's real number - only the edit's audit event records it. The student ID a
black belt ID replaces is kept: the
detail carries `previous_wksa_ids` (`[{wksa_id, replaced_at}]`, oldest first)
and `extra_information` (`[{label, value}]`, what an import's file said that
KukGrade has no field for),
the list's `search` matches a current or a previous ID, and a new student may
never take an ID any student has held, including a deleted student's
(`wksa_id` field error), because the school owner confirmed a number is never
reused. Promoting a student to a black belt
rank is refused until their black belt ID is recorded. See
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

Each rank carries `next_rank`: the id of the rank a student at this rank is
graded for next (the next active rank by order), or `null` at the top. It is
the same rule the grading services use (`RankQuerySet.next_active_after`), so
the frontend never works out rank progression itself.

Each rank also carries its belt: `belt_colour` (`WHITE`, `YELLOW`, `BLUE`,
`RED`, `BROWN`, `BLACK`), `stripe_colour` (the same colours, or blank for no
stripe) and `stripe_count`. A stripe rank is the belt below it with one stripe
of the colour it is working towards - Blue stripe is `YELLOW` with one `BLUE`
stripe - and Dahn Bo is `BROWN` with two `BLACK` stripes.

## 5. Syllabus Catalogue

Read-only lookup of the seeded WKSA Version 2014 syllabus. Syllabus writes
and version management are deferred.

| Method | Endpoint                              | Description                                      |
|--------|----------------------------------------|--------------------------------------------------|
| GET    | /api/syllabus/age-bands/               | The four age bands in order: `code`, `name`, `description`, `programme`, `programme_display` |
| GET    | /api/syllabus/requirements/effective/  | Everything a grading for a rank and age band assesses, in syllabus order - see below |

`SyllabusItem` represents the stable assessable item. `SyllabusRequirement`
maps that item to a target rank and age band, including `required`, `sequence`,
`start_number`, `end_number`, and concise notes. Numbered technique and weapon
ranges are stored on the requirement, not encoded into duplicate item records.
Form sections or parts from the source charts are currently preserved as notes.

### Effective (cumulative) requirements - FDR-041 / SCR-025, KG-A05

`GET /api/syllabus/requirements/effective/?rank_code=...&age_band=...`
(both required) returns one row per item examinable through the selected
rank, not just what that rank's own requirement rows list. It is the only way
requirements are read over the API, and assessment generation snapshots
exactly these rows (2026-09-29). Every category is included - the six core
areas (Etiquette, Fundamentals, Hand techniques, Kicking, Falling, Breaking),
Techniques, Forms and Weapons - in syllabus order: the chart's category
order, then the order items were introduced. For an item mapped at more than
one rank at or before the selection, the highest-order (most recent) mapping
supplies the effective range/notes; the lowest-order mapping supplies where
it was first introduced - see
`syllabus.services.effective_syllabus_requirements`. Paginated like every
other list endpoint. Besides the item, `category`, `category_display`, range
and notes it carries `category_is_core` (one of the six core grading areas),
`notation` (chart notation such as `Chart notation: (1/2).` normalised to
`Part 1 of 2`; a form taught in parts across ranks names every part taught
so far, so 8-and-under Cho Geup Hyung reads `Parts 1-3` from Red),
`introduced_rank_code`/`introduced_rank_name`, `effective_since_rank_code`/
`effective_since_rank_name`, and `is_new_at_rank` (true when the effective
row's rank is the selected rank itself). An empty page means no syllabus is
recorded for that rank and age band (White, KSN and above): earlier ranks'
content is never served as its curriculum. 400 with `rank_code`/`age_band`
field errors when either is missing or invalid.

`/api/syllabus/age-bands/` is reference data: each band's label, the
syllabus's name for its students, and the programme it is taught from
(`JUNIOR` - Junior & Little Dragon, `ADULT` - Adult & Youth). Every age-band
control reads it rather than restating the bands. It is gated to
`syllabus.view_syllabusrequirement`.

## 6. Grading Sessions

Sessions and candidates, plus assessment generation and the bulk actions.
Promotion is never automatic - see section 8.

| Method | Endpoint                              | Description                                      |
|-------|----------------------------------------|--------------------------------------------------|
| GET   | /api/gradings/sessions/                | List grading sessions; filters `status` (comma-separated), `grading_date_from`, `grading_date_to`, `search` (title/location), `ordering` (`grading_date` or `-grading_date`, newest first by default). Each row carries its served counts and `can_be_deleted`, the delete endpoint's rule for the requesting user |
| GET   | /api/gradings/sessions/years/          | `{"years": [...]}` - the distinct years of every session's date, newest first |
| POST  | /api/gradings/sessions/                | Create a grading session                         |
| GET   | /api/gradings/sessions/{id}/           | Retrieve a grading session                       |
| PUT   | /api/gradings/sessions/{id}/           | 405; not exposed (`PATCH` covers every real edit) |
| PATCH | /api/gradings/sessions/{id}/           | Update a grading session                         |
| DELETE| /api/gradings/sessions/{id}/           | Instructor: only DRAFT or CANCELLED, and a CANCELLED session with recorded assessment work is refused. Administrator: any status, including LOCKED/COMPLETED - cascades through finalised outcomes and promotions, reverting affected students' ranks, pre-flight validated all-or-nothing |
| GET   | /api/gradings/candidates/              | List grading candidates                          |
| POST  | /api/gradings/candidates/              | 405; register through `bulk-register`            |
| GET   | /api/gradings/candidates/{id}/         | Retrieve a grading candidate                     |
| PUT   | /api/gradings/candidates/{id}/         | 405; not exposed (`PATCH` covers every real edit) |
| PATCH | /api/gradings/candidates/{id}/         | Move the registration to another `session`; every other field is read-only here (withdrawal and status have their own actions) |
| DELETE| /api/gradings/candidates/{id}/         | Delete only while parent session is DRAFT or OPEN|
| POST  | /api/gradings/candidates/{id}/generate-assessment/ | Generate immutable assessment snapshot |
| POST  | /api/gradings/candidates/{id}/create-outcome/ | Create a draft outcome after completion |
| POST  | /api/gradings/candidates/{id}/withdraw/ | Withdraw from a *locked* session with a reason; requires `gradings.can_override_locked_session` |
| GET   | /api/gradings/withdrawal-reasons/      | The withdrawal reasons in order: `code`, `name`, `note_required` |
| POST  | /api/gradings/candidates/bulk-register/ | Register several candidates against one session in a single request, optionally generating their assessments too |
| POST  | /api/gradings/candidates/bulk-generate-assessments/ | Generate assessment snapshots for several candidates in a single request |
| POST  | /api/gradings/candidates/bulk-update-status/ | Set status (e.g. confirm attendance) on several candidates in a single request |

Every candidate response carries `from_rank` and `from_rank_name`: the rank the student held when registered, snapshotted on
the candidate and read-only. It does not move when the student is later
promoted, so a sealed assessment or a promotion ledger always shows where the
candidate actually started.

Every candidate response also carries `can_be_moved` and `can_be_removed`,
read-only booleans computed by the same validators as `PATCH` of `session` and
`DELETE`, so a client offers only what the server would accept.

A candidate is always created `REGISTERED`; `bulk-register` rows carry no
status or withdrawal fields. A registration's `student` never
changes: sending a different one is a `400` (remove the candidate and
register the right student instead). Setting
`status` to `WITHDRAWN` requires `withdrawal_reason` (`INJURY`, `WITHDREW`,
`ABSENT`, `OTHER`) and accepts a `withdrawal_note`, which `OTHER` requires -
the same rule holds on the locked-session `withdraw` action. The reasons, with
their labels and which needs a note, are served by
`GET /api/gradings/withdrawal-reasons/`; the
withdrawal records who made it and when, and is audited as
`CANDIDATE_WITHDRAWN`. Setting a withdrawn candidate back to `REGISTERED`
clears all four withdrawal fields.

Bulk endpoints process every row **independently**, not all-or-nothing: each
row is validated and saved through the same domain service a single change
would use, in its own savepoint. One row being refused does not stop
the others - registering ten students does not fail all ten because one of
them was already registered. Every bulk endpoint returns `200` with the same
two-key shape: the list of what succeeded, and an `errors` map keyed by the
zero-based index of each row that failed (e.g.
`{"1": ["Student is already registered for this session."]}`). A caller
always knows exactly which rows landed and which did not, and why. A refusal
is a validation error; an unexpected server error is not one, and still
fails the whole request with `500`, saving nothing. A row whose candidate,
assessment or outcome was removed or moved to another session while the
batch was starting is refused with a message saying so.

`POST /api/gradings/candidates/bulk-register/` body:

```json
{
  "session": 4,
  "candidates": [
    {"student": 12},
    {"student": 15},
    {"student": 20, "testing_for_rank": 6}
  ],
  "generate_assessments": false
}
```

A row's `testing_for_rank` is optional. When omitted it resolves to that
student's own next active rank - the same rank registration would insist on
anyway - so a mixed-belt group (some blue belts, a couple of white
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
- `cancellation_reason`: write-only. Sent when cancelling a locked session and
  never returned; it is kept on the record and in the audit log. The creator
  is recorded from the authenticated user and is not served either.
- `candidate_count`, `completed_assessment_count`, `awaiting_decision_count`:
  read-only progress, counted in the database for every session in a list
  (`gradings.services.with_session_progress`). A withdrawn candidate counts
  in none of them; awaiting a decision means a completed assessment whose
  outcome is not finalised.

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
on dates. Locking a session requires every non-withdrawn candidate's
assessment to be `COMPLETED` (2026-09-26): locking marks the end of grading, so
no result is recorded or changed after it. Assessment start must happen while
the session is `OPEN`.
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
- `age_band_display`: read-only label of the age-band snapshot, derived from
  the student's date of birth and the session's grading date.
- `status`: `REGISTERED`, `WITHDRAWN`, or `COMPLETED`; defaults to
  `REGISTERED`.
- `withdrawal_reason`, `withdrawal_reason_display` and `withdrawal_note`:
  read-only here. Every withdrawal - a draft/open no-show as well as a
  locked-session withdrawal - records why, who and when; who and when are kept
  on the record and in the audit log but not served (the database refuses a
  withdrawal without them, `gradings/0012`).
- `from_rank`, `from_rank_name`, `student_display_name`, `student_wksa_id`,
  `testing_for_rank_name`, `can_be_moved`, `can_be_removed`: read-only, see
  above.

Candidate filters:

- `session`

Candidate creation rejects locked, completed, and cancelled sessions; duplicate
student/session pairs; invalid testing-for ranks; missing student date of
birth; and a student still registered for another grading that has not
reached its result. A student is registered for one grading at a time: a
registration is settled once it is withdrawn, its session is cancelled, or
its outcome is finalised as Fail or Conditional, or as a Pass that has been
promoted. Reinstating a withdrawn registration is refused the same way. A
registration made in error is corrected by an administrator rather than by
registering again.

The testing-for rank must be the next active rank after the student's
current rank. That is checked when the rank is chosen - at registration, and
again when a registration is moved to another session or reinstated after a
withdrawal - not on every later change, so a registration whose student was
promoted at another grading can still be withdrawn (it cannot be promoted).
Registering a candidate does not itself change
`Student.current_rank` - that happens only on promotion, once the outcome is
finalised as `PASS` (see section 8).

A candidate's `session` can be changed through `PATCH` only while the parent
session is `DRAFT` or `OPEN`, and not once an assessment snapshot exists.
Status moves through `bulk-update-status` (and `withdraw` in a locked
session); `student`, `testing_for_rank` and `age_band` are fixed at
registration. Candidate `notes` are not served: no screen uses them, and they
are edited only in Django admin. Candidate `COMPLETED` is controlled by
assessment completion and cannot be spoofed through the candidate API.
Candidates with assessment snapshots can be deleted only while the session is
`DRAFT` and the assessment is `NOT_STARTED`.

Assessment generation snapshots the effective (cumulative) requirements for
the candidate's testing rank and age-band snapshot - exactly the rows
`GET /api/syllabus/requirements/effective/` serves, in the same order -
copying the requirement and item display data into immutable
candidate-specific rows, each with its `position`. A rank with no recorded
syllabus is refused with a `candidate` error naming the rank and age band.

## 7. Assessments

| Method | Endpoint                                             | Description                                          |
|-------|-------------------------------------------------------|------------------------------------------------------|
| GET   | /api/gradings/assessments/                            | List generated candidate assessments; filters include `status` (comma-separated). Each carries `overall`, the same counts block the `summary` action returns, computed from items prefetched in one query so the list's query count does not grow with the cohort. |
| PATCH | /api/gradings/assessments/{id}/                       | Update lifecycle status or notes only                |
| POST  | /api/gradings/assessments/                            | 405; use candidate generation action                 |
| POST  | /api/gradings/assessments/bulk-start/                 | Start several assessments in a single request        |
| GET   | /api/gradings/assessments/{id}/summary/               | Overall and per-category rollup for one assessment, at any status. Reachable before a `CandidateOutcome` exists - see the 2026-09-23 decision log entry and FDR-046. Gated to `gradings.view_candidateassessment`. |
| DELETE| /api/gradings/assessments/{id}/                       | Hard-delete, gated to `gradings.delete_candidateassessment` (Administrator group only, for corruption/test-data cleanup). Cascades through the assessment's outcome and promotion if either exists, reverting the student's rank; refuses when a later promotion has already superseded it. The candidate is registered again, so a new assessment can be prepared while the session is draft or open. Records `ASSESSMENT_DELETED`. See `gradings.assessment_services.delete_candidate_assessment` and the 2026-09-21 decision log entry. |
| GET   | /api/gradings/assessment-items/                       | List generated assessment snapshot items, in `position` order - each item's place in the assessment, from 1, in syllabus order |
| PATCH | /api/gradings/assessment-items/{id}/                  | Update `result` and `assessor_notes` only            |
| POST  | /api/gradings/assessment-items/                       | 405; arbitrary snapshot rows rejected                |
| DELETE| /api/gradings/assessment-items/{id}/                  | 405; correction workflow deferred                    |

Each item carries its snapshot's `display_range` and raw `requirement_notes`,
`category_is_core`, and `notation`: the syllabus endpoint's display wording
for the row (`Part 1 of 2`, `Parts 1-3`), copied when the assessment was
generated so a later syllabus edit never changes it; empty when there is no
chart notation.

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
- `status`

Assessment-item list filters:

- `assessment`

An assessment row includes the candidate id and student name, status,
lifecycle timestamps, notes, generator attribution, and `overall` (the served
counts). Per-category counts are served by the summary action below; no
pass/fail/conditional outcome is produced.

## 8. Outcomes and Promotions

| Method | Endpoint                                      | Description                                  |
|--------|-----------------------------------------------|----------------------------------------------|
| GET    | /api/gradings/outcomes/                       | List candidate outcomes                      |
| POST   | /api/gradings/outcomes/                       | 405; use candidate create-outcome action     |
| PATCH  | /api/gradings/outcomes/{id}/propose/          | Propose or revise PASS/FAIL/CONDITIONAL      |
| PATCH  | /api/gradings/outcomes/{id}/finalise/         | Final authorised Master decision             |
| POST   | /api/gradings/outcomes/{id}/promote/          | Promote a finalised PASS; requires `gradings.can_promote_student` |
| POST   | /api/gradings/outcomes/bulk-promote/           | Promote several finalised PASS outcomes in one request |
| GET    | /api/gradings/promotions/                     | List promotion records (rank history)        |

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

An outcome row exposes its candidate id, status, the proposed and final
decisions with their labels, who proposed and decided (by name) and when, the
proposal and decision notes, and conditional requirements. Clients cannot
write `status`, candidate, assessment, actor, or timestamp fields directly.

The assessment summary action groups `CandidateAssessmentItem` rows by copied snapshot
category, in the syllabus chart's category order. It returns `overall` and
per-category counts for total, required, met, not met, not assessed,
required-met, required-not-assessed and all-required-assessed; each category
carries its code (`category`). It does not return an inferred final outcome.

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

`Promotion` records are immutable and undeletable once created: there is no
detail route to write to. `GET /api/gradings/promotions/` reads them back; `GET /api/students/{id}/rank-history/` (section 3)
returns one student's promotions in one call, which is the more convenient
read for a single student's history.

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

- `session`

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
the same filter excludes them automatically with no separate logic. There is
no single-event route, so the list is the only way to read an event.

| Method | Endpoint                    | Description                          |
|--------|------------------------------|---------------------------------------|
| GET    | /api/audit-events/           | List audit events, newest first; each carries `action_display` and `entity_type_display`, the names to show |
| GET    | /api/audit-events/labels/    | `{actions: [{value, label}], entities: [{value, label}]}`: the event and record types the caller may filter by, named - user-management actions only for those who may read them. The audit screen's filters keep no list of their own. |

Every event has `actor_email` and `actor_name` (who acted, copied when the
event was written; empty for a system action - the `actor` foreign key is
kept on the row but not served), `action`, `entity_type` and `entity_id` (plain strings, not a foreign key, so
a record outlives the schema it describes), `occurred_at`, a human-readable
`summary`, and `metadata` (a `{"before": {...}, "after": {...}}` object for a
revision, `{}` otherwise). The model is append-only: no admin, API, queryset
or shell path can update or delete a row. The one exception is deleting a
user, which re-points `actor` to the deleted-user placeholder; `actor_email`
and `actor_name` are untouched, so the event still names who acted. The
`search` filter matches those two fields.

Filters:

- `action`
- `entity_type` - one of `AuditEntity` (`audit/models.py`): the model name of what the event is about. Recording an event about any other model is refused, so the list is complete.
- `entity_id`
- `occurred_from`
- `occurred_to`
- `search` (summary, entity type/id, or actor name/email)

**Written by admin too.** Django admin routes its writes through the same
service functions as the API (`GradingSessionAdmin`, `GradingCandidateAdmin`,
`StudentAdmin`, `UserAdmin`), so a session, candidate, student or user
created, edited, deleted or given a new password through admin is audited and
attributed to whoever is signed in, exactly as if it had gone through the API.
Admin's `is_staff`/`is_superuser` flags, which the API never sets, are audited
as `USER_UPDATED`; groups and per-user permissions are read-only in admin, so
Master authority is granted only through `set_user_authority` and its rules.
`SESSION_UPDATED` records a session's changed details and
`ASSESSMENT_UPDATED` an assessment's changed notes, each with both versions.

## 10. Data Imports (Admin only)

Status: implemented for both batch kinds - student-roster import
(2026-09-21) and historical grading-workbook migration (2026-09-22). See
`docs/data-import-and-legacy-migration.md`.

| Method | Endpoint                                        | Description                                      |
|--------|--------------------------------------------------|---------------------------------------------------|
| GET    | /api/data-imports/batches/                        | List imports, newest first; filters `status` (comma-separated), `kind`; requires `data_imports.view_importbatch` |
| GET    | /api/data-imports/batches/{id}/                   | One import: kind, status, file, who and when, `next_step` (`MATCH_COLUMNS`, `REVIEW`, `CLOSED`), `detected_headers`, `column_mapping`, `defaults`, `extra_columns`, `sheet`, `sheet_names`, `suggested_mapping` (a roster's likely column for each field), `target_fields` (a roster's fields: `field`, `name`, `needed`, `whole_file`), `rank_mappings` (a historical import's chosen rank code by spelling, lowercased), `grading_sheets` (a historical workbook's grading sheets read), `warnings` (what reading the file left out), `row_counts`; requires `data_imports.view_importbatch` |
| POST   | /api/data-imports/batches/                        | Upload a source file (`multipart/form-data`: `kind`, `file`, and for a roster workbook optionally `sheet`, else the sheet it opens on); every row is read and stored; requires `data_imports.add_importbatch` |
| POST   | /api/data-imports/batches/{id}/sheet/             | `{sheet}`: read a roster from another sheet of its workbook (one of `sheet_names`); the rows are read again and the column matches, whole-file values, kept columns and fixes go; requires `data_imports.change_importbatch` |
| POST   | /api/data-imports/batches/{id}/void-records/      | `{reason}`: void every record a finished historical import created, each with its own audit event; records already voided are left; returns `{voided}`; requires `gradings.can_reconcile_imported_history` |
| POST   | /api/data-imports/batches/{id}/mapping/           | A roster's `column_mapping` (each column the file's own, used once), optional `defaults` (`current_rank` and/or `status`, used where a row has none; a needed field with neither is typed into each row as a fix, the row needing attention until it is) and `extra_columns` (columns kept as each new student's `extra_information`); stores them and checks every row; returns the import; requires `data_imports.change_importbatch` |
| GET    | /api/data-imports/batches/{id}/rows/              | The stored rows, paginated, in file order; filters `outcome`, `search`, `corrected` (rows with or without a fix of the importer's), `filled` (`current_rank` or `status`: a roster's rows the file gave no value for that field and nobody typed one in, so the whole-file value or KukGrade's default was used), `worth_a_look` (rows with or without `issues`), `rank_text` (a historical import's rows writing a rank that way, held or tested for, any case), `record_kind` (a historical import's rows of these kinds, comma-separated); each has `values` by KukGrade field, `extra` (its kept columns), `cells` (a roster row's every cell by heading, as the file has it), `file_values` (a roster row's matched fields as the file has them, before any fix), `issues` (a roster row's problems; a historical record's reasons to look at it - a rank not matched yet or marked uncertain, an outcome KukGrade does not know, a sheet note - none of which stops the import), `issue_fields` (the fields a roster row's issues are about), `outcome`, `excluded`, `corrected_fields`, `created_id`; requires `data_imports.view_importbatch` |
| PATCH  | /api/data-imports/batches/{id}/rows/{row_number}/ | Fix a roster row's values by field (null takes a fix away); every row is checked again; requires `data_imports.change_importbatch` |
| POST   | /api/data-imports/batches/{id}/rows/{row_number}/exclusion/ | `{excluded}`: leave a row out of the import, or bring it back; requires `data_imports.change_importbatch` |
| POST   | /api/data-imports/batches/{id}/rows/leave-out-attention/ | Leave out every roster row still needing attention, in one go; every row is checked again; returns the import; requires `data_imports.change_importbatch` |
| POST   | /api/data-imports/batches/{id}/preview/           | Store the mapping (and, if sent, every row's corrections) and check every row; nothing is committed; requires `data_imports.change_importbatch`, as it stores what it is given |
| POST   | /api/data-imports/batches/{id}/commit/            | Re-check every stored row and commit, all-or-nothing; a roster with any row still needing attention is refused (`rows`), nothing imported; with no body the stored mapping, fixes and rank choices are used; requires `data_imports.can_commit_import` |
| POST   | /api/data-imports/batches/{id}/cancel/            | Delete the temp file, mark the batch cancelled; requires `data_imports.change_importbatch` |

`kind` is `STUDENT_ROSTER` (`.xlsx`/`.csv`) or `LEGACY_GRADINGS` (`.xlsx`
only). An upload over a size, row, column or sheet limit, or one that cannot
be read, is refused with a `400` on `file` and nothing is stored; so is a
historical workbook with no records in it, with the parser's warnings as
further messages. `preview`/`commit` request/response shape depends on
`kind`:

Commit returns the import as `GET /{id}/` does, with `summary_json` (safe
counts only). A field left out of a `preview` or `commit` body keeps what is
stored rather than being emptied.
Creating a batch returns its `id` plus three one-shot fields that are not
stored: `already_imported_warning` (the same file was already committed),
`detected_headers` (a roster's own header row), and `suggested_mapping` (a
best-effort column mapping to pre-fill, never applied automatically).

- **`STUDENT_ROSTER`**: request body `column_mapping` (target field ->
  source header, required fields
  `wksa_id`/`first_name`/`last_name`/`date_of_birth`/`current_rank`) and an
  optional `corrections` map (`{"<row_number>": {"<field>": "<value>"}}`,
  where each field is one of the six target fields; others are ignored)
  for fixing a `REVIEW_REQUIRED` row without re-uploading the file. Preview
  response rows carry `outcome` (`READY`/`REVIEW_REQUIRED`/`SKIP_EXISTING`),
  per-row `issues`; a `SKIP_EXISTING` row is never modified. `row_number` is
  the row's own number in the sheet (header is 1; blank rows are skipped).
  A commit that finds a `READY` row can no longer be created - a concurrent
  change - fails as a whole with a `400` on `rows` naming that row.
- **`LEGACY_GRADINGS`**: request body `rank_mappings`
  (`{"<source rank text>": "<Rank.code or null>"}`, one entry per *distinct*
  value across the batch, not per row - `null`/omitted means "leave
  unresolved" and never blocks a row from committing). Preview response
  carries `total`/`grading_result`/`auxiliary_note`/`did_not_attend`
  counts, `unresolved_current_rank`/`unresolved_testing_for_rank`/
  `unresolved_outcome` counts, `excluded`, `worth_a_look` (records not left
  out that have issues), `warnings` (e.g. an unrecognised sheet), and
  `rank_suggestions` (`source_text`, `suggested_rank_code` - the club's
  fixed spellings included, such as "White Belt" or "DBN", never applied
  automatically - `doubtful` where the workbook marks it with "?", and
  `rows`, how many records use it). Saving `rank_mappings` finds each
  record's issues again. Commit creates
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
| GET    | /api/gradings/legacy-records/                                  | List, newest cycle first; filters `linked`, `voided`, `batch`, `needs_rank`, `awaiting_link` (someone's record not yet linked: not voided, not a sheet note), `source_name` (exact, any case), `search`; each record has `current_rank_name`, `testing_for_rank_name`, `report` (its comments), `note`, `source_section`, `source_batch` |
| GET    | /api/gradings/legacy-records/people/                           | Records grouped by the name as written, each with `record_ids`, `records`, `first_period`/`last_period`, `linked_student`, `shared` and up to five suggested `candidates` (`student`, `full_name`, `wksa_id`, `current_rank_name`, `status_display`, `score`, `reasons`); filters `batch`, `linked`; paginated; reconcilers only. Suggestions only - nothing is linked |
| POST   | /api/gradings/legacy-records/bulk-link/                        | Body `{"links": [{"record", "student"}], "replace"?}`, at most 500; all or nothing, each audited; a refusal is keyed by the record's id |
| POST   | /api/gradings/legacy-records/{id}/link-student/                | Body `{"student": <id>, "replace"?}`; links to a `Student`; a record linked to someone else moves only with `replace` |
| POST   | /api/gradings/legacy-records/{id}/unlink-student/               | No body; refused if not currently linked          |
| POST   | /api/gradings/legacy-records/{id}/resolve-current-rank/         | Body `{"rank": <id or null>}`                     |
| POST   | /api/gradings/legacy-records/{id}/resolve-testing-for-rank/     | Body `{"rank": <id or null>}`                     |
| POST   | /api/gradings/legacy-records/{id}/void/                        | Body `{"reason": "<text>"}`; reason required, refused if already voided. A voided record cannot be linked, unlinked or given a rank |

No ordinary `POST`/`PATCH`/`DELETE` on this resource - a record is created
only by an `LEGACY_GRADINGS` batch commit, and every field except
`student`/`current_rank`/`testing_for_rank`/the void fields is immutable
after creation (source text is preserved verbatim; a model-level `clean()`
rejects any other change). Physical deletion is never possible through any
path - void is the only removal, and it is itself one-shot. Each action
records its own audit event (`LEGACY_GRADING_LINKED`/`_UNLINKED`/
`_RANK_RESOLVED`/`_VOIDED`) and never touches the record's source fields.

