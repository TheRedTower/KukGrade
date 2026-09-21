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

That list returns only rows attached directly to the given rank.
`GET /api/syllabus/requirements/effective/?rank_code=...&age_band=...` (both
required) instead returns one cumulative row per Technique/Form item
examinable through that rank - the latest applicable mapping at or before it
supplies the effective range, the earliest supplies where it was introduced.
See `syllabus.services.effective_syllabus_requirements` and
`../docs/api_contract.md`.

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
`OPEN -> LOCKED`, `OPEN -> CANCELLED`, `LOCKED -> COMPLETED`, and
`LOCKED -> CANCELLED`. That last one is the locked-session exit: it requires
`gradings.can_override_locked_session` and a non-blank `cancellation_reason`,
since candidates have already been assessed by that point.
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
candidates have been added. Candidate completion alone does not update
`Student.current_rank`; rank changes happen only through the promotion service.

`POST /api/gradings/candidates/bulk-update-status/` sets status on several
candidates in one request - independently per candidate, same savepoint
shape as the other bulk endpoints. Built for confirming attendance: tick the
candidates who did not show up, set `WITHDRAWN`, confirm, and the rest are
left untouched. Uses the same guard as a normal `PATCH` (status changes only
while the parent session is draft or open), so one candidate's session
already being locked does not block the others.

`POST /api/gradings/candidates/bulk-register/` registers several candidates
against one session in a single request. Each row runs through the same
validation as a single `POST`, independently, in its own savepoint: one row
failing (already registered, wrong rank) does not stop the others from being
registered. A row's `testing_for_rank` is optional and resolves to that
student's own next active rank when omitted, so a mixed-belt group (some
blue belts, a couple of white belts, one brown stripe) registers in one
request with no rank picked at all. Setting `generate_assessments: true` also
generates each registered candidate's assessment in the same savepoint as its
registration, so adding a group and starting their assessments is one
request. The response lists what succeeded and an `errors` map keyed by row
index for what did not - see `../docs/api_contract.md` for the exact shape.

Deletion is state-gated: sessions can be deleted only while draft or
cancelled, and a cancelled session holding recorded assessment work (any
candidate past `NOT_STARTED`) refuses deletion unless the actor is an
administrator, who can override it deliberately - the `SESSION_DELETED`
audit event is the trail. Candidates can be deleted only while their parent
session is draft or open.
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
- `POST /api/gradings/candidates/bulk-generate-assessments/`
- `POST /api/gradings/assessments/bulk-start/`
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

The bulk variant generates an assessment for every candidate id in the
request independently, same savepoint-per-row shape as `bulk-register`: one
candidate's assessment already existing does not block generation for the
rest of the batch.

Assessment lifecycle is `NOT_STARTED -> IN_PROGRESS -> COMPLETED`. Starting an
assessment is explicit and is allowed only while the session is open.
`bulk-start` starts several assessments in one request, independently per
row - a separate, deliberate action, not bundled into generation or
registration, so bulk-starting is always a choice the caller makes rather
than an automatic side effect. Result
entry is allowed only for in-progress assessments in open or locked sessions;
locked sessions can finish work already in progress but cannot start new
assessments. Required items must be `MET` or `NOT_MET` before completion;
optional items may remain `NOT_ASSESSED`. Completing an assessment atomically
marks the candidate `COMPLETED`. This is only a workflow completion marker:
final pass/fail/conditional outcomes are created and finalised through the
separate candidate outcome workflow. Rank changes happen only later through the
controlled promotion workflow for finalised PASS outcomes.

Clients may patch only assessment `status` and `notes`, and assessment-item
`result` and `assessor_notes`. Item result changes are rejected until the
assessment has been explicitly started. The server assigns `assessor` and
`assessed_at` when an item is marked `MET` or `NOT_MET`; resetting to
`NOT_ASSESSED` before completion clears those metadata fields. Snapshot and
source fields are read-only. Ordinary POST operations for assessments and
items are not exposed, and neither is DELETE for items. `DELETE
/api/gradings/assessments/{id}/` is exposed, but only as an
Administrator-gated hard-delete for corruption/test-data cleanup - see
"Hard-delete for admin cleanup" below - not a correction path for ordinary
use.

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

## Promotions And Rank History

Users with the `gradings.can_promote_student` Django permission can promote a
candidate from a finalised PASS outcome:

- `POST /api/gradings/outcomes/{id}/promote/`
- `POST /api/gradings/outcomes/bulk-promote/`

Promotion records are read-only:

