# API

KukGrade's frontend is a client of a JSON HTTP API, and you can use it too. Every
endpoint is under `/api/`.

**The contract is [`backend/schema.yml`](../backend/schema.yml)**, an OpenAPI 3
document that declares every endpoint, request body and success response. It is
generated from the code, and CI fails if it is out of date, so it cannot drift. Load
it into any OpenAPI viewer (Swagger UI, Redoc, Postman) for an interactive reference.
This page covers the conventions the schema does not.

## Authentication

Sessions and CSRF, as in any Django site. Sign in with `POST /api/auth/login/`
(email and password); the response sets the `sessionid` and `csrftoken` cookies. Send
the `X-CSRFToken` header on every `POST`, `PUT`, `PATCH` and `DELETE`. There are no API keys
or tokens, and students have no accounts.

Sign-in and password change are rate-limited. A request from an account that must change
its password is refused with `password_change_required` until it does.

## Areas

| Prefix | What it covers |
| --- | --- |
| `/api/auth/` | Sign in, sign out, current user, change own password |
| `/api/setup/` | First administrator setup (only until one exists) |
| `/api/users/` | Staff accounts, authority and temporary passwords (administrators). An instructor's account is made with its `rank`, one of `staff_ranks`; an administrator's has none |
| `/api/students/` | Students, history and rank history. Each student serves `next_rank` and `next_rank_name`: the rank they would grade for, or null at the top or when that rank has no syllabus recorded. The record also serves `can_be_deleted` (for the viewer) and `deletion_blocked_by`, the grading that keeps the student from being deleted yet |
| `/api/ranks/`, `/api/syllabus/` | Reference data, including the cumulative requirements for a rank and age band |
| `/api/gradings/sessions/` | Grading sessions and their lifecycle. `?year=` lists the sessions held in one year. The list leaves out archived sessions unless `archived=include` or `archived=only`; `<id>/archive/` and `<id>/restore/` (administrators) hide a completed or cancelled session or bring it back, and each session serves `archived_at`, `can_be_archived` and `can_be_restored`. A session holding a final decision cannot be deleted. Each session also says what its stage allows: `roster_open` (candidates can be added, changed and prepared), `marking_open` (assessments are started, marked and completed), `decisions_open` (final decisions are being made), the moves the viewer may ask for now (`can_open`, `can_lock`, `can_complete`, `can_cancel`; the move itself still checks that the grading is ready) and `cancel_reason_required`, plus `withdrawn_count` beside the other counts. `roster_open=true` lists only the sessions that still take candidates (draft or open) |
| `/api/gradings/candidates/` | Registrations, including bulk register and bulk status. The list and one registration also carry the candidate's assessment (with its overall counts), their outcome, their `promotion` (only for a viewer who may see promotions, otherwise null), `next_action` (the step their row offers, named by the server for whoever is asking), `can_be_finalised` (whether a final decision can be recorded for them now), `can_be_marked_absent` (whether they can be withdrawn as a no-show now) and `can_prepare_assessment`, so a screen needs one request and holds no lifecycle rule. Every registration carries `student_first_name`. `?withdrawn=false` leaves withdrawn candidates out |
| `/api/gradings/assessments/`, `/api/gradings/assessment-items/` | Assessments and item results; each item carries its `comments`, and `assessment-items/<id>/comments/` adds one (a comment is never edited or deleted). Changing an item's mark (PATCH) takes a `reason`: not needed for the first mark, required for every later change including clearing it; each item carries the `changes` log of who changed it, from what to what, when and why. The answer to a mark (PATCH) also carries `assessment_summary`, the assessment's counts as that save left them (the same as `assessments/<id>/summary/`), so a screen need not ask again; the list of items does not carry it. A completed assessment can still be corrected this way while the session is open (there is no reopen). After the lock only a user with `can_make_final_grading_decision` may PATCH a mark or add a comment, a `reason` is always required, and until that candidate's final decision is recorded; the change or comment then carries `after_lock: true`. Each assessment serves `marks_open`, whether the viewer may change marks and comments now (the screen follows it rather than re-deriving the rule), and `can_start`; each item serves `reason_required` (whether its next change must say why) and `can_clear` (whether its mark may be taken away); the summary serves `can_complete`, as its counts leave the assessment |
| `/api/gradings/outcomes/<id>/…` | Final decisions and promotions. There is no list of outcomes or promotions: a session's roster (`candidates/?session=`) carries each candidate's outcome and promotion. `candidates/<id>/propose-outcome/` opens the outcome record and proposes in one call, and a later call revises it; `outcomes/<id>/staged-decision/` and `outcomes/staged-decisions/` keep a Master's own unrecorded decisions |
| `/api/gradings/legacy-records/` | Imported historical records and their reconciliation. `bulk-link/` links many records and `bulk-unlink/` (the Undo) lets go of many, each all or nothing with errors keyed by record id; `counts/` says how many records still await a student (`?batch=` for one import), for either role; `people-summary/` counts the names still to link by suggestion, `with_a_link` and `set_aside` |
| `/api/data-imports/` | Import batches, mapping, review and commit. A roster's columns are matched with `batches/<id>/mapping/` and its rows fixed one at a time (`rows/<row>/`); `batches/<id>/preview/` saves a historical import's rank choices and counts what it would do, naming for each rank as written the `chosen_rank_code` already chosen for it; `batches/<id>/commit/` takes no body and imports what is stored. Each batch serves `next_step` (the step it resumes at), `review_step` (the step after matching) and `uncovered_fields` (the needed roster fields no column or default covers yet); `batches/<id>/second-look/` counts what KukGrade filled in for the rows to be added. `?finished=true` lists the finished imports (imported, cancelled or expired) |
| `/api/audit-events/` | The audit log. `?subject=session:ID`, `student:ID`, `candidate:ID` or `user:ID` narrows it to one record and everything that belongs to it; `subject/?subject=…` names that record as it is now, with its kind, its ids (a candidate also names its grading, `session_id`) and whether it still `exists`; the app keeps its own routes. Each event serves `tone` (how it reads at a glance), `outcome_display` (the outcome a proposal or final decision records) and `details`, what it recorded beyond its summary as `{label, value}` pairs in words (the stored metadata, with its codes and ids, is not served). `?search=` is the shared search (it also finds a student's events by their current name) |
| `/api/health/`, `/api/site/` | Liveness and public site settings. The settings include `imports`: the upload size and row limits, how long a finished import's rows are kept, how many records one bulk link or unlink takes, each kind of import with the file types it reads and its named steps (`kinds`), and the standard roster template's header row |
| `/api/choices/` | Every list of choices the screens offer, with their names (signed-in users): session, student, candidate and assessment statuses (a student status also says what it means), item results, outcomes in the order the controls offer them, import kinds, finished import states, import row outcomes, roles, the four authorities (each with its description) and the ranks an instructor's account may hold (`staff_ranks`) |
| `/api/about/` | Build information, licence, contact addresses and (for administrators) the school's settings; also `documents/<slug>/` (licence, code of conduct, security policy), `pledge/`, `credits/` and `credits/notices/` (the full licence notices, as text) |

## Conventions

**Lists** are always paginated:

```json
{"count": 373, "next": "…?page=2", "previous": null, "results": []}
```

The default page size is 50; `?page_size=` goes up to 200. A page out of range is a 404.

**Filters** follow one rule on every list. A blank or absent parameter does not filter.
A value that cannot match (a non-numeric id, an unknown choice, a malformed date) returns
an empty page. A parameter the list does not declare is refused with a `400` naming it,
so a misspelt filter never silently returns everything. The same holds for an action that reads
parameters, such as `promotion-eligibility/?session=`: a required one that is missing or
malformed, or one it does not declare, is a `400` naming it.

**Edits** are a `PATCH` of what changes; nothing is replaced whole, so `PUT` answers
`405`, except a Master's staged decision (`outcomes/<id>/staged-decision/`), a draft
kept whole.

**Bulk endpoints** (register, generate, start, update status, promote) process each row
independently. The response lists what succeeded and an `errors` map keyed by the id of
the record each row names (the student for register, the candidate for generate and
status, the assessment for start, the outcome for promote) for what did not; one refusal
never blocks the others. Bulk register also returns `already_registered`, the error keys
(student ids) whose student is already registered (`THIS_SESSION`
or `ANOTHER_GRADING`), so a client tells those apart without reading message text.

**Choices** a screen lists are served as `{"value": …, "label": …}`, plus anything a
choice needs said about it, such as whether a withdrawal reason needs a note. The shared
lists come from `/api/choices/`; lists that belong to one area (audit event and record
types, withdrawal reasons) come with it. A record names its own value in a `*_display`
field beside it (`status_display`, `outcome_display`, `from_result_display`), so a client
never keeps its own copy of the names.

**People** a record names are served as `*_name` (`assessor_name`, `author_name`,
`decided_by_name`, the audit log's `actor_name`): their rank then and their name ("KSN Jane
Smith"), or "Jane Smith (administrator)". No record serves a person's email address.

**Errors** always use one envelope, including unknown URLs and server errors:

```json
{"error": {"code": "validation_error",
           "message": "The request contained invalid data.",
           "fields": {"title": ["This field may not be blank."]}}}
```

`code` is stable and machine-readable: `validation_error`, `authentication_required`,
`authentication_failed`, `permission_denied`, `password_change_required`, `not_found`,
`method_not_allowed`, `csrf_failed`, `throttled`, `server_error` or `error`. `fields`
appears only on `validation_error`. When a validation failure has a single message it is
promoted to `message`, since it is nearly always a domain rule worth showing as it is.
Server errors reveal nothing about the cause; that belongs in the logs.

**Responses carry only the fields a screen reads.** Fields are added when a screen
needs them. Sensitive fields are withheld from lists; for example the student list omits
date of birth, which appears only on a record someone deliberately opens.

## Changing the API

Declare the request and response in the backend, regenerate `backend/schema.yml` and
the frontend types, and update the tests together. See
[development.md](development.md#conventions).
