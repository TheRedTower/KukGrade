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

Status: Accepted

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
