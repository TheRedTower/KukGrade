# Decision Log

Use this log for decisions that shape maintainability, project structure, dependencies, domain behavior, or user workflows. Keep entries short and concrete.

## Template

```md
### YYYY-MM-DD - Decision title

Status: Proposed | Accepted | Rejected | Superseded

Decision:

Context:

Consequences:
```

## Accepted decisions

### 2026-06-23 - Candidate outcome and Master decision foundation

Status: Accepted

Decision:
Create `CandidateOutcome` as the one-to-one outcome record for a completed
`GradingCandidate` and its completed `CandidateAssessment`. Outcomes start as
`DRAFT`, may be revised as `PROPOSED`, and become immutable once `FINALISED`.
Outcome values are `PASS`, `FAIL`, and `CONDITIONAL`; older defer/reassess
wording is not used for implemented outcomes. Outcome creation is an explicit
candidate action after assessment completion, not an automatic side effect of
assessment completion. Final decisions can be made only while the parent session
is `LOCKED` and only by a user with the
`gradings.can_make_final_grading_decision` Django permission.

Context:
Assessment item counts are useful evidence, but the domain requires the final
grading decision to remain an explicit human decision by an authorised
Master-level user. The accepted account model already includes a narrow final
grading decision capability; this slice implements that boundary as a Django
permission instead of adding a broader production role architecture or
hard-coded rank/title checks.

Consequences:
`CandidateOutcome.assessment` uses `PROTECT` so historical final decisions keep
their assessment evidence. `proposed_by` and `decided_by` also use `PROTECT`,
matching the existing policy for key grading attribution such as session
creator and assessment generator; display-name snapshots are therefore not
duplicated in this slice. `CONDITIONAL` final decisions require meaningful
conditional requirements, while `PASS` and `FAIL` reject stale conditional text.
On-demand category summaries use copied `CandidateAssessmentItem.category`
snapshot values, include optional items in overall counts, distinguish required
from optional evidence, and do not infer a pass/fail/conditional result.
Session completion now requires every non-withdrawn candidate to have both a
completed assessment and finalised outcome. Finalised outcomes block ordinary
edits, deletes, candidate withdrawal, candidate deletion, and assessment
deletion; `QuerySet.update()` remains an unsupported low-level maintenance
escape hatch. This slice deliberately does not update `Student.current_rank`,
create promotion history, create certificates, send notifications, add frontend
screens, or implement correction/reopening after finalisation.

### 2026-06-23 - Candidate assessment snapshot foundation

Status: Accepted

Decision:
Create `CandidateAssessment` as a one-to-one assessment package for a
`GradingCandidate`, and `CandidateAssessmentItem` as immutable
per-requirement snapshot rows with `NOT_ASSESSED`, `MET`, and `NOT_MET`
results. Assessment generation is service-only and transactional. It copies the
candidate's active applicable syllabus requirements at generation time,
including age band, item code, item name, Korean name, category, sequence,
required flag, numbered range, and requirement notes. Source requirement, item,
and rank relationships are nullable trace links only; historical display must
use the copied fields.

Context:
Historical grading records must remain reproducible if syllabus item names,
requirement ranges, notes, active flags, rank mappings, or catalogue versions
change later. This slice intentionally captures assessment evidence without
implementing final grading outcomes.

