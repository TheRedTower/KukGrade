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

### 2026-09-28 - The frontend derives no authority and no rank progression

Status: Accepted

Decision:
`/api/auth/me/` reports each administrator capability from the permission
its action checks, and `can_read_audit_log` from the backend rule itself;
routes and controls read those flags and never `role`. Each rank carries
`next_rank` from the one next-rank rule the grading services use. Audited
entity types are declared (`AuditEntity`) and published as an enum.

Context:
The UI mirrored backend rules in the browser - role checks for
administrator actions after the backend had moved to permissions, a copy
of the audit-log rule, the next rank computed three different ways, and a
hand-kept entity list - each of which could drift from the server, and one
already had (a dead `"Candidate"` comparison).

Consequences:
`permissions.ts` is removed. `role` is read in the UI only where the rule is
about the role (whether a managed user is an administrator).

### 2026-09-26 - List filters are declared once and published in the schema

Status: Accepted

Decision:
Each list view declares its query filters in `query_filters`
(`kukgrade/filtering.py`); a default filter backend applies them and
supplies them to the OpenAPI schema. Boolean filters accept only
`true`/`false`.

Context:
Filters were parsed by hand in each `get_queryset`, and none reached the
schema, so the frontend hand-wrote every list-parameter type against the
"never hand-write an API type" rule. The boolean filters also disagreed:
`required` accepted `1`/`yes`, and `linked`/`voided` ignored an invalid value
where every other filter returned an empty page.

Consequences:
No new dependency (django-filter was not needed for this). `required=yes` and
similar now return an empty page. A test checks every declared filter appears
in the schema.

### 2026-09-26 - A session locks only when grading is complete; completed assessments reopen until then

Status: Accepted

Decision:
`OPEN -> LOCKED` requires every non-withdrawn candidate's assessment to be
`COMPLETED`. Item results and completion are only accepted while the session
is `OPEN`. While it is open, a completed assessment can be reopened
(`POST /api/gradings/assessments/{id}/reopen/`, audited
`ASSESSMENT_REOPENED`), keeping every result and its attribution. A
registration always starts `REGISTERED`.

Context:
Confirmed 2026-09-25: the session stays open until the instructors are happy
with every record, and locking marks the end of grading. Previously a session
could lock with assessments still in progress and scoring continued after
lock, so "locked" did not mean the record was final, and a completed
assessment could not be corrected at all. Supersedes the "locked sessions can
finish work already in progress" behaviour in the 2026-06-23 assessment
snapshot foundation entry.

Consequences:
A locked withdrawal now applies to a graded but undecided candidate. The
correction workflow after lock (for a finalised outcome) is still open and
will be tuned in beta with the instructors.

### 2026-09-26 - Every withdrawal has a reason; a registration's student is fixed

Status: Accepted

Decision:
Withdrawing a candidate before the session locks requires a reason from the
same list as a locked withdrawal and records who and when; reinstating clears
it. The bulk no-show action sends `ABSENT`. A registration's `student` can no
longer be changed; moving a registration to another session is still allowed.

Context:
Confirmed 2026-09-25: a withdrawal before lock previously recorded nothing,
while one after lock required a reason - so the record could not say why most
candidates had not graded. Swapping the student rewrote what a registration
meant; remove and re-register instead. Moving session stays, pending a
possible "deferred" concept.

Consequences:
Enforced in `update_candidate` for withdrawals and in the model's `clean()`
for the student, so the API, bulk endpoint and Django admin all hold. Existing
withdrawn rows without a reason are left as they are.

### 2026-09-26 - Audit events keep the actor's identity through user deletion

Status: Accepted

Decision:
`AuditEvent` copies `actor_email` and `actor_name` when written. Deleting a
user still re-points `actor` to the deleted-user placeholder, but the copies
are never changed. The placeholder can never be active.

Context:
Deleting a user rewrote `actor` on every event they had caused, and nothing
else on the event named them - so the audit trail forgot who made the final
decisions, promotions and edits it exists to prove. Confirmed requirement:
"we should definitely know who was deleted and by who... instead of a full
erasure otherwise it's not auditable."

Consequences:
Migration `audit.0006` adds the fields and backfills them from each event's
current actor; events already re-pointed before it keep the placeholder's
identity. Refines the 2026-09-21 hard-delete entry, which still stands for
every other attribution field.

### 2026-09-25 - A candidate records the rank held at registration

Status: Accepted

