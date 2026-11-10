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
the `X-CSRFToken` header on every `POST`, `PATCH` and `DELETE`. There are no API keys
or tokens, and students have no accounts.

Sign-in and password change are rate-limited. A request from an account that must change
its password is refused with `password_change_required` until it does.

## Areas

| Prefix | What it covers |
| --- | --- |
| `/api/auth/` | Sign in, sign out, current user, change own password |
| `/api/setup/` | First administrator setup (only until one exists) |
| `/api/users/` | Staff accounts, authority and temporary passwords (administrators) |
| `/api/students/` | Students, history and rank history |
| `/api/ranks/`, `/api/syllabus/` | Reference data, including the cumulative requirements for a rank and age band |
| `/api/gradings/sessions/` | Grading sessions and their lifecycle. The list leaves out archived sessions unless `archived=include` or `archived=only`; `<id>/archive/` and `<id>/restore/` (administrators) hide a completed or cancelled session or bring it back, and each session serves `archived_at`, `can_be_archived` and `can_be_restored`. A session holding a final decision cannot be deleted |
| `/api/gradings/candidates/` | Registrations, including bulk register and bulk status. The list and one registration also carry the candidate's assessment (with its overall counts), their outcome, their `promotion` (only for a viewer who may see promotions, otherwise null), `next_action` (the step their row offers, named by the server for whoever is asking) and `can_be_finalised` (whether a final decision can be recorded for them now), so a screen needs one request and holds no lifecycle rule |
| `/api/gradings/assessments/`, `/api/gradings/assessment-items/` | Assessments and item results; each item carries its `comments`, and `assessment-items/<id>/comments/` adds one (a comment is never edited or deleted). Changing an item's mark (PATCH) takes a `reason`: not needed for the first mark, required for every later change including clearing it; each item carries the `changes` log of who changed it, from what to what, when and why. The answer to a mark (PATCH) also carries `assessment_summary`, the assessment's counts as that save left them (the same as `assessments/<id>/summary/`), so a screen need not ask again; the list of items does not carry it. A completed assessment can still be corrected this way while the session is open (there is no reopen). After the lock only a user with `can_make_final_grading_decision` may PATCH a mark or add a comment, a `reason` is always required, and until that candidate's final decision is recorded; the change or comment then carries `after_lock: true`. Each assessment serves `marks_open`, whether the viewer may change marks and comments now (the screen follows it rather than re-deriving the rule) |
| `/api/gradings/outcomes/<id>/…` | Final decisions and promotions. There is no list of outcomes or promotions: a session's roster (`candidates/?session=`) carries each candidate's outcome and promotion. `candidates/<id>/propose-outcome/` opens the outcome record and proposes in one call, and a later call revises it; `outcomes/<id>/staged-decision/` and `outcomes/staged-decisions/` keep a Master's own unrecorded decisions |
| `/api/gradings/legacy-records/` | Imported historical records and their reconciliation |
| `/api/data-imports/` | Import batches, mapping, review and commit. A roster's columns are matched with `batches/<id>/mapping/` and its rows fixed one at a time (`rows/<row>/`); `batches/<id>/preview/` saves a historical import's rank choices and counts what it would do; `batches/<id>/commit/` takes no body and imports what is stored |
| `/api/audit-events/` | The audit log. `?subject=session:ID`, `student:ID`, `candidate:ID` or `user:ID` narrows it to one record and everything that belongs to it; `subject/?subject=…` names that record as it is now and says where to open it. `?search=` is the shared search (it also finds a student's events by their current name) |
| `/api/health/`, `/api/site/` | Liveness and public site settings |
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
so a misspelt filter never silently returns everything.

**Bulk endpoints** (register, generate, start, update status, promote) process each row
independently. The response lists what succeeded and an `errors` map keyed by row index
for what did not; one refusal never blocks the others. Bulk register also returns
`already_registered`, the error keys whose student is already registered (`THIS_SESSION`
or `ANOTHER_GRADING`), so a client tells those apart without reading message text.

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
