# API Contract for Single-Discipline Grading App

Status: mixed current and target contract.

This document started as a broad target REST contract and now contains both
implemented endpoints and deferred target endpoints. Before building against an
endpoint, check the section notes and `docs/current-system.md`. Implemented
current endpoints are authentication, health, users/roles, ranks, syllabus
lookup, students, grading sessions, grading candidates, candidate assessments,
assessment items, candidate outcomes, promotions, and audit events.
Organisations/branches, eligibility, certificates, and reports are target or
deferred unless a section explicitly says otherwise.

This document defines REST endpoints for the grading management system.  All endpoints are prefixed with `/api/` and return JSON responses. Authentication uses Django session authentication with CSRF protection for the React frontend.

## 0. Response conventions

All list endpoints return a page envelope:

```json
{"count": 373, "next": "...?page=2", "previous": null, "results": [...]}
```

Default page size 50, `?page_size=` overridable to a maximum of 200, and an
out-of-range page returns 404. Detail endpoints and custom actions return the
object directly. See `backend/README.md` for the rationale.

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

## 1. Authentication

| Method | Endpoint              | Description                       |
|-------|------------------------|-----------------------------------|
| POST  | /api/auth/login/       | Authenticate with email and password and establish a session |
| POST  | /api/auth/logout/      | Clear the current session |
| GET   | /api/auth/me/          | Get the current user profile       |

`/api/auth/login/` is rate-limited to 10 requests per minute per client IP
(`error.code = "throttled"` past that). No other endpoint is throttled.

`/api/auth/me/` returns `can_make_final_grading_decision`,
`can_promote_student` and `can_override_locked_session`, all **computed from
the caller's Django permissions** rather than stored. Use them to hide
affordances; the server remains the enforcement boundary. `role` is
`instructor` or `administrator` and carries no authority of its own.

Login failures use a generic error and must not reveal whether an account exists. Unsafe session-authenticated requests require a CSRF token. The React frontend obtains the CSRF cookie from `/api/auth/me/` during startup and sends credentials with API requests.

## 2. Users and Roles (Admin only)

Status: implemented, list/retrieve/create/update, plus two dedicated actions.
Permission `accounts.view_user` / `add_user` / `change_user`, held only by the
Administrator group.

| Method | Endpoint                      | Description                                   |
|--------|------------------------------|-----------------------------------------------|
| GET    | /api/users/                  | List users; filters `role`, `search`          |
| POST   | /api/users/                  | Create a user; requires `password`, validated against Django's password validators |
| GET    | /api/users/{id}/             | Retrieve a user                               |
| PATCH  | /api/users/{id}/             | Update user details (not `password` - see below) |
| PUT, DELETE | /api/users/{id}/         | 405; not exposed (every attribution FK is `PROTECT`; deactivate via `is_active` instead) |
| PATCH  | /api/users/{id}/authority/    | Grant or revoke the three sensitive permissions, as booleans in the same shape as `/api/auth/me/`. An administrator cannot change their own authority. |
| POST   | /api/users/{id}/set-password/ | Reset a user's password; validated the same way as creation |

`is_staff` and `is_superuser` are read-only through this API - it cannot hand
out Django admin access. `role` is `instructor` or `administrator`; changing
it moves the user between the corresponding permission groups. There is no
`/api/roles/` endpoint: roles are the two fixed values above, not a managed
resource. No self-service password change or invite flow - both need email,
which this system does not have.

## 3. Organisation and Branches

Status: target/deferred. These API endpoints are not implemented on `dev`.

| Method | Endpoint                          | Description                                       |
|--------|------------------------------------|---------------------------------------------------|
| GET    | /api/organisations/                | List organisations (V1 returns one)               |
| POST   | /api/organisations/                | Create an organisation (initially internal only)  |
| GET    | /api/organisations/{id}/           | Retrieve organisation details                     |
| PATCH  | /api/organisations/{id}/           | Update organisation                               |
| GET    | /api/branches/                     | List all branches                                 |
| POST   | /api/branches/                     | Create a branch                                   |
| GET    | /api/branches/{id}/                | Retrieve branch details                           |
| PATCH  | /api/branches/{id}/                | Update branch details                             |

## 4. Students

