# Backend

Django and Django REST Framework API for KukGrade.

## Configuration

Settings fail closed. `DJANGO_DEBUG` defaults to **false**, and when debug is
off a missing `DJANGO_SECRET_KEY` raises `ImproperlyConfigured` rather than
falling back to a known key, so an unconfigured deployment refuses to start
instead of serving debug tracebacks signed with a key that is in the
repository.

With `DJANGO_DEBUG=false` the transport-security settings
(`SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`,
`SECURE_HSTS_PRELOAD`, `SECURE_PROXY_SSL_HEADER`) and the secure cookie flags
all default to their hardened values; each can be overridden individually to
opt out. The browsable API renderer is only registered when debug is on, so it
is never exposed in production. `manage.py check --deploy --fail-level WARNING`
is clean and is enforced in CI.

For local development copy `.env.example` to `.env` and export it, or set
`DJANGO_DEBUG=true` in your shell.

Tests and type checking use `kukgrade.settings_test`, which sets a development
environment and then star-imports the real settings module. This is necessary
because pytest imports Django settings before it loads `conftest.py`, so the
environment cannot be prepared there. The production branch of the real
settings module is covered directly by `kukgrade/tests.py`.

## Pagination

Every list endpoint is paginated, including bounded reference collections such
as `/api/ranks/`. There are no exemptions: the frontend needs one unwrap helper
rather than a table of which endpoints are enveloped, and no endpoint can
quietly grow into an unbounded response.

```json
{"count": 373, "next": "...?page=2", "previous": null, "results": [...]}
```

Default page size is 50, chosen so a single candidate's assessment (typically
around 40 snapshot items) fits on one page. Clients may pass `?page_size=` up
to a maximum of 200. An out-of-range `?page=` returns 404 rather than an empty
page. Detail endpoints and custom actions such as
`/api/gradings/outcomes/{id}/summary/` are not lists and are not enveloped.

## Commands

Install dependencies:

```sh
uv sync
```

