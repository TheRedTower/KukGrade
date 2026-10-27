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
| `/api/gradings/sessions/` | Grading sessions and their lifecycle |
| `/api/gradings/candidates/` | Registrations, including bulk register and bulk status |
| `/api/gradings/assessments/`, `/api/gradings/assessment-items/` | Assessments and item results |
| `/api/gradings/outcomes/`, `/api/gradings/promotions/` | Proposals, final decisions and promotions |
| `/api/gradings/legacy-records/` | Imported historical records and their reconciliation |
| `/api/data-imports/` | Import batches, mapping, review and commit |
| `/api/audit-events/` | The audit log |
| `/api/health/`, `/api/site/`, `/api/about/` | Liveness, public site settings, build information |

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
for what did not; one refusal never blocks the others.

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