Status: implemented, list/retrieve/create/update. Deferred: `DELETE`
(every relationship to a student is `PROTECT` and history is retained by
decision - deactivate via `status` instead), eligibility and recommendation
endpoints (not part of any accepted design).

| Method | Endpoint                                   | Description                                      |
|-------|---------------------------------------------|--------------------------------------------------|
| GET   | /api/students/                              | List students; filters `status`, `current_rank_code`, `search` |
| POST  | /api/students/                              | Create a student profile                         |
| GET   | /api/students/{id}/                         | Retrieve a student profile                       |
| PATCH | /api/students/{id}/                         | Update student details                          |
| PUT, DELETE | /api/students/{id}/                   | 405; not exposed                                 |
| GET   | /api/students/{id}/rank-history/            | Current rank plus every promotion record         |

The list representation omits `date_of_birth`; the detail representation
includes it. `wksa_id` is writable on create and read-only afterwards. See
`docs/current-system.md` for the rationale.

## 5. Ranks and Pathways

Current implementation note: the rank foundation exposes a read-only
authenticated `/api/ranks/` endpoint for the seeded active rank catalogue.
Writable rank and pathway endpoints are deferred until progression pathway and
syllabus management workflows are confirmed.

| Method | Endpoint                                  | Description                                       |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | /api/ranks/                                | List ranks (ordered)                              |
| GET    | /api/ranks/{id}/                           | Retrieve rank details                             |
| POST   | /api/ranks/                                | Deferred                                          |
| PATCH  | /api/ranks/{id}/                           | Deferred                                          |
| GET    | /api/rank-pathways/                        | Deferred                                          |
| POST   | /api/rank-pathways/                        | Deferred                                          |
| GET    | /api/rank-pathways/{id}/                   | Deferred                                          |
| PATCH  | /api/rank-pathways/{id}/                   | Deferred                                          |

## 6. Syllabus Catalogue

Current implementation note: the syllabus foundation exposes authenticated
read-only lookup endpoints for seeded WKSA Version 2014 syllabus items and
rank/age-band requirements. Syllabus version management, grading-session
selection, assessment results, scoring, attendance, and promotion decisions are
deferred.

| Method | Endpoint                              | Description                                      |
|--------|----------------------------------------|--------------------------------------------------|
| GET    | /api/syllabus/items/                   | List active syllabus items                       |
| GET    | /api/syllabus/items/{id}/              | Retrieve a syllabus item                         |
| POST   | /api/syllabus/items/                   | 405; API writes deferred                         |
| PUT    | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| PATCH  | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| DELETE | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| GET    | /api/syllabus/requirements/            | List active requirements                         |
| GET    | /api/syllabus/requirements/{id}/       | Retrieve a syllabus requirement                  |
| POST   | /api/syllabus/requirements/            | 405; API writes deferred                         |
| PUT    | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |
| PATCH  | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |
| DELETE | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |

Requirement list filters:

- `rank_code`: rank catalogue code, such as `YELLOW` or `DAHN_BO`.
- `age_band`: one of `AGE_8_AND_UNDER`, `AGE_9_TO_12`, `AGE_13_TO_17`, or
  `AGE_18_AND_OVER`.

`SyllabusItem` represents the stable assessable item. `SyllabusRequirement`
maps that item to a target rank and age band, including `required`, `sequence`,
`start_number`, `end_number`, and concise notes. Numbered technique and weapon
ranges are stored on the requirement, not encoded into duplicate item records.
Form sections or parts from the source charts are currently preserved as notes.

## 7. Eligibility (V2)

Status: target/deferred. These API endpoints are not implemented on `dev`.

| Method | Endpoint                                 | Description                                        |
|--------|-------------------------------------------|----------------------------------------------------|
| POST   | /api/eligibility/recalculate/             | Trigger recalculation for all students             |
| GET    | /api/eligibility/students/                | List students with eligibility status              |
| GET    | /api/eligibility/students/{student_id}/   | Retrieve eligibility for a specific student        |

## 8. Grading Sessions

Current implementation note: the grading foundation exposes authenticated CRUD
endpoints for sessions and candidates, plus generated candidate assessment
snapshots, per-requirement item results, candidate outcomes, authorised final
Master decisions, and promotion (`Student.current_rank` updates and rank
history - see section 10). It does not create automatic promotion,
attendance outside grading participation, certificates, notifications, or
payment workflows.