Consequences:
Assessments can be generated only while sessions are `DRAFT` or `OPEN`.
Assessment start is an explicit `NOT_STARTED -> IN_PROGRESS` transition allowed
only while the session is `OPEN`. Result entry is allowed only for
`IN_PROGRESS` assessments while sessions are `OPEN` or `LOCKED`; locked
sessions can finish work already in progress but cannot start new assessments.
Lifecycle is `NOT_STARTED -> IN_PROGRESS -> COMPLETED`; direct completion from
not started is rejected. Completion requires every required item to be assessed,
while optional items may remain `NOT_ASSESSED`. Completing an assessment
atomically marks the candidate `COMPLETED`, but does not calculate
pass/fail/conditional outcomes, does not create a Master final decision, does
not promote the student, and does not update `Student.current_rank`. Session
status changes must use the canonical `transition_grading_session()` service;
ordinary model saves reject direct status changes. Session locking requires
every non-withdrawn candidate to have an `IN_PROGRESS` or `COMPLETED`
assessment; generation alone is insufficient because assessment start must occur
while the session is `OPEN`. Session completion requires every non-withdrawn
candidate to have a completed assessment. `LOCKED -> OPEN` is rejected now that
assessment records exist. New sessions start in `DRAFT`, and normal API/admin
workflows cannot create sessions directly in later statuses. Withdrawn
candidates do not block locking or completion. Generated snapshots prevent
candidate student,
testing-for-rank, and session changes. Deletion is limited to draft,
not-started snapshots. `generated_by` uses `PROTECT`, matching the existing
session creator audit-attribution policy. `assessor` uses `SET_NULL` so item
results survive account removal. `source_rank` uses `SET_NULL` because it is a
trace-only link and the copied item snapshot, not the live rank relationship, is
the historical record. Correction workflows, stronger audit events, category
summaries, final decisions, promotion history, certificates, notifications, and
frontend assessment screens remain deferred.

### 2026-06-23 - Grading session and candidate foundation

Status: Accepted

Decision:
Create a dedicated `gradings` Django app for `GradingSession` and
`GradingCandidate`. Expose authenticated CRUD endpoints at
`/api/gradings/sessions/` and `/api/gradings/candidates/`. Store candidate
`age_band` as a historical snapshot derived from `Student.date_of_birth` and the
session grading date. Validate candidate `testing_for_rank` as the next active
rank after `Student.current_rank`. The later candidate assessment snapshot
foundation supersedes the live-query-only syllabus boundary for historical
assessment display.

Context:
This slice establishes the session-to-candidate foundation needed before
assessment records. It deliberately excludes per-item assessment results,
pass/fail/conditional outcomes, scoring, promotion decisions, attendance outside
grading participation, frontend screens, notifications, certificates, and
payment handling.

Consequences:
This pre-assessment slice allowed `LOCKED -> OPEN` only while no assessment
records existed. That correction path is superseded by the candidate assessment
snapshot foundation, which rejects `LOCKED -> OPEN`. `CANCELLED` and
`COMPLETED` are terminal. Session deletion is allowed only for draft or
cancelled sessions; candidate deletion is now further constrained once
assessment snapshots exist. Candidate fields can be edited only while the parent
session is draft or open and only before generated snapshots make them
historical. Session grading dates cannot be changed after candidates are added,
preserving stored age-band snapshots without adding bulk recalculation logic.
Leap-day birthdays age on 1 March in non-leap years. `created_by`, candidate
`student`, and candidate `testing_for_rank` use protected foreign keys to
preserve historical and reference relationships. `Student.current_rank` is not
changed by this feature; promotion history, audit logging, and role-specific
production permissions remain deferred.

### 2026-06-23 - Syllabus catalogue foundation

Status: Accepted

Decision:
Create a dedicated `syllabus` Django app for the WKSA Version 2014 syllabus
catalogue. Store stable assessable items in `SyllabusItem` and map them to
rank-and-age-band testing requirements in `SyllabusRequirement`. Expose
authenticated read-only DRF endpoints at `/api/syllabus/items/` and
`/api/syllabus/requirements/`.

Context:
The official Junior and Adult/Youth testing charts distinguish age 8 and under,
age 9-12, age 13-17, and adults age 18 and over. These are testing-rule bands,
not permanent student attributes. The same item can have different numbered
ranges by rank and age band, so ranges belong on the requirement mapping rather
than the item.

Consequences:
`SyllabusItem.code` is globally unique and stable. `SyllabusItem.name` is not
globally unique so official repeated names remain possible. Numbered technique
and weapon ranges use `start_number` and `end_number`; form parts such as
`(1/2)` and `(pt.1)` remain concise notes. Hangul labels from the charts are
preserved where present. Optional Adult/Youth black-belt material marked "May be
taught, if time allows" is kept as catalogue items where named, but is not
mapped as an age-band requirement until its scope is confirmed. Age-band
resolution from date of birth and grading date, syllabus version workflows,
grading sessions, assessment results, scoring, attendance, and promotion
decisions remain deferred.