Decision:
`GradingCandidate.from_rank` snapshots the student's current rank when the
candidate is created. It is read-only through the API and admin and never
changes (a registration's student is fixed - see the 2026-09-26 entry).

Context:
The completion proof and the promotion ledger showed the student's live
`current_rank` as the starting rank. After promotion that is the rank the
candidate was testing for, so a sealed record read "Yellow -> Yellow". The
ledger also looked the rank up by student id in a rank-id map, and the
assessment screens found the student by a WKSA-ID substring search. A record
that changes after the fact is not reproducible, which the grading rules
require.

Consequences:
Migration `gradings.0009` adds the field and backfills it: a promoted
candidate's own `Promotion.from_rank`; otherwise the rank reached by the
student's latest promotion before the session date; otherwise where their
first later promotion started; otherwise their current rank.

### 2026-09-24 - One document per job; every API shape declared in the schema

Status: Accepted

Decision:
Retire the documents that had become history rather than guidance - the
completed `backend-completion-spec.md`, the `frontend-next-steps-handoff.md`
agent handoff, the `HANDOFF.md` tombstone, the superseded
`audits/remediation-status.md` register, and the legacy planning inputs
`data_model.md`, `grading_app_planning.md`, `domain-model.md` and
`syllabus-model.md`. Fold the still-valid parts of `testing-strategy.md` into
`development-workflow.md`, which now holds the one canonical list of
verification commands. Give each remaining document one job (see
`docs/README.md`), and keep `api_contract.md` to implemented endpoints only.
Summarise the external import specification's sixteen locked decisions in
`data-import-and-legacy-migration.md` so code comments citing "import
Decision N" resolve inside the repository.

Declare every custom API action's real request and response with
`@extend_schema`, serialize the bulk, summary, and import responses through
those declared serializers, alias every frontend API type to the generated
schema, and have CI regenerate `backend/schema.yml` and fail if it is stale.

Context:
A repository-wide review (`audits/2026-09-24-coherence-audit.md`) found the
same facts stated in three or four documents that had drifted apart - three
different mypy app lists, `PATCH` versus `POST` for the same endpoint - and
code citing sections of a specification nobody could open. It also found
that the 2026-09-14 "generate, never hand-write" decision had quietly
lapsed: seventeen actions were undeclared, so the published schema described
the wrong bodies, the frontend hand-wrote their types, and one of those types
drifted far enough to report a partly failed bulk promotion as a complete
success. Nothing checked that the committed schema matched the code.

Consequences:
Deleted documents remain in Git history. The KG-numbered dated audits stay,
since code and this log cite their findings. An API shape change now updates
the serializer, the regenerated schema and types, and `api_contract.md`
together, or CI fails. Supersedes the 2026-06-25 "Documentation truth and
audit remediation tracker" entry.

### 2026-09-24 - Parse API dates through one shared module, and run the frontend suite in a second timezone

Status: Accepted

Decision:
All API dates are parsed through `frontend/src/dates.ts`, which detects
date-only values and splits them into local year/month/day, and keeps normal
parsing for timestamps. CI runs the frontend suite twice: once as it did, and
once with `TZ=America/Los_Angeles`.

Context:
The API returns two shapes. Date-only values (`grading_date`,
`Promotion.effective_date`, `Student.date_of_birth`,
`GradingHistoryItem.date`) are read by `new Date()` as UTC midnight, so west of
UTC they render as the previous day. Timestamps (`created_at`, `promoted_at`,
`generated_at`, `completed_at`) carry an offset and must keep rendering in the
reader's own timezone.

The same formatter had been written six times across the app with three
different parsing strategies. Two were wrong: `PromotionLedgerScreen` showed
the day before the grading for `grading_date` and `effective_date`, and
`StudentDetailScreen` did the same for `date_of_birth` and promotion dates.
`calculateAge` shared the defect, which matters beyond display: age decides the
age band, and the age band decides which syllabus a candidate is assessed
against.

The shape is detected from the value rather than chosen by the caller, because
several formatters receive both kinds - `StudentDetailScreen` formats
`date_of_birth` and `created_at` through the same function.

The CI change is part of the fix rather than an extra. The runner is UTC, and
this class of bug is invisible there: with the defect reintroduced, the UTC run
passes 187/187 while the `America/Los_Angeles` run fails 5. Tests asserting
these fields gave no protection at all before.

Two tests asserted timestamps in UTC-specific form (`UsersScreen` on
`last_login`, student detail on `created_at`). Those were test defects, not
product bugs - a timestamp *should* render differently by timezone - so the
expected values are now derived from the same formatter rather than hard-coded.

Consequences:
The suite passes in UTC, America/Los_Angeles, Pacific/Auckland, Asia/Kolkata,
Pacific/Kiritimati and America/Sao_Paulo. New date formatting goes through
`dates.ts`; the remaining correct-but-duplicated formatters in
`GradingSessionsScreen`, `GradingSessionDetailScreen`, `OverviewScreen` and
`BuildGradingCohortScreen` were left alone rather than churn working code, and
are candidates for the same consolidation.

### 2026-09-23 - Expose the assessment summary on the assessment resource

Status: Accepted

Decision:
Add `GET /api/gradings/assessments/{id}/summary/` returning
`candidate_assessment_summary(assessment)` - the same service and response
shape `GET /api/gradings/outcomes/{id}/summary/` already returns.

Context:
FDR-046 said assessment counts must be served rather than recomputed in React.
Checking the serializers showed that is not currently possible while an
assessment is being scored. `CandidateAssessmentSerializer.get_item_counts`
returns only `total`, `required`, `met`, `not_met` and `not_assessed`, with no
required-split, so it cannot drive the completion gate: optional items may be
left unassessed, so `not_assessed > 0` does not mean incomplete. It also
generates as `{ [key: string]: number }`, so it carries no type safety. The
full split, and the per-category breakdown, exist only behind
`/outcomes/{id}/summary/`, which needs a `CandidateOutcome`; that needs session
`LOCKED` and assessment `COMPLETED`, so it is unreachable during scoring and at
completion review. The client-side derivation in
`CandidateAssessmentScreen.tsx` therefore exists because the server does not
serve what the screen needs, not by oversight.

`candidate_assessment_summary` already takes a `CandidateAssessment` rather
than an outcome, and `gradings/views.py:714` is a two-line wrapper over it, so
the addition is a viewset action, contract documentation and permission tests.
No model, migration or service change.

Consequences:
Accepted and implemented on 2026-09-23. Slice 2 of the assessment redesign
gained a backend half.

Implementing it surfaced a second defect: neither `summary` action serializes a
model, so drf-spectacular had been declaring each viewset's own
`serializer_class` as the response. The outcome endpoint has documented
`CandidateOutcome` since it was added, which is why the frontend hand-wrote
`CandidateAssessmentSummary` against `docs/current-system.md`'s
generated-types rule. Both actions now declare
`CandidateAssessmentSummarySerializer`, and the frontend types are generated. `/outcomes/{id}/summary/` becomes a thin convenience over the same
service rather than the only route to the data. Changes
`docs/api_contract.md`, and requires the OpenAPI schema and frontend types to
be regenerated.

### 2026-09-23 - Assessment grading screen directions

Status: Accepted

Decision:
Rebuild mat-side scoring as 1A Single Column Run, completion review as 2B
Certificate Proof, and the Authorised Master final decision as 3C Cohort
Adjudication Board. Selected from nine proposed directions, three per screen.

Context:
The three screens shipped in a single fast pass on 2026-09-16 and had drifted
from the accepted visual direction - notably FDR-008, which prefers divider-led
lists over repeated cards, while every requirement rendered as a card. The
completion review also showed a per-category percentage, implying partial
credit that `CandidateAssessmentItem.Result` does not have.

Consequences:
Recorded as FDR-042 to FDR-047 and SCR-026 to SCR-028. Supersedes FDR-032,
FDR-033, FDR-036 and FDR-038, and retires SCR-019, SCR-020 and SCR-022.
FDR-037's instructor proposal drawer is retained, not superseded: the selected
Master surface is a cohort board and does not carry the proposal step, so the
drawer is restyled to the board's evidence presentation under FDR-047.
Both 2B and 3C are routes rather than in-page modes, so each adds a route and
`GradingSessionDetailScreen.tsx` gains new entry points.
`MasterFinalDecisionDrawer.tsx` is deleted rather than refactored;
`OutcomeProposalDrawer.tsx` survives.
Selecting 1A also settles the clearing treatment as an inline confirmation
(FDR-045), and none of the three selected directions needs a bulk item-scoring
affordance, so that decision is deferred rather than blocking.

### 2026-09-23 - Positive observations recorded in assessor_notes

Status: Accepted

Decision:
Amend `AGENTS.md` rather than add a field. `CandidateAssessmentItem.assessor_notes`
is the single per-item free-text field and records both shortfalls and positive
observations; `CandidateAssessment.notes` carries the overall observation. No
separate praise field is added.

Context:
`AGENTS.md` previously required assessment data to support "positive
observations" as a distinct concern. No such field has ever existed in
`backend/gradings`, so the rule described an intent rather than the schema. The
gap surfaced during the 2026-09-23 design pass, which deliberately did not mock
a field that does not exist. Two free-text fields already exist and are
unconstrained in what they record. A second per-item textarea would also sit on
every one of roughly 24 rows in the selected 1A mat-side layout, on a screen
used during a live grading, where it would realistically go unfilled.

Consequences:
`AGENTS.md`'s domain rule now states the actual shape: computed category
results, stored item results, one per-item note field, one per-assessment note
field. No migration, service or serializer change. Slice 4 of the assessment
redesign is unblocked. If per-technique praise is wanted later it is a new
decision with a migration, not an unmet existing requirement.

### 2026-09-23 - Clearing an item result is destructive

Status: Accepted

Decision:
`Clear` opens an inline confirmation naming the assessor and time it will
erase. Applies on every surface that can return a scored item to
`NOT_ASSESSED`.

Context:
The `candidate_item_assessor_matches_result` constraint requires `assessor` and
`assessed_at` to be null when `result` is `NOT_ASSESSED`, so clearing a scored
item erases who marked it and when, irreversibly. The superseded UI presented
`NOT_ASSESSED` as a peer of `MET` and `NOT_MET` in a segmented control and gave
no warning at all.

Consequences:
Recorded as FDR-045. `NOT_ASSESSED` is no longer a verdict target; it is
reached only through the confirmed `Clear` action.

### 2026-09-23 - Bulk item scoring

Status: Accepted

Decision:
Do not add a "mark remaining met" affordance or a `bulk-update-items` endpoint
in this redesign. Revisit if instructors ask for it once 1A is in use.

Context:
`/api/gradings/assessment-items/` supports `GET` and `PATCH` on a single item
only, so any multi-item action is N sequential requests. None of the three
directions selected on 2026-09-23 includes the affordance, so nothing in the
redesign depends on resolving it.

Consequences:
If it is revisited, the client-side option needs no backend work but must never
imply atomic success, per FDR-028. The endpoint option needs a service, view,
serializer, contract documentation and permission tests, and changes
`docs/api_contract.md`.

### 2026-09-23 - One production app service on existing Traefik and PostgreSQL

Status: Accepted

Decision:
Build the React frontend and Django API into one production image. Use a
single-service `compose.prod.yml` connected to the host's existing Traefik
and production PostgreSQL containers through separate external networks.
Serve hashed static assets through WhiteNoise and the React SPA through
Django. Apply migrations at app container start, then `exec` a single
threaded Gunicorn worker. Keep `compose.yaml` as the local PostgreSQL-only
development setup.

Context:
The owner asked for an OpenWebUI-like deployment: one configurable app
container and one Compose/env pair, with optional infrastructure add-ons
later, served to instructors at `www.kukgrade.co.uk`. A separate migration
service would complicate that one-service interface. The accepted 2026-09-15
login-throttle decision also rules out multiple Django processes until they
share a cache.

Consequences:
The image contains no production secret or PostgreSQL data. Traefik uses the
owner's `apps_net`/`websecure`/`cloudflare` convention; the external PostgreSQL
network name and database alias are set in `.env.production`. One app restart may
run an already-applied migration again; Django treats that as a no-op. Before
an image update, take a database backup because a schema migration can make
an old image incompatible. Host backup/restore operations and actual Traefik
integration still need verification before live use. See `docs/deployment.md`.

### 2026-09-23 - Fix Django admin parity gap for any-status grading session delete

Status: Accepted

Decision:
`gradings.admin.StateGatedDeleteMixin.has_delete_permission`/`_is_deletable`
now thread the logged-in admin user into the deletion validator, and
`GradingSessionAdmin` routes its actual delete (`delete_model`/
`delete_queryset`) through `gradings.services.delete_grading_session()`
rather than a bare `obj.delete()`/`queryset.delete()`.

Context:
Found while documenting the 2026-09-22 any-status session delete: Django
admin is one of this app's two first-class operational surfaces (see
`docs/audits/2026-09-15-post-completion-audit.md`'s KG-036 finding), and
this capability had no parity there at all. `has_delete_permission` called
`validate_session_can_be_deleted(obj)` with no actor, so the
`actor.role == ADMINISTRATOR` branch could never engage - Delete stayed
hidden for `LOCKED`/`COMPLETED` sessions in Django admin even for a real
administrator, though the identical action worked through the API.
Confirmed directly: `test_admin_hides_delete_for_a_session_that_cannot_be_deleted`
already asserted this false-negative using a superuser. Even with
visibility fixed, the default `delete_model`/`delete_queryset` would have
called `obj.delete()`/`queryset.delete()` directly, which does not strip
`Promotion`/`CandidateOutcome` rows first, so deleting a session with
finalised data through admin would have hit `ProtectedError` instead of
cascading.

Consequences:
`validate_candidate_can_be_deleted` gained an unused `actor` parameter
purely for calling-convention uniformity with `validate_session_can_be_deleted`
inside the shared mixin; `GradingCandidateAdmin` (candidates have no
administrator override) is otherwise unaffected. Two existing admin tests
that asserted the old (buggy) behavior using a superuser were corrected to
use a non-administrator, which is what they actually meant to test; three
new tests cover an administrator seeing Delete for every status, bulk
deleting a mixed-status selection, and `delete_model` on a `LOCKED` session
with a finalised outcome and promotion cascading correctly with the rank
reverted and `SESSION_DELETED` recorded. 617 backend tests pass.

### 2026-09-22 - Administrator-only hard delete for students and any-status grading sessions

Status: Accepted

Decision:
Two capabilities, both administrator-only, both routine (not just rare
erasure requests): `DELETE /api/students/{id}/` hard-deletes a student,
cascading through every grading-session registration, assessment, outcome
and promotion involving them (a linked `LegacyGradingRecord` is unlinked,
not deleted); and `validate_session_can_be_deleted`/`delete_grading_session`
now let an administrator delete a grading session in any status, not just
`DRAFT`/`CANCELLED`, cascading through finalised outcomes and promotions the
same way. Deleting a single completed grading (one candidate at a time) via
`DELETE /api/gradings/assessments/{id}/` already worked for any status and
needed no change.

Context:
The 2026-09-14 "Data erasure handled manually" decision assumed real
erasure requests would be rare enough to handle by hand outside the
application - `Student`'s PROTECT relationships made deletion impossible
through the app at all. Raised directly: the owner wants full, routine
admin control to delete a student or a whole completed grading, not just
occasional manual cleanup. Every relationship to `Student`
(`GradingCandidate.student`, `Promotion.student`) is `PROTECT` with no
automatic cascade; `Promotion.outcome`/`CandidateOutcome.assessment` are
also `PROTECT`, so a `Promotion` must be deleted before its
`CandidateOutcome`, which must be deleted before the cascade below it can
proceed. For session deletion, this reuses and extends the 2026-09-20
mechanism (an `actor.role == ADMINISTRATOR` runtime check already inside
`validate_session_can_be_deleted`) rather than adding a new permission -
`gradings.delete_gradingsession` is already granted to both roles for the
ordinary draft/cancelled case, so the extra power has to come from the role
check the same way the cancelled-with-recorded-work override already does.

Consequences:
`students.services.delete_student` bulk-bypass-deletes `Promotion` and
`GradingCandidate` rows (`models.QuerySet.delete`, the real unbound base
implementation, the same sanctioned bypass as `delete_candidate_assessment`
and `delete_platform_user`), plain-deletes `CandidateOutcome` rows, unlinks
each `LegacyGradingRecord` via the existing
`gradings.legacy_services.unlink_legacy_record_from_student`, and records
one `STUDENT_DELETED` audit event with cascade counts before the row goes.
No "is this still the student's most recent promotion" check applies here,
unlike a single assessment's cascade - every promotion the student has is
removed together, so none can supersede another. `delete_grading_session`
gained an admin-only block that pre-flight validates every candidate's
promotion with the existing `validate_assessment_deletion_promotion`
*before mutating anything* (all-or-nothing: a promotion a later, different
session has already superseded refuses the whole deletion, leaving
everything in place) and records `reverted_student_ranks` in the
`SESSION_DELETED` event's metadata. `students.delete_student` (Django's
auto-generated permission, previously granted to neither role) joins
`accounts.groups._DATA_CLEANUP_PERMISSIONS` alongside the existing
`delete_candidateassessment`/`delete_candidateoutcome`/`delete_promotion`.
New `AuditAction.STUDENT_DELETED`. Frontend: an admin-gated "Delete
student" action on the student detail screen, and a "Delete session" menu
item added to the `LOCKED`/`COMPLETED` dropdowns on the grading-session
detail screen, both reusing existing confirm-dialog machinery.