| Method | Endpoint                              | Description                                      |
|-------|----------------------------------------|--------------------------------------------------|
| GET   | /api/gradings/sessions/                | List grading sessions                            |
| POST  | /api/gradings/sessions/                | Create a grading session                         |
| GET   | /api/gradings/sessions/{id}/           | Retrieve a grading session                       |
| PUT   | /api/gradings/sessions/{id}/           | Replace a grading session                        |
| PATCH | /api/gradings/sessions/{id}/           | Update a grading session                         |
| DELETE| /api/gradings/sessions/{id}/           | Delete only when status is DRAFT or CANCELLED    |
| GET   | /api/gradings/candidates/              | List grading candidates                          |
| POST  | /api/gradings/candidates/              | Add a candidate to a draft or open session       |
| GET   | /api/gradings/candidates/{id}/         | Retrieve a grading candidate                     |
| PUT   | /api/gradings/candidates/{id}/         | Replace a grading candidate                      |
| PATCH | /api/gradings/candidates/{id}/         | Update candidate status or notes                 |
| DELETE| /api/gradings/candidates/{id}/         | Delete only while parent session is DRAFT or OPEN|
| POST  | /api/gradings/candidates/{id}/generate-assessment/ | Generate immutable assessment snapshot |
| POST  | /api/gradings/candidates/{id}/create-outcome/ | Create a draft outcome after completion |
| POST  | /api/gradings/candidates/{id}/withdraw/ | Withdraw from a *locked* session with a reason; requires `gradings.can_override_locked_session` |

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

Candidate fields:

- `session`: grading session id.
- `student`: student id.
- `testing_for_rank`: rank id.
- `age_band`: read-only snapshot derived from student date of birth and session
  grading date.
- `status`: `REGISTERED`, `WITHDRAWN`, or `COMPLETED`; defaults to
  `REGISTERED`.
- `notes`: optional notes.

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
finalised as `PASS` (see section 10).

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

## 9. Assessments

| Method | Endpoint                                             | Description                                          |
|-------|-------------------------------------------------------|------------------------------------------------------|
| GET   | /api/gradings/assessments/                            | List generated candidate assessments                 |
| GET   | /api/gradings/assessments/{id}/                       | Retrieve assessment detail and informational counts  |
| PATCH | /api/gradings/assessments/{id}/                       | Update lifecycle status or notes only                |
| POST  | /api/gradings/assessments/                            | 405; use candidate generation action                 |
| DELETE| /api/gradings/assessments/{id}/                       | 405; correction workflow deferred                    |
| GET   | /api/gradings/assessment-items/                       | List generated assessment snapshot items             |
| GET   | /api/gradings/assessment-items/{id}/                  | Retrieve assessment item snapshot and result         |
| PATCH | /api/gradings/assessment-items/{id}/                  | Update `result` and `assessor_notes` only            |
| POST  | /api/gradings/assessment-items/                       | 405; arbitrary snapshot rows rejected                |
| DELETE| /api/gradings/assessment-items/{id}/                  | 405; correction workflow deferred                    |

Assessment status values are `NOT_STARTED`, `IN_PROGRESS`, and `COMPLETED`.
Allowed lifecycle transitions are `NOT_STARTED -> IN_PROGRESS` and
`IN_PROGRESS -> COMPLETED`; direct `NOT_STARTED -> COMPLETED` is rejected.
`NOT_STARTED -> IN_PROGRESS` is allowed only while the session is `OPEN`.
Completed assessments and their items are immutable in this slice.

Assessment-item result values are `NOT_ASSESSED`, `MET`, and `NOT_MET`. The
server rejects item result changes until the parent assessment is explicitly
started. Result changes are allowed for `IN_PROGRESS` assessments while the
session is `OPEN` or `LOCKED`; locked sessions can finish work already in
progress but cannot start new assessments. The server sets `assessor` to
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

## 10. Outcomes and Promotions