### 2026-06-21 - Rank catalogue foundation

Status: Accepted

Decision:
Create a dedicated `ranks` Django app for ordered rank reference data. Seed the
catalogue from migrations, expose a narrow authenticated read-only ranks API,
and represent `Student.current_rank` as a required protected foreign key to
`Rank`.

Context:
Ranks are shared reference data for student records, future syllabus mapping,
grading sessions, and historical promotion records. The catalogue must not
duplicate records by age band because age-specific requirements belong to the
future syllabus model.

Consequences:
Rank progression uses the explicit `Rank.order` field. Existing student rows are
backfilled to White during migration before `current_rank` becomes non-null.
Promotion history, grading sessions, syllabus mapping, age-band requirements,
and ranks above PKJN remain deferred.

### 2026-06-21 - Identity and session authentication foundation

Status: Accepted

Decision:
Use a custom Django user model with UUID primary keys, unique normalised email login, primary roles of instructor, manager, and administrator, and a separate `can_make_final_grading_decision` capability. Use Django session authentication for the React frontend rather than token authentication.

Context:
The authentication and user-model strategy were unresolved. The identity foundation needs to support staff-only access, backend-enforced permissions, Django admin management, and future branch-scoped access work without storing frontend auth tokens.

Consequences:
`AUTH_USER_MODEL` is `accounts.User`. React uses cookie-backed requests with CSRF protection and does not store credentials or tokens in local storage. Authorised Master final-decision authority is represented by capability for now, independent of the primary role. Branch- or organisation-scoped role assignments remain unresolved and out of scope for this slice.

### 2026-06-21 - Repository layout

Status: Accepted

Decision:
Use a simple monorepo with `backend/`, `frontend/`, and `docs/` as top-level boundaries.

Context:
The initial foundation request uses `backend/` and `frontend/`. Earlier planning documents used `api/` and `web/`, but no application code existed in those placeholders.

Consequences:
This keeps backend and frontend work isolated while avoiding premature package-level complexity. Worker implementation remains deferred until there is a real asynchronous workload.

### 2026-06-21 - Implementation sequencing

Status: Accepted

Decision:
Use `docs/action_plan.md` as a guide, but confirm each meaningful implementation slice before coding it.

Context:
The project has a detailed plan, but the user wants each decision clarified before implementation to avoid sprawl and preserve maintainability, efficiency, and usability.

Consequences:
Work should proceed in small, reviewable increments. Large scaffolding, dependency additions, schema changes, and UI workflow choices should be explicitly agreed before implementation.

### 2026-06-21 - Backend stack

Status: Accepted

Decision:
Use Django and Django REST Framework for the backend.

Context:
The planning and API documents are written around Django, DRF, Django auth, Django models, serializers, and viewsets.

Consequences:
Backend implementation should follow Django conventions unless a later decision supersedes this. The first unresolved backend choice is whether to use Django's default user model or a custom email-first user model.

### 2026-06-21 - Frontend stack

Status: Accepted

Decision:
Use React, TypeScript, and Vite for the frontend foundation.

Context:
The planning document recommends this stack for a coded prototype that can evolve into the final application. Routing and server-state libraries are deferred until screens and API workflows are confirmed.

Consequences:
Frontend implementation should be scaffolded around these tools. Styling, routing, and server-state choices remain open until they are needed.

### 2026-06-21 - Local development foundation

Status: Accepted

Decision:
Use native backend and frontend development servers with Docker Compose providing local PostgreSQL.

Context:
The initial foundation needs a runnable backend, frontend, and local database without committing production Docker image decisions.

Consequences:
`compose.yaml` starts PostgreSQL only. Production image layout and CI remain unresolved.

## Open decisions