- `GET /api/gradings/promotions/`
- `GET /api/gradings/promotions/{id}/`
- `GET /api/students/{id}/rank-history/`

Promotion is explicit and separate from final outcome recording. The service
accepts only a finalised `PASS` outcome. `FAIL` and `CONDITIONAL` outcomes do
not create a promotion and do not change `Student.current_rank`.
`gradings.can_promote_student` is a separate grant from
`gradings.can_make_final_grading_decision`: deciding an outcome does not confer
authority to promote it, and vice versa.

Eligibility requires:

- outcome status `FINALISED`;
- final outcome `PASS`;
- non-withdrawn candidate status `COMPLETED`;
- assessment status `COMPLETED`;
- session status `LOCKED` or `COMPLETED`;
- candidate testing-for rank still equals the next active rank after the
  student's current rank;
- no existing promotion for the outcome or grading candidate.

`promote_candidate()` is the canonical mutation path. It runs in one database
transaction, locks the outcome, candidate, assessment, and student rows, creates
the immutable `Promotion` record, and updates only `Student.current_rank`. If
any validation or uniqueness check fails, the rank update is not persisted.

`bulk-promote` promotes several outcomes in one request - any quantity, up to
a whole cohort - independently per row through the same `promote_candidate()`
call, in its own savepoint, same shape as the other bulk endpoints: one
ineligible outcome does not block the rest. Requires the same
`gradings.can_promote_student` authority.

The API derives `promoted_by` from `request.user`, `promoted_at` from the
server timestamp, and `effective_date` from the grading session date. API
clients cannot submit actor or effective-date fields. Backdating, postdating,
promotion correction, reversal, demotion, certificate generation, frontend
screens, notifications, and payment workflows are deferred.

`Promotion` is the v1 rank-history source. It stores from-rank, to-rank, the
candidate outcome, grading candidate, promoter, effective date, and optional
notes. Records are immutable after creation and cannot be changed or deleted
through any ordinary path - the model, queryset, API, or admin workflows -
`QuerySet.update()` and `QuerySet.delete()` both refuse, so the rule holds
from the shell too. The one deliberate exception: an administrator deleting
a completed assessment (`DELETE /api/gradings/assessments/{id}/`, see "Hard-
delete for admin cleanup" below) cascades through its promotion if one
exists, reverting `Student.current_rank` to the promotion's `from_rank`
first. That path calls `models.QuerySet.delete` directly - the real,
unbound base implementation - bypassing `PromotionQuerySet.delete()` on
purpose, at that one call site, not by omission. Once a student has
promotion history, ordinary student saves cannot directly change
`current_rank`; use the promotion workflow for progression. Rank history begins
with promotions recorded by KukGrade and may not include a student's rank
changes before adoption of the application. Reversing migration
`gradings.0004_promotion` is a schema rollback only; it does not implement a
business promotion reversal or rank rollback workflow.

## Hard-delete for admin cleanup

Two genuine hard deletes exist, both gated to Administrator-only Django
permissions and meant for corruption or test-data cleanup rather than
routine correction:

- `DELETE /api/users/{id}/` (`accounts.delete_user`): reassigns every
  attribution foreign key that referenced the user - grading sessions
  created, candidates withdrawn, assessments generated, outcomes
  proposed/decided, items assessed, promotions recorded, audit events - to a
  seeded "Deleted User" placeholder account (`accounts/migrations/0005_seed_
  deleted_user_placeholder.py`, excluded from the users API's own queryset)
  rather than nulling or cascading it away, then deletes the row. Refuses
  self-deletion and deleting the placeholder itself. See
  `accounts.services.delete_platform_user`.
- `DELETE /api/gradings/assessments/{id}/`
  (`gradings.delete_candidateassessment` plus `delete_candidateoutcome`/
  `delete_promotion`): cascades through the assessment's outcome and
  promotion if either exists, reverting the student's rank as described
  above, and refuses when a later promotion has already superseded it. See
  `gradings.services.delete_candidate_assessment`.

Both reassignments/cascades bypass the immutability guards on `Promotion`, a
finalised `CandidateOutcome`, and `AuditEvent` deliberately, by calling
`models.QuerySet.update`/`delete` directly instead of going through the
overridden instance/queryset methods those models otherwise enforce - the
one sanctioned way those guards are bypassed anywhere in this codebase,
documented at each call site. See the 2026-09-21 decision log entry.

Promotion filters:

- `student`
- `student_wksa_id`
- `from_rank_code`
- `to_rank_code`
- `session`
- `effective_date`
- `effective_date_from`
- `effective_date_to`
- `promoted_by`