Run checks:

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings
```

Run migrations against the local PostgreSQL database:

```sh
cd ..
docker compose up -d db
cd backend
uv run python manage.py migrate
```

Run the development server:

```sh
uv run python manage.py runserver 0.0.0.0:8000
```

The public health endpoint is available at `/api/health/`. Authenticated staff
can read the active rank catalogue at `/api/ranks/`; rank writes remain admin
and migration-managed for this foundation slice.

Authenticated staff can also read the syllabus catalogue:

- `/api/syllabus/items/`
- `/api/syllabus/items/{id}/`
- `/api/syllabus/requirements/`
- `/api/syllabus/requirements/{id}/`

Syllabus writes through the API are disabled. Requirement lists support
`rank_code` and `age_band` filters, for example:

```sh
GET /api/syllabus/requirements/?rank_code=YELLOW&age_band=AGE_9_TO_12
```

The current seed is deterministic reference data from the supplied WKSA Version
2014 Junior and Adult/Youth Testing Requirement Charts. Numbered ranges live on
`SyllabusRequirement`; form parts remain concise notes.

## Grading Sessions

Authenticated staff can manage grading sessions and candidates:

- `/api/gradings/sessions/`
- `/api/gradings/sessions/{id}/`
- `/api/gradings/candidates/`
- `/api/gradings/candidates/{id}/`
- `POST /api/gradings/candidates/{id}/create-outcome/`

Session statuses are `DRAFT`, `OPEN`, `LOCKED`, `COMPLETED`, and `CANCELLED`.
Allowed transitions are `DRAFT -> OPEN`, `DRAFT -> CANCELLED`,
`OPEN -> LOCKED`, `OPEN -> CANCELLED`, and `LOCKED -> COMPLETED`.
`LOCKED -> OPEN` is rejected. Completed and cancelled sessions are terminal.
Code must use the canonical `transition_grading_session()` service for status
changes; ordinary model saves reject direct status updates. New sessions start
in `DRAFT`; normal API and admin workflows cannot create already-open, locked,
completed, or cancelled sessions.

`OPEN -> LOCKED` requires every non-withdrawn candidate to have an assessment
that is already `IN_PROGRESS` or `COMPLETED`; generation alone is insufficient.
Assessment start must happen while the session is open. Locked sessions can
finish work already in progress but cannot start new assessments. Withdrawn
candidates do not block locking or completion.

Candidate statuses are `REGISTERED`, `WITHDRAWN`, and `COMPLETED`. Candidate
`age_band` is derived from the student's date of birth and the session grading
date, then stored as a historical snapshot. Clients cannot set it. Candidate
creation validates that the testing-for rank is the next active rank after the
student's current rank. A session grading date cannot be changed after
candidates have been added. The feature does not update `Student.current_rank`.

Deletion is state-gated: sessions can be deleted only while draft or cancelled;
candidates can be deleted only while their parent session is draft or open.
Candidate `student`, `testing_for_rank`, `status`, and `notes` can be changed
only while the parent session is draft or open.
`created_by`, candidate `student`, and candidate `testing_for_rank` use
protected foreign keys to preserve historical and reference relationships.

Deletion rules are enforced at the model, so they hold from `Model.delete()`,
`QuerySet.delete()`, a related manager, `manage.py shell` and Django admin -
not only through the API. A bulk delete is all-or-nothing: if any row in the
selection is refused, nothing is deleted, so a selection cannot be
part-applied. Admin hides Delete on a change page when the rule refuses.

One boundary deliberately remains: deleting a session the rule allows still
cascades to its candidates and their assessments, because that is what
deleting a draft or cancelled session means. Immutability and concurrency
hardening are tracked in `../docs/audits/remediation-status.md`.

## Candidate Assessments

Authenticated staff can generate and work with candidate assessment snapshots:

- `POST /api/gradings/candidates/{id}/generate-assessment/`
- `GET /api/gradings/assessments/`
- `GET /api/gradings/assessments/{id}/`
- `PATCH /api/gradings/assessments/{id}/`
- `GET /api/gradings/assessment-items/`
- `GET /api/gradings/assessment-items/{id}/`
- `PATCH /api/gradings/assessment-items/{id}/`

Assessments are created only through the generation action. Generation is
transactional and allowed only for draft or open sessions. It copies active
applicable requirements into `CandidateAssessmentItem` rows, including age band,
item code, item name, Korean name, category, sequence, required flag, numbered
range, and requirement notes. Source requirement, source item, and source rank
links are trace-only and nullable; historical display uses the copied snapshot
fields.

Assessment lifecycle is `NOT_STARTED -> IN_PROGRESS -> COMPLETED`. Starting an
assessment is explicit and is allowed only while the session is open. Result
entry is allowed only for in-progress assessments in open or locked sessions;
locked sessions can finish work already in progress but cannot start new
assessments. Required items must be `MET` or `NOT_MET` before completion;
optional items may remain `NOT_ASSESSED`. Completing an assessment atomically
marks the candidate `COMPLETED`. This is only a workflow completion marker:
final pass/fail/conditional outcomes are created and finalised through the
separate candidate outcome workflow. Promotions, rank-history creation, and
`Student.current_rank` updates remain deferred.

Clients may patch only assessment `status` and `notes`, and assessment-item
`result` and `assessor_notes`. Item result changes are rejected until the
assessment has been explicitly started. The server assigns `assessor` and
`assessed_at` when an item is marked `MET` or `NOT_MET`; resetting to
`NOT_ASSESSED` before completion clears those metadata fields. Snapshot and
source fields are read-only. Ordinary POST and DELETE operations for assessments
and items are not exposed.

Filters:

- Sessions: `status`, `grading_date`, `grading_date_from`, `grading_date_to`.
- Candidates: `session`, `student_wksa_id`, `testing_for_rank_code`,
  `age_band`, `status`.
- Assessments: `candidate`, `session`, `student_wksa_id`,
  `testing_for_rank_code`, `status`.
- Assessment items: `assessment`, `candidate`, `session`, `item_code`,
  `category`, `result`, `required`.

Session locking requires every non-withdrawn candidate to have an `IN_PROGRESS`
or `COMPLETED` assessment. Session completion requires every non-withdrawn
candidate to have a completed assessment and finalised outcome. Withdrawn
candidates do not block locking or completion. Generated snapshots prevent
candidate student, testing-for rank, and session changes; candidate deletion is
allowed only for draft, not-started assessment snapshots.

## Candidate Outcomes

Authenticated staff can read and propose candidate outcomes:

- `GET /api/gradings/outcomes/`
- `GET /api/gradings/outcomes/{id}/`
- `PATCH /api/gradings/outcomes/{id}/propose/`
- `GET /api/gradings/outcomes/{id}/summary/`

Users with the `gradings.can_make_final_grading_decision` Django permission can
finalise outcomes:

- `PATCH /api/gradings/outcomes/{id}/finalise/`

Outcome collection `POST` is disabled; use the candidate-scoped
`create-outcome` action after assessment completion. Outcome status values are
`DRAFT`, `PROPOSED`, and `FINALISED`. Outcome values are `PASS`, `FAIL`, and
`CONDITIONAL`.

Proposal records are explicit human recommendations and may be revised before
finalisation. Final decisions are explicit authorised Master decisions made only
while the parent session is `LOCKED`; they may agree with or override the
proposal. The system does not automatically infer or finalise pass, fail, or
conditional outcomes from item counts.

`CONDITIONAL` final decisions require meaningful `conditional_requirements`.
`PASS` and `FAIL` reject stale conditional text. Finalised outcomes are
immutable through the model, API, and admin, and they block ordinary outcome
deletion, candidate withdrawal, candidate deletion, and assessment deletion.
`QuerySet.update()` remains an unsupported low-level maintenance path.

The summary endpoint calculates category and overall counts from
`CandidateAssessmentItem` snapshot rows. It uses the copied snapshot category,
includes optional items in overall counts, distinguishes required item counts,
and does not return an inferred final outcome.

Outcome filters:

- `session`
- `candidate`
- `student_wksa_id`
- `testing_for_rank_code`
- `status`
- `proposed_outcome`
- `final_outcome`
- `proposed_by`
- `decided_by`