| Method | Endpoint                                      | Description                                  |
|--------|-----------------------------------------------|----------------------------------------------|
| GET    | /api/gradings/outcomes/                       | List candidate outcomes                      |
| POST   | /api/gradings/outcomes/                       | 405; use candidate create-outcome action     |
| GET    | /api/gradings/outcomes/{id}/                  | Retrieve outcome detail                      |
| PATCH  | /api/gradings/outcomes/{id}/                  | 405; not a direct-write resource - use propose/finalise |
| DELETE | /api/gradings/outcomes/{id}/                  | 405; correction workflow deferred            |
| PATCH  | /api/gradings/outcomes/{id}/propose/          | Propose or revise PASS/FAIL/CONDITIONAL      |
| PATCH  | /api/gradings/outcomes/{id}/finalise/         | Final authorised Master decision             |
| GET    | /api/gradings/outcomes/{id}/summary/          | Informational assessment summaries           |
| POST   | /api/gradings/outcomes/{id}/promote/          | Promote a finalised PASS; requires `gradings.can_promote_student` |
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
category. It returns category and overall counts for total, required, met, not
met, not assessed, required-met, required-not-met, required-not-assessed,
all-required-assessed, and all-required-met values. It does not return an
inferred final outcome.

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
`/{id}/` read them back; `GET /api/students/{id}/rank-history/` (section 4)
returns a student's current rank plus every promotion in one call, which is
the more convenient read for a single student's history.

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

## 11. Certificates

Status: target/deferred. These API endpoints are not implemented on `dev`.

| Method | Endpoint                                           | Description                                      |
|--------|-----------------------------------------------------|--------------------------------------------------|
| POST   | /api/promotions/{promotion_id}/certificate/         | Generate a certificate PDF                       |
| GET    | /api/certificates/{id}/                            | Retrieve certificate metadata                    |
| GET    | /api/certificates/{id}/download/                   | Download certificate file                        |

## 12. Reports

Status: target/deferred. These API endpoints are not implemented on `dev`.

| Method | Endpoint                                | Description                                        |
|--------|------------------------------------------|----------------------------------------------------|
| GET    | /api/reports/eligibility/                | Report of students by eligibility status           |
| GET    | /api/reports/outcomes/                   | Report of grading outcomes (pass/fail/conditional) |
| GET    | /api/reports/rank-distribution/          | Distribution of students per rank                  |
| GET    | /api/reports/conditional-candidates/     | Deferred; list conditional candidates              |

## 13. Audit

Status: implemented, read-only. Permission `audit.view_auditevent`, granted
to **both** role groups - any signed-in user can read most of the log. This
is not a new exposure for grading events: an instructor can already read
every proposal and decision note through the outcomes API.

**Exception: user-management events are administrator-only.** `USER_CREATED`,
`USER_UPDATED` and `USER_AUTHORITY_CHANGED` are additionally filtered to
callers holding `accounts.view_user` - the same permission that gates
`/api/users/` itself. An instructor cannot open the Users API at all, so
reading who was created, edited, or granted Master authority through the
audit log instead would be the same information through a side door;
logistics is an administrator concern, matching the boundary drawn
everywhere else in this API. A direct `GET` on an excluded event's id
answers 404, the same as any other object outside the caller's queryset.

| Method | Endpoint                    | Description                          |
|--------|------------------------------|---------------------------------------|
| GET    | /api/audit-events/           | List audit events, newest first       |
| GET    | /api/audit-events/{id}/      | Retrieve one audit event              |

Every event has `actor` (nullable - null only for a system action),
`action`, `entity_type` and `entity_id` (plain strings, not a foreign key, so
a record outlives the schema it describes), `occurred_at`, a human-readable
`summary`, and `metadata` (a `{"before": {...}, "after": {...}}` object for a
revision, `{}` otherwise). The model is append-only: no admin, API, queryset
or shell path can update or delete a row.

Filters:

- `action`
- `entity_type`
- `entity_id`
- `actor`
- `occurred_from`
- `occurred_to`

**Written by admin too.** Django admin - the only usable interface until
Phase 3 ships grading screens - routes its writes through the same service
functions as the API (`GradingSessionAdmin`, `GradingCandidateAdmin`,
`StudentAdmin`, `UserAdmin`), so a session, candidate, student or user
created or edited through admin is audited and attributed to whoever is
signed in, exactly as if it had gone through the API.

---

This contract should be refined during implementation, but it provides comprehensive coverage of the backend endpoints needed for the grading application.