### 2026-09-22 - Fix deterministic CI regression in transactional test teardown (auth_group double-insert)

Status: Accepted

Decision:
`accounts/apps.py`'s `_apply_role_group` (a `post_save` receiver on `User`)
now returns early when Django passes `raw=True`, the flag reserved for
fixture/deserializer saves that place a row verbatim rather than represent a
real create/update.

Context:
CI had been failing deterministically on every push since
`c25ee29`/2026-09-21 (`accounts/migrations/0005_seed_deleted_user_placeholder.py`,
which seeds a real `User` row via every `migrate`). Root cause, confirmed by
direct instrumentation against a live PostgreSQL 17 database: `pytest-django`'s
`serialized_rollback=True` (used by the 8 `transaction=True` tests -
`gradings/test_concurrency.py`, and the "migrate from zero" tests in
`syllabus/tests.py` and `gradings/tests.py` - to restore seed data after a
transactional test's `flush()`) replays its snapshot with `obj.save()`,
which dispatches `post_save` with `raw=True` but does not suppress it.
Before this fix, `_apply_role_group` ran anyway on the replayed `User` row,
calling `Group.objects.get_or_create(...)` mid-replay. Because `accounts`
precedes `django.contrib.auth` in `INSTALLED_APPS`, the snapshot lists the
`User` row before the `Group` rows, so on the second and later transactional
test in a session (the first test's own `flush()` had already emptied the
table with no sequence reset) the receiver's `get_or_create` inserted a
`Group` row on a fresh auto-increment pk, and the snapshot's own `Group`
record - now with a pk nothing matches - fell through to an explicit-pk
`INSERT` and hit `auth_group_name_key`. Previously misdiagnosed and recorded
in `docs/current-system.md` as harmless pre-existing test-order flakiness;
it was neither pre-existing (traced to the 2026-09-21 migration) nor
order-independent flaky (100% reproducible, same 8 tests, every run).

Consequences:
`raw: bool = False` was added to `_apply_role_group`'s signature with an
early return - the idiom Django's own docs recommend for exactly this
class of receiver. A regression test (`accounts/tests.py::test_raw_save_does_not_trigger_group_assignment`)
sends `post_save` with `raw=True` directly and asserts no group membership
change. Full suite: 602 passed, 0 errors, reproduced across two consecutive
runs. No change needed to the seed migration, `accounts/groups.py`, or the
`serialized_rollback` usage on the 8 tests, which is correct and necessary.

### 2026-09-22 - Historical KSW Colchester grading-workbook migration (Phase B of the data-import spec)

Status: Accepted

Decision:
The remainder of the data-import spec - historical workbook parsing,
`LegacyGradingRecord`, rank review, identity reconciliation, void/correction,
and a unified grading-history read model - is implemented on top of the
Phase A `ImportBatch` foundation (`ImportBatch.Kind.LEGACY_GRADINGS`).
`LegacyGradingRecord` (`gradings/models.py`) is a deliberately weaker,
distinct evidence model from the native grading workflow: source text
(name, rank text, outcome text, comments, cycle info) is immutable after
import - `clean()` diffs the persisted row and rejects any change to it,
derived as "every field except the mutable set" rather than a second
hand-maintained list - and physical deletion is blocked at every layer
(`Model.delete()`, `QuerySet.delete()`, `QuerySet.update()`); void is the
only removal path and is itself one-shot (a second void is refused). The
only mutation path is five service functions
(`gradings/legacy_services.py`): `create_legacy_grading_record` (called
once per parsed row from the commit service, no audit event of its own -
one `IMPORT_BATCH_COMMITTED` event covers the whole batch, matching the
roster importer) and four explicit corrections -
`link_legacy_record_to_student`/`unlink_legacy_record_from_student`/
`resolve_legacy_current_rank`/`resolve_legacy_testing_for_rank`/
`void_legacy_record` - each auditing itself individually. A rank mapping
is reviewed once per distinct source-text value across a batch, not per
row, with an exact-match-only suggestion (never fuzzy, never
auto-applied); leaving it unresolved never blocks a row from being
committed, unlike the roster importer's required `Student.current_rank` -
it is correctable at any time afterwards via the reconciliation API.
Reading an imported record (`GET /api/gradings/legacy-records/`) matches
native grading visibility (both roles); the five reconciliation actions
are Administrator-only (`gradings.can_reconcile_imported_history`). A new
`GET /api/students/{id}/grading-history/` combines finalised native
outcomes with linked, non-voided legacy records into one source-labelled,
newest-first list with an honest date precision (`DAY`/`MONTH`) per item -
deliberately separate from `/rank-history/`, which is untouched and
remains `Promotion`-only.

A genuine, previously-unknown finding surfaced during implementation:
Excel forbids `/` in a worksheet title (openpyxl raises `ValueError` on
it), so despite the spec's own prose consistently writing cycle sheet
names as `"06/2025"`, the real workbook cannot literally be titled that.
The adapter's sheet-name pattern accepts `-` or `.` as the separator too,
and preserves whatever the real title turns out to be rather than
normalising it - this is a correction to the spec's own example, not a
deviation from its intent.

Context:
Continuation of the 2026-09-21 "Student roster bulk import" entry, which
deliberately deferred this half past the school's Friday 2026-09-25
grading session - nothing about it blocks that session, unlike the
roster importer. Built and merged the following day once the roster half
was live. The same five spec-vs-implementation deviations recorded in
that entry (Tablib over `django-import-export`, no background worker,
local filesystem storage, all-or-nothing commit) apply here too; the
roster importer's sixth deviation (exact-match-only rank resolution) does
not apply in the same way here, since this half's rank review is
explicitly a distinct-value, admin-confirmed workflow by design (Decision
4 of the source spec), not a simplification of it.

Consequences:
Every synthetic test fixture (the adapter's own tests, and every workbook
built for the commit/reconciliation/grading-history tests) is invented
data - the real KSW Colchester workbook has never been read by this
implementation and must never enter this repository. The spec's own
hardening/rehearsal step (section 46) - running the adapter against a
sanitised copy of the real workbook in a non-production environment,
comparing per-sheet record counts, and confirming zero native
`Promotion`/`CandidateOutcome`/current-rank changes resulted - remains
outstanding before any real production import, and the adapter's
sheet-structure assumptions (header detection, auxiliary section names)
should be expected to need adjustment once tested against the real file.

### 2026-09-21 - Student roster bulk import (Phase A of the data-import spec)

Status: Accepted

Decision:
A new `data_imports` app provides administrator-only bulk student-roster
import from `.xlsx`/`.csv`, ahead of the originally-recommended v1.0.0
production baseline, so real students can be in the system before a live
grading session. `ImportBatch` tracks upload -> preview -> commit/cancel
provenance (safe summary counts only, never raw row content); the source
file lives in private local `FileSystemStorage` (`STORAGES["import_uploads"]`,
never a public `MEDIA_URL`) and is deleted on commit/cancel/expiry. Every
created `Student` goes through the existing `students.services.create_student`
service unchanged, so full model validation and the normal `STUDENT_CREATED`
audit event happen identically to a hand-created student - the importer
never bulk-writes directly. An existing WKSA ID is always skipped, never
silently updated. Import authority (`data_imports.add_importbatch`,
`.view_importbatch`, `.change_importbatch`, and a custom `.can_commit_import`)
is Administrator-group-only, mirroring `_DATA_CLEANUP_PERMISSIONS`.

Five deliberate deviations from the reference spec (`KukGrade_Data_Import_
Legacy_Migration_Definitive_Implementation_Spec.md`), each with concrete
evidence/reasoning:
1. **Tablib directly, not `django-import-export`.** PyPI/changelog evidence
   at decision time: Tablib 3.10.0 explicitly supports Python 3.14 (and even
   3.15); `django-import-export` 4.4.1 (latest stable) only classified
   through 3.13, with no 3.14 support even in its unreleased 5.0 branch -
   not confirmed compatible with this project's `requires-python = ">=3.14"`
   pin. The spec's own section 6.2 pre-authorises exactly this fallback.
   `django-import-export`'s only real value-add, its ORM-write layer, is
   also the one thing the spec already forbids relying on (section 21).
2. **No background worker for batch expiry.** No queue infrastructure
   exists or is being added (correctly out of scope per the spec). A
   `manage.py expire_stale_import_batches` command run manually/via cron
   replaces it.
3. **Private temp storage is local filesystem**, not S3. The anticipated
   deployment (containerised, Hetzner VPS or similar, persistent storage)
   is exactly what `FileSystemStorage` needs, provided `IMPORT_UPLOAD_ROOT`
   is mounted as a persistent volume - the same requirement the database's
   data directory already has.
4. **Commit is all-or-nothing in one transaction**, not the spec's
   `PARTIAL`-status partial-commit bookkeeping (`ImportBatch.Status.PARTIAL`
   is kept in the enum for forward compatibility but never produced).
   Simpler to reason about correctly for a school-roster-sized import, and
   commit already re-validates everything preview checked immediately
   beforehand.
5. **Rank resolution is exact-match only** (`Rank.code`/`Rank.name`,
   case-insensitive), not the historical importer's messier suggestion-and-
   approval workflow - reserved for the historical-workbook import, where
   source rank text is actually unreliable.

Context:
Raised directly: "So for a v1 how far or close are we to that reality
today" led into a large legacy-import/migration spec being handed over for
review, with the explicit instruction to implement the student-roster piece
now (ignoring the spec's own "after v1.0.0" framing) because the school has
a real grading session on 2026-09-25 and getting the real roster into
KukGrade beforehand makes the app actually useful for it. The historical
KSW Colchester grading-workbook migration (`LegacyGradingRecord`, rank
review, reconciliation, unified grading history) from the same spec is
deliberately deferred to a later, unhurried pass - it concerns past
records, not anything Friday's live session depends on.

Consequences:
A second, larger implementation phase (the historical workbook importer)
remains to be built against the same `ImportBatch`/`data_imports`
foundation; `ImportBatch.Kind.LEGACY_GRADINGS` and the `.xlsx`-only
extension rule for it already exist in the model for that phase to use.
`ImportBatch.Status.PARTIAL` is unused until/unless a real need for partial
commits appears.

### 2026-09-21 - Administrator hard-delete for users and completed assessments, via placeholder reassignment

Status: Accepted

Decision:
`UserViewSet` and `CandidateAssessmentViewSet` each gain a real `destroy()`,
gated to Administrator-only permissions (`accounts.delete_user`; a new
`_DATA_CLEANUP_PERMISSIONS` tuple for `delete_candidateassessment`/
`delete_candidateoutcome`/`delete_promotion`). Deleting a user reassigns
every PROTECT attribution foreign key that referenced them (grading
sessions created, candidates withdrawn, assessments generated, outcomes
proposed/decided, items assessed, promotions recorded, audit events) to a
seeded "Deleted User" placeholder account (`accounts/migrations/0005_seed_
deleted_user_placeholder.py`) rather than nulling or cascading it away.
Deleting a completed assessment cascades through its outcome and promotion
if either exists, reverting the student's rank, and refuses when a later
promotion has already superseded it. Both self-deletion and deleting the
placeholder itself are refused.

Context:
Raised directly, alongside three related asks (a grantable audit-log
permission, scoped audit visibility, and the syllabus redesign - see the
plan file and the following two decisions/FDR-041): "i would like to be
able to delete users as an admin," framed explicitly as recovery from
corruption or bad test data, not routine offboarding (`is_active` already
covers that). Every attribution foreign key in this codebase is `PROTECT`
specifically so deleting a user could never erase who did something (see
the existing comments on `audit.AuditEvent.actor` and
`gradings.CandidateAssessmentItem.assessor`); a true hard-delete needed to
keep that promise rather than override it. Reassignment to a placeholder,
not nulling, was chosen after the first round of answers ("yes, hard
delete") conflicted with that PROTECT-everywhere philosophy - nulling would
have erased attribution exactly as the PROTECT choice was written to
prevent.

Consequences:
Three rows - `Promotion`, a finalised `CandidateOutcome`, and `AuditEvent` -
refuse ordinary `QuerySet.update()`/`delete()` as well as `save()`/
`delete()`, by design, to keep them append-only/immutable against ordinary
code paths. `delete_platform_user` and `delete_candidate_assessment` call
`models.QuerySet.update`/`delete` directly - the real, unbound base
implementations - bypassing those instance-level overrides on purpose at
one documented call site each. This is the one sanctioned way those guards
are bypassed in the codebase; any future caller doing the same outside
these two functions should be treated as a bug, not a precedent. The
placeholder account is excluded from `UserViewSet`'s queryset entirely, so
it can never itself be listed, edited or deleted through the API.

### 2026-09-21 - Fourth sensitive permission: grantable grading-audit-log visibility

Status: Accepted

Decision:
Add `gradings.can_view_grading_audit_log` as a fourth per-user sensitive
permission, identical in mechanism to the existing three
(`can_make_final_grading_decision`, `can_promote_student`,
`can_override_locked_session`): granted via
`PATCH /api/users/{id}/authority/`, in no group. `CanViewAuditLog` gains a
third OR-branch for it. No new filtering logic: the existing
`accounts.view_user` exclusion in `AuditEventViewSet.get_queryset()` already
scopes a holder to grading/syllabus events and away from user-management
ones (`USER_CREATED`, `USER_UPDATED`, `USER_AUTHORITY_CHANGED`,
`USER_DELETED`), since a holder of only this permission won't have
`accounts.view_user` either.

Context:
Raised directly, alongside the admin-deletion asks above: "the audit view
should be an admin only thing for all events, but for events regarding the
school specifically about gradings etc that should be grantable to the
instructors." Confirmed via the "does that make sense" follow-up that this
should reuse the exact boundary already drawn for Masters (everything
except `USER_MANAGEMENT_ACTIONS`), not a narrower cut - retrospective
accountability for grading/syllabus/assessment decisions during post-grading
review, not user-lifecycle visibility.

Consequences:
A fourth boolean travels everywhere the other three already do:
`UserSerializer`, `UserManagementSerializer`, `UserAuthoritySerializer`, the
`AuthorityForm` options list and `ProfileMenu` capability badges on the
frontend. `RequireAuditAccess` and the nav-rail Audit item check it
alongside `can_make_final_grading_decision`. Named for the eventual
"grading groups" workflow this was raised in service of (instructor
sub-groups rotating through syllabus categories of a cohort, reviewing each
other's audit trail) - that workflow itself remains unbuilt; only the
visibility primitive it will depend on exists now.

### 2026-09-20 - Administrators can delete a cancelled session with recorded assessment work

Status: Accepted

Decision:
`validate_session_can_be_deleted` still refuses to delete a cancelled
session that holds recorded assessment work (any candidate past
`NOT_STARTED`) for an instructor, but an administrator can now delete it
deliberately. The DRAFT/CANCELLED status requirement is unchanged for
everyone - no other status becomes deletable.

Context:
Raised directly: "as an admin i should be able to have delete gradings
authority even on sessions that are cancelled." The existing guard blocked
this for every role, added so a cancelled session's assessment work
couldn't be cascaded away with no audit trail to reconstruct it from.
Clarified that the intended change is role-based and automatic for the
Administrator role, not a new per-user grant in `SENSITIVE_PERMISSIONS` -
this is a broader authority than the existing three sensitive permissions,
in keeping with administrators already holding every grading capability
instructors do, plus user administration.

Consequences:
`validate_session_can_be_deleted`, `GradingSession.delete()`, and
`delete_grading_session()` take an optional `actor`; when the actor's role
is Administrator, the assessment-work guard is skipped and the
`SESSION_DELETED` audit event (which already records status and cascaded
candidate IDs) is the trail. `GradingSessionQuerySet.delete()` (bulk/ORM
delete with no request context) keeps the guard unconditionally - the
override only applies where an acting user is known. The frontend delete
menu item on a cancelled session now also shows for an administrator even
when assessment work exists.

### 2026-09-16 - No self-service account creation: Google SSO rejected, no registration page

Status: Accepted

Decision:
KukGrade will not offer Google SSO, nor any other form of self-service
account registration. Every account is created by an administrator through
the existing Users API (`POST /api/users/`) or Django admin - there is no
path for a person to create their own account, with or without a
third-party identity provider.

Context:
Raised while planning self-service account settings: "can we have a Google
SSO as part of the app as well." Research confirmed the two answers that
would have shaped it combine into a serious hole: staff use personal Gmail
addresses (no controlled Workspace domain), and the desired behaviour was
auto-create-on-first-sign-in. Together, anyone holding any Gmail account
could self-provision real access to student and grading records with no
administrator involved. KukGrade holds data on minors; that is unacceptable
regardless of how convenient it would be for staff onboarding. The same
reasoning rules out an open self-registration page, asked about separately
on 2026-09-17: it is the identical failure shape (an outsider grants
themselves access) behind a different login screen.

Consequences:
No SSO provider integration, no registration route, no "sign up" link
anywhere in the frontend. An administrator remains the only path to a new
account. Do not silently reconsider either without re-surfacing this exact
reasoning - if a future request revisits Google SSO or self-registration,
re-read this entry first and re-confirm the Workspace-domain and
auto-create-on-sign-in answers have actually changed, not just that asking
again feels convenient.

### 2026-09-16 - Audit log is administrator-or-Master, not every instructor

Status: Accepted

Decision:
The audit log (`/api/audit-events/` and Django admin's `AuditEventAdmin`) is
readable only by administrators and holders of Master (final-decision)
authority. A plain instructor holding neither is refused entirely, not just
filtered - a stricter cut than the 2026-09-15 user-management-only exclusion,
which still applies on top of this for the same reason (a Master who is not
an administrator still cannot see `USER_*` events).

Context:
Raised directly while reviewing the new bulk-operations endpoints: "the only
people that can see the audit log ... should be master and admin." No group
carries `audit.view_auditevent` any more; access is decided by
`accounts.permissions.CanViewAuditLog` (administrator role, or
`gradings.can_make_final_grading_decision`), mirrored in
`AuditEventAdmin.has_view_permission`/`has_module_permission` so Django
admin enforces the same rule as the API.

Consequences:
`accounts/groups.py` no longer grants `audit.view_auditevent` to either role
group. `audit/views.py` gates `list`/`retrieve` with
`[HasRequiredPermissions, CanViewAuditLog]` rather than a Django permission
in `permission_map`.

### 2026-09-16 - Master authority is administrator-exclusive

Status: Accepted

Decision:
`gradings.can_make_final_grading_decision` can never be held by a user whose
role is Administrator. Granting it to an administrator
(`POST /api/users/{id}/authority/`) is refused, and promoting a user who
already holds it to administrator (`PATCH /api/users/{id}/`, `role`) is
refused too. Administrators keep the other two sensitive permissions
(`can_promote_student`, `can_override_locked_session`) and every other
capability unchanged - only final-decision authority is carved out.

Context:
Raised directly: "I want to run by admins not having the final locked
decision permission and only the master having that but admins having
everything else." The stated reasoning is operational - exactly one
designated Master should make final decisions, while administrators remain a
deliberate safety valve ("if for any reason something doesn't work it can be
dealt with as per SOP") for everything short of that one decision.

Consequences:
Enforced in `accounts/services.py`: `validate_authority_change` refuses the
grant, and `update_platform_user` refuses the role change, both with a
plain `ValidationError` surfaced through the normal error envelope. Note
that a Django superuser bypasses every permission check regardless of what
is explicitly granted, so this guarantee holds for ordinary administrator
accounts but not for whoever holds `is_superuser` (normally only the
bootstrap account, since `is_staff`/`is_superuser` are not API-writable).

### 2026-09-16 - Rank-hierarchy decision overrides will not be built

Status: Rejected

Decision:
No instructor-rank hierarchy (JKN < KSN < PSBN < SBN < PKJN, mirroring the
student belt ladder) will govern who can override a provisional outcome
proposal before an outcome is finalised. `propose_candidate_outcome` keeps
its current shape: any caller with `gradings.change_candidateoutcome` can
revise a DRAFT/PROPOSED outcome, and the audit log already records what a
revision overwrote (2026-09-15's `test_revising_a_proposal_records_what_it_said_before`
case). Only the existing Master-authority finalisation gate governs the
final decision.

Context:
Proposed as: a JKN's provisional decision could not be changed except by a
PSBN-or-higher instructor or the Master, mirroring Kuk Sool grade seniority.
Explored at length and walked back for two concrete reasons once discussed:
first, the school's own instructor grades do not track cleanly onto the
existing student `Rank` catalogue - a JKN-ranked instructor holds more
authority than a JKN-ranked student, so the ladder would need a wholly
separate staff-seniority concept, not a reuse of `Rank`. Second, the two
people expected to use the override most (both KSN) explicitly did not want
same-rank mutual override to be true going forward, which undermined the
premise before a design was even settled. Decided not to add the complexity
now; revisit only if a concrete, reconciled ranking scheme is proposed later.

Consequences:
None - no code changed. Recorded so the idea is not silently re-explored
without this context, and so `CandidateOutcome` is not mistaken for missing
an intended feature.

### 2026-09-15 - User-management audit events are administrator-only

Status: Accepted

Decision:
`USER_CREATED`, `USER_UPDATED` and `USER_AUTHORITY_CHANGED` audit events are
readable only by callers holding `accounts.view_user` (administrators). Every
other action stays readable by any signed-in user, unchanged.

Context:
Found during the post-completion audit (KG-048): `/api/users/` is
administrator-only, but the audit log was readable by any signed-in user,
so an instructor could read who was created, edited, or granted Master
authority through the log even though the Users API itself was closed to
them. Asked directly: logistics - actual running of the app, not Kuk Sool -
is an administrator and Master concern; instructors do not need it and it
should come out of their permissions. This is the same boundary the
capability map already drew on 2026-09-13, applied to a channel that had
been missed.

Consequences:
`AuditEventViewSet.get_queryset()` excludes the three user-management
actions unless the caller holds `accounts.view_user`. A direct retrieve of
an excluded event's id answers 404. `audit.models.USER_MANAGEMENT_ACTIONS`
names the affected actions in one place, so a new user-management action
added later is filtered by construction if it is added to that tuple.

### 2026-09-15 - Login throttle stays process-local; Redis if that changes

Status: Accepted

Decision:
No shared cache is being added for the login throttle now. Confirmed the
deployment is single-process for the foreseeable future, so `LocMemCache`
already gives the intended 10/min bound with no gap. If that ever changes -
multiple gunicorn workers, multiple container replicas - the throttle
should move to Redis, not the database cache, at that point.

Context:
Found during the post-completion audit (KG-039): `ScopedRateThrottle`
stores its counters in Django's cache framework, which defaults to a
per-process in-memory dict with no `CACHES` setting configured. Under
multiple processes each would count independently, loosening the bound to
roughly `10/min x process count` and resetting on every restart. Asked
directly: the deployment is single-process today, which makes this a
non-issue rather than a bug to fix now - and nothing in this repository
currently even defines a multi-process deployment (`compose.yaml` has no
`web` service, no Dockerfile, no process manager). Redis was the stated
preference for if that ever changes, over the zero-new-infrastructure
alternative (a Postgres-backed database cache), so that preference is
recorded here rather than left to be re-litigated later.

Consequences:
No code change. Revisit if the deployment ever becomes multi-process:
add a `CACHES` entry pointing at Redis and confirm the throttle picks it up
before shipping that topology, rather than discovering the gap in
production.

### 2026-09-14 - Frontend stack and generated API types

Status: Accepted

Decision:
React Router for navigation and TanStack Query for server state. API response
types are generated from a `drf-spectacular` OpenAPI schema rather than
hand-maintained, so the frontend's description of server data cannot silently
drift from the serializers.

Context:
Phase 3 is the critical path at 4-6 weeks and could not start without this. The
2026-09-13 error-envelope decision deferred `drf-spectacular`, leaving types
hand-written; that deferral is now reversed. The existing error envelope stays
as built - it already matches the shape the industry converged on, and
`drf-standardized-errors` would only have earned its place by generating the
schema, which `drf-spectacular` now does directly.

No hand-written API types anywhere. This includes the existing ones in
`frontend/src/api.ts` - `AuthUser`, `HealthResponse` and the error-envelope
types are replaced by generated equivalents rather than left as exceptions.

Consequences:
Three dependencies, each justified. Type generation costs roughly half a day to
wire and removes a class of failure that otherwise surfaces mid-grading rather
than at build time. The generated schema must be regenerated whenever a
serializer changes; CI should check it is current, so a serializer change that
nobody mirrors fails the build rather than a screen.

### 2026-09-14 - Syllabus versioning deferred, not cancelled

Status: Accepted

Decision:
Do not build `SyllabusVersion`, the spreadsheet import, or a syllabus upload
screen now. Syllabus content is maintained directly by the project owner when
an update is needed. Revisit when a second real edition exists.

Context:
The 2026-09-13 syllabus versioning decision assumed instructors would author
versions in the app. The owner will handle updates personally instead. The
capability map already gives instructors view-only syllabus access and no
Django admin, so the syllabus is effectively immutable to everyone using the
application, which was the property "set in stone" was protecting. Assessment
snapshots independently protect historical gradings from any later change.

Consequences:
Saves the 3-4 day Phase 2b slice. KG-014 returns to its original P3 rating:
the outstanding gap is provenance - "which edition was this graded against" is
unanswerable - not correctness. Replacing syllabus rows in place will leave
existing snapshots intact but unlinked to their source, which is the cost of
deferring.

### 2026-09-14 - Data erasure handled manually

Status: Accepted

Decision:
Build no anonymisation or erasure mechanism. Erasure requests are handled
manually if one arises. `KG-NEXT-019` is dropped from the backlog.

Context:
The recommendation was anonymise-in-place: strip name and date of birth, keep
the grading record so a rank retains its provenance. The owner accepts handling
this by hand instead.

Consequences:
PROTECT foreign keys mean a student with grading history cannot be deleted
through the application at all, so a manual request needs direct database work.
Recorded here so the position is deliberate rather than an oversight. Revisit if
the club grows or a request actually arrives.

### 2026-09-14 - Student status semantics

Status: Accepted

Decision:
`Student` gains `ACTIVE`, `INACTIVE`, and `LEFT`, replacing the binary
`is_active` flag. `INACTIVE` means a temporary break - injury, exams, travel -
and blocks nothing. `LEFT` blocks registration as a grading candidate. Both are
reversible, and grading history is retained in every case.

Context:
AGENTS.md lists the three values as a confirmed requirement (audit KG-025) but
never defined their behaviour. It also states that missing a grading must never
automatically mean a student left, so status is only ever changed deliberately
by a person.

Consequences:
Migration maps `is_active=True` to `ACTIVE` and `False` to `INACTIVE`, the
conservative reading: an existing inactive student is on a break, not gone.
Candidate registration gains a status check.

### 2026-09-13 - Syllabus versioning and immutability

Status: Accepted

Decision:
The syllabus is versioned and set in stone. Introduce `SyllabusVersion` with a
`DRAFT -> PUBLISHED -> SUPERSEDED` lifecycle:

- A version is authored by uploading a structured spreadsheet (CSV/Excel), one
  row per requirement: rank, age band, item code, item name, Korean name,
  category, sequence, start/end number, required flag, notes. The import is
  validated as a whole and rejected entirely if malformed.
- While `DRAFT` a version is editable, so typos can be fixed before release.
- Publishing freezes the version permanently. Published items and requirements
  can never be edited or deleted.
- Publishing a new version supersedes the current one. Superseded versions stay
  readable forever so historical gradings remain reconstructable; nothing is
  ever deleted. "Removing" a syllabus means retiring it from use.
- `SyllabusRequirement`'s unique constraint becomes
  `unique(version, rank, age_band, item)` so versions can coexist.
- Assessment generation resolves the current published version and records it on
  the assessment, alongside the existing per-item display snapshots.

This resolves open question Q6 and re-scopes audit finding KG-014.

Context:
The current model has no version concept: 32 items and 373 requirements are
mutable rows with `active` flags, seeded by a data migration. The 2026-09-13
audit rated KG-014 as P3 on the grounds that per-item snapshots already protect
historical meaning, so an explicit version was provenance rather than
correctness. That reasoning holds for reading history but misses how the
syllabus is authored: immutability is the core maintenance rule, not a reporting
feature. KG-014 is re-rated P2 accordingly.

Consequences:
The unique-constraint change is a migration against seeded production-shaped
data; existing items and requirements are migrated into a `WKSA 2014` published
version. Per-item display snapshots are retained as well as the version link -
belt and braces, and the snapshots already have test coverage. The instructor
syllabus capability from the capability-map decision cannot be granted until
this lands, so syllabus versioning is sequenced immediately after the
permissions, integrity and audit work and before frontend integration.
Estimated 3-4 days. A syllabus upload screen is deferred; the first import path
may be a management command.

### 2026-09-13 - Capability map and role definitions

Status: Accepted

Decision:
Instructors own everything related to Kuk Sool; logistics beyond that is left to
administrators and the Master in charge.

Groups and their Django permissions:

- Instructor: full add/change/view on students, grading sessions, and grading
  candidates; full assessment and outcome-proposal workflow; authoring and
  publishing of new syllabus versions. No user or role management.
- Administrator: everything an instructor has, plus user and role management.
- Master: not a group. The three sensitive permissions
  (`can_make_final_grading_decision`, `can_promote_student`, and
  `can_override_locked_session`) are grantable to any user independently of
  their group, so authority survives a specific person being unavailable.

`User.Role` drops `manager`, leaving `instructor` and `administrator`.

Context:
The 2026-09-13 authority-primitive decision settled the mechanism but not the
policy, which blocked KG-NEXT-008. The confirmed policy is that an instructor
can run a grading end to end - schedule it, register candidates, maintain
student records, edit the syllabus, assess, and propose an outcome - but cannot
make the final decision, promote a student, or withdraw a candidate from a
locked session. No code or documentation uses the `manager` role.

Consequences:
A new `can_withdraw_locked_candidate` permission is added for KG-008 rather than
reusing final-decision authority. Instructors are not granted `is_staff`, so
Django admin stays closed to them.

Amended later the same day: this entry originally granted instructors `is_staff`
so that syllabus editing worked through Django admin. That was wrong. The
syllabus is immutable once published, and Django admin's whole affordance is
editing rows in place. The instructor syllabus capability is delivered by the
syllabus versioning decision below instead, and cannot be granted until that
work lands.

### 2026-09-13 - Outcome revision is logged, not gated

Status: Accepted

Decision:
Instructors may freely revise a proposed outcome until the Master finalises it.
No reason field is required, no approval step is added, and no proposal-history
model is introduced. Instead, every proposal, revision, final decision,
promotion, and syllabus change is recorded as an append-only audit event.
Disagreements are discussed in person, not captured as structured data.

Context:
The audit found (KG-029) that `propose_candidate_outcome` overwrites the
previous proposal in place, so if one instructor changes another's proposed
outcome the change is invisible - including to the Master who must adjudicate
it. Requiring a reason, keeping an append-only proposal model, and a two-stage
sign-off were all considered and rejected as more process than the setting
warrants. "Locked by the Master" is already enforced: finalised outcomes cannot
be re-proposed.

Consequences:
No domain logic changes. The audit log becomes load-bearing rather than
supporting scenery, so a minimal `AuditEvent` model moves from Phase 4 into
Phase 2 alongside the permissions work, estimated 1-2 days. Until it lands,
outcome revisions remain unrecorded. The `actor` parameters already stubbed at
`services.py:235` and `services.py:447` are the insertion points.

### 2026-09-13 - Authority primitive is Django permissions

Status: Accepted

Decision:
Django permissions are the single authority primitive for KukGrade. `User.role`
becomes a convenience label that assigns a Group, not an enforcement mechanism.
Delete the unused `IsInstructorOrAbove`, `IsManagerOrAdministrator`,
`IsAdministrator`, and `IsAuthenticatedUser` role classes; keep small custom
permission classes only for the six custom actions (`generate-assessment`,
`create-outcome`, `propose`, `finalise`, `summary`, `promote`). Remove the
inert `User.can_make_final_grading_decision` boolean. "Authorised Master" is a
permission, consistently with everything else.

Context:
The 2026-09-13 independent audit found three competing authority mechanisms in
one codebase: role classes wired to zero views (KG-001), Django permissions
that are the only thing actually enforcing anything, and an inert boolean
(KG-003). These are not three problems but one: the authority primitive had
never been chosen. This completes the 2026-06-25 final-decision-authority
decision rather than superseding it.

Consequences:
Closes KG-001, KG-003, and open question Q2 in one change. Authority becomes
adjustable through admin Groups without a deploy. Every endpoint needs an
explicit permission class and a role-by-operation matrix test, which is the
highest-value test addition currently missing. Estimated 1.5-2 days.

### 2026-09-13 - Locked grading session exit paths

Status: Accepted

Decision:
Add two exits from `LOCKED`. First, authorised post-lock candidate withdrawal:
gated by final-decision authority, requiring a recorded reason plus
`withdrawn_by` and `withdrawn_at`, blocked once the candidate's outcome is
`FINALISED`. Second, `LOCKED -> CANCELLED` for a genuinely abandoned grading.
The assessment snapshot is retained unchanged on withdrawal; partial results
stay as they were recorded.

Context:
The audit found (KG-008) that a locked session had no safe exit for a candidate
who could not finish. Withdrawal and deletion both require a draft or open
session, `LOCKED` transitions only to `COMPLETED`, and completion requires every
non-withdrawn candidate to hold a finalised outcome. The only in-app escape was
to mark unassessed items `NOT_MET` and finalise a false `FAIL`, writing
fabricated results into a record the system then correctly refuses to change.
`LOCKED -> CANCELLED` alone was rejected as the primary remedy because
`PROMOTION_SESSION_STATUSES` requires a locked or completed session, so
cancelling would strip promotion from every other candidate in the session.
Exam-board practice (absent and incomplete coded separately from any grade) and
clinical data capture (never impute a value for "not done"; always record a
reason) both support recording the true event rather than reusing a
nearby-looking one.

Amended on implementation: the permission is `can_override_locked_session`,
not `can_withdraw_locked_candidate`. This decision has two exceptional
post-lock actions - withdrawing a candidate and cancelling the session - and
gating only the first would have left any instructor able to destroy a locked
grading. They are the same kind of intervention, so they share one permission
rather than proliferating two.

Consequences:
`validate_candidate_can_be_changed` and `validate_candidate_assessment_changes`
each need a narrow carve-out reachable only through the authorised service path.
Withdrawn candidates are already excluded from lock and completion checks, so no
new exclusion logic is required. A separate `DID_NOT_FINISH` outcome was
considered and deferred; revisit only if grading paperwork distinguishes "did
not finish" from "withdrew". Estimated half a day plus one hour.

### 2026-09-13 - API error envelope and list pagination

Status: Accepted

Decision:
Extend the existing `custom_exception_handler` envelope with a `fields` member
so validation errors reach clients as structured per-field messages alongside
the existing `code` and `message`. Return 405 rather than 400 for unsupported
outcome mutation. Apply DRF `PageNumberPagination` uniformly to every list
endpoint with no exemptions, including small reference collections.

Context:
The audit found (KG-015) that the frontend discards all field-level validation
errors because it reads only `error.message` or `detail`, while DRF sends
`{"field": ["msg"]}`; every 400 degrades to a generic message, blocking every
form in the application. Three error envelopes currently coexist (KG-017), and
no list endpoint is paginated (KG-004). Stripe, GitHub, Google, and RFC 9457 all
converged on machine code plus human message plus a separate structured
field-error member; the existing handler already has the first two.
`drf-standardized-errors` was considered and deferred because its main advantage
is OpenAPI schema generation, which only pays for itself alongside
`drf-spectacular`.

Consequences:
Both are response-shape changes and must land before frontend screens are built,
or the screens get rebuilt. Pagination is uniform so the client needs exactly one
unwrap helper and no special cases. Moving to cursor pagination later would only
remove `count`, a far smaller break than adding an envelope after the fact.
TypeScript types remain hand-maintained for now; the type-synchronisation half of
open question Q4 is still unresolved.

### 2026-06-25 - Documentation truth and audit remediation tracker

Status: Superseded by 2026-09-24 - One document per job; every API shape declared in the schema

Decision:
Create `docs/current-system.md` as the current implementation source of truth,
create `docs/audits/remediation-status.md` as the audit remediation tracker,
and mark older broad planning documents as legacy or mixed target/current
inputs. Treat `docs/api_contract.md`, `docs/data_model.md`, and
`docs/grading_app_planning.md` as planning context unless reconciled with the
current-system document and accepted decisions.

Context:
The repository audit found that current-state documentation, target planning,
and legacy planning language were mixed together. This caused stale claims such
as the project being only in planning, grading foundations being deferred, and
some unimplemented target endpoints looking current.

Consequences:
Future implementation must check `docs/current-system.md` and the remediation
tracker before acting on older planning files. Audit remediation should proceed
by stage, with documentation, tests, and review evidence recorded in the
tracker.

### 2026-06-25 - Final decision authority source

Status: Accepted

Decision:
Treat the Django permission `gradings.can_make_final_grading_decision` as the
current runtime authority for final grading decisions. The older
`User.can_make_final_grading_decision` boolean is a legacy field and must not
be presented as granting final-decision authority. Removing or replacing that
boolean is tracked as audit finding M-01.

Context:
The 2026-06-21 identity decision described a separate boolean capability, but
the later candidate outcome implementation uses a Django permission and tests
prove the boolean alone does not grant finalisation authority.

Consequences:
Documentation and UI must not imply that ticking the legacy boolean grants
final-decision authority. A future remediation stage should migrate/remove the
field or deliberately redefine it with tests and documentation.

### 2026-06-23 - Promotion and rank-history foundation

Status: Accepted

Decision:
Create `Promotion` as the immutable rank-history record for successful grading
progression. Promotion is explicit, PASS-only, and separate from final outcome
recording. A candidate can be promoted only from a `FINALISED` `PASS` outcome
when the candidate and assessment are `COMPLETED`, the candidate is not
withdrawn, the session is `LOCKED` or `COMPLETED`, the candidate
testing-for rank is still the next active rank after the student's current
rank, and no promotion already exists for the outcome or grading candidate.
Promotion requires the separate `gradings.can_promote_student` Django
permission. `gradings.can_make_final_grading_decision` does not imply promotion
authority.

Context:
Final Master decisions and assessment snapshots already preserve grading
evidence, but they deliberately did not change student rank. Rank progression
needs an auditable administrative action that can happen after finalisation,
without forcing all candidates to be promoted before session completion and
without promoting `FAIL` or `CONDITIONAL` outcomes.

Consequences:
The canonical `promote_candidate()` service runs in one transaction: it locks
the outcome, candidate, assessment, and student rows, creates `Promotion`, and
updates only `Student.current_rank`. Both the history record and rank update
succeed or neither is persisted. `Promotion` stores protected references to the
student, outcome, grading candidate, from-rank, to-rank, and promoter, plus
server-controlled `promoted_at`, grading-date `effective_date`, and optional
notes. Records are immutable after creation and cannot be deleted through
normal model, API, or admin paths. The API derives actor and effective date
server-side and rejects client-supplied actor/date fields. Once a student has
promotion history, ordinary student saves cannot directly change
`current_rank`; initial rank assignment and pre-history corrections remain
possible. Rank history begins with KukGrade-managed promotions and may not
include rank changes that predate application adoption. Reversing migration
`gradings.0004_promotion` is a schema rollback only; it deletes promotion rows
and the custom permission but does not implement business promotion reversal or
automatic student-rank rollback. Backdating, postdating, demotion, reversal,
promotion correction, conditional follow-up, certificate generation,
notifications, payment handling, frontend screens, and broader audit-event
infrastructure remain deferred.

Note added 2026-09-15 while recovering this entry from an unmerged worktree:
immutability was later strengthened beyond what this entry describes -
`QuerySet.update()` and `QuerySet.delete()` on `Promotion` now refuse as well,
so the rule holds from the shell too (KG-044). Row locking was also narrowed to
`of=("self",)` so a promotion no longer incidentally locks the joined session,
student and rank rows (NEXT-014).

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

None. Every decision arising from the 2026-09-23 assessment grading redesign
is recorded above. See `assessment-grading-redesign-handoff.md` and
`../frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/README.md`.
