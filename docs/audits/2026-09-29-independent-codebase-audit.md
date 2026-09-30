# KukGrade — independent whole-repository audit

**Date:** 29 September 2026  
**Repository:** TheRedTower/KukGrade  
**Audited branch:** `dev`  
**Pinned commit:** `668159a9e5660c9c15612d444206b6fe755b4e86`  
**Mode:** read-only review; no application code, configuration, migrations, repository branches or production data changed.  
**Audience:** repository owner and Claude Code undertaking a subsequent, separately authorised remediation pass.

## 1. Executive verdict

**KukGrade has a coherent overall architecture, but it does not yet justify a clean bill of health for consistency, data integrity or operational correctness. Stabilise the existing system before extending it.**

The principal problem is not an excessive number of frameworks or five independently implemented APIs doing the same job. It is that several important rules have different enforcement boundaries: some exist only in React, some in individual services, some in model validation, and some in database constraints. The boundaries do not always agree. There are also avoidable data-fetching costs and lifecycle/state-management defects.

The highest-priority findings are:

1. Forced password change is a frontend gate, not a backend access restriction.
2. Logout does not clear user-sensitive query data or indefinitely retained assessment-note drafts.
3. Related grading operations lock different rows, allowing cross-operation races that the current concurrency tests do not cover.
4. Destructive cleanup can revert a student's rank using a stale preflight check while a later promotion is occurring.
5. The cumulative syllabus shown to users and the exact-rank syllabus used to generate assessments are different definitions of the grading content. Weapons are also missing from the syllabus browser's effective-content path.

Other confirmed defects include incorrect middle age-band filters, import preview accepting overlength values that commit rejects, source-file deletion before database commit, an advertised PATCH operation that always returns 405, misleading completion counts, and an activity classifier that treats the word “password” as evidence of an approved grading action.

**Do not respond with a rewrite.** Keep the Django/DRF/PostgreSQL + React/TypeScript architecture. Repair its boundaries and consolidate actual duplicated policy. Do not remove historical migrations, generated contracts, necessary snapshot fields, audit provenance or intentional lifecycle actions in pursuit of a smaller file count.

There is substantial good engineering here: a central service layer, generated API types, permission mappings that deny undeclared actions, real PostgreSQL CI, explicit database checks, immutable-history concepts, shared pagination/filtering/error utilities, private import storage, production container hardening and a meaningful automated test suite. Those strengths make targeted remediation practical; they do not negate the findings below.

## 2. Scope, evidence and limitations

### 2.1 What was reviewed

The complete pinned tree contained **269 tracked file blobs, approximately 3.50 MB**. All **268 text files** were retrieved and their Git blob hashes verified. The remaining file was the 106,087-byte JPEG logo; its tree entry was inventoried but its visual content was not reviewed. The SVG logo was included in the text inventory.

Review covered:

| Layer | Work performed | Important boundary |
| --- | --- | --- |
| Frontend | Routes, authentication, API client, query keys, mutation handling, grading screens, student/user management, imports, syllabus, audit display, shared hooks, styling/build structure and tests | Static inspection and isolated JavaScript probe; no live browser/accessibility certification |
| Backend/API | URL/view/serializer/service/model paths, permission enforcement, lifecycle actions, error handling, pagination, filters, imports, history and admin integration | Source tracing, not a live HTTP penetration test |
| Database | All model families, constraints, relationships, migrations, transaction/lock patterns, cleanup and rank changes | No production schema/data inspected; cross-operation race schedules inferred from source, not executed against PostgreSQL here |
| Repository/operations | Dependency manifests and locks, CI, Docker/Compose, entrypoint, settings, health/readiness, operational docs and historical design/audit material | No deployment, secret retrieval, host inspection or backup restoration performed |
| Supplied sources | Project notes and both WKSA 2014 syllabus PDFs; text extraction plus visual inspection of the charts | Checked relevant seed examples and category coverage; not an independent certification of every chart transcription or the governing syllabus policy |

All discovered files were accounted for. Deep review was risk-based, with emphasis on live paths and invariants. **This is not a claim that every possible execution path or every line has been formally verified.** A repository review cannot honestly guarantee that nothing inefficient or defective remains.

Paths below are relative to the pinned repository root, for portability into Claude. Line numbers refer to this commit, not a future branch tip. Source baseline: [pinned repository tree](https://github.com/TheRedTower/KukGrade/tree/668159a9e5660c9c15612d444206b6fe755b4e86). The local review snapshot was `/workspace/scratch/532c2197b192/audit_snapshot`.

The `prod` branch and the other feature/design branches were **not** audited. Findings must be revalidated if Claude works on a newer commit. No conclusion here establishes which revision is currently deployed.

### 2.2 Evidence labels

- **Probe-confirmed:** selected actual source was executed with deliberately minimal substitutes for framework dependencies, or its generated contract was mechanically inspected. This proves the stated local behaviour, not full integration.
- **Source-confirmed:** the implementation and its caller/callee path directly establish the issue.
- **Concurrency risk:** missing coordination and a feasible interleaving are established from source; a deterministic PostgreSQL regression test is still required.
- **Decision required:** divergent behaviour is verified, but the correct business policy must be chosen explicitly.
- **Improvement:** justified maintainability/performance work, not a demonstrated production incident.

Severity is relative to this internal grading application:

- **P1:** resolve before treating the current release as hardened for normal grading/administrative use.
- **P2:** substantive correctness, reliability or efficiency defect; include in the immediate stabilisation programme.
- **P3:** bounded cleanup or assurance improvement after correctness work.

No P0 incident or confirmed production compromise was established.

### 2.3 Verification actually observed

[GitHub Actions run 36444847694](https://github.com/TheRedTower/KukGrade/actions/runs/36444847694), associated with the audited revision, completed successfully on 28 September 2026. Its job logs and step results were inspected, not merely a green badge.

| Check | Observed evidence |
| --- | --- |
| Backend tests | **661 passed** in 92.08 seconds on CI's PostgreSQL setup |
| Backend lint/types | Ruff passed; mypy reported no issues in **143 source files** |
| Framework/contracts | System/deployment checks, migration drift and OpenAPI schema checks passed |
| Frontend tests | **209 tests in 18 files passed**, in both the normal run and `America/Los_Angeles` run |
| Frontend validation | Lint, TypeScript, generated-type drift, build and npm audit steps passed; audit reported zero vulnerabilities at that run |
| Production image | Compose-template validation, image build and production-settings check passed |
| Local syntax/inventory | **144 Python files** AST-parsed; text-blob hash verification had no mismatches |
| Local defect probes | Age-filter predicates, bulk exception handling, import validation, file-deletion order, seeded syllabus divergence, advertised outcome PATCH, and activity-label classification checked in isolation |

**The full application suite was not rerun locally.** This environment did not have the repository's Python 3.14/Django/PostgreSQL stack. Local Python syntax/probe work used Python 3.12 and is not a substitute for the project's supported runtime. No source dependencies were installed or upgraded.

Green CI establishes that the tested behaviours pass. It does not establish that undocumented interleavings, identity switches, over-page-size cohorts or every exceptional path are tested.

## 3. Prioritised findings

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| KG-A01 | P1 | Forced password change is not enforced by backend authorisation | Source-confirmed |
| KG-A02 | P1 | Query cache and drafts survive user logout/account change | Source-confirmed; browser regression required |
| KG-A03 | P1 | Cross-operation grading locks do not protect shared invariants | Concurrency risk |
| KG-A04 | P1 | Cleanup rank rollback is not serialised with promotion | Concurrency risk |
| KG-A05 | P1 | Assessment and syllabus browser use different content rules | Probe-confirmed; policy decision required |
| KG-A06 | P2 | Middle age-band filters include younger students | Probe-confirmed |
| KG-A07 | P2 | Import source is deleted before database commit succeeds | Probe-confirmed control flow |
| KG-A08 | P2 | Import expiry bypasses the locked lifecycle | Source-confirmed concurrency risk |
| KG-A09 | P2 | Import preview validation disagrees with commit validation | Probe-confirmed |
| KG-A10 | P2 | Spreadsheet resource limits are incomplete or applied too late | Source-confirmed; load testing required |
| KG-A11 | P2 | Bulk row independence fails for escaping IntegrityError | Probe-confirmed control flow |
| KG-A12 | P2 | Generic update services can overwrite concurrent changes | Source-confirmed concurrency risk |
| KG-A13 | P2 | API schema advertises an impossible outcome PATCH | Probe-confirmed |
| KG-A14 | P2 | Audit/service parity is incomplete across admin and write paths | Source-confirmed |
| KG-A15 | P2 | Session spotlight metrics are wrong and pagination-dependent | Source-confirmed |
| KG-A16 | P2 | Failed prerequisite reads are treated as valid empty data | Source-confirmed |
| KG-A17 | P2 | Outcome proposal cannot reliably recover after partial success | Source-confirmed failure path |
| KG-A18 | P2 | Optimistic scoring and cache invalidation need explicit ownership | Source-confirmed risks; browser tests required |
| KG-A19 | P2 | Activity labels are inferred from prose instead of action data | Probe-confirmed |
| KG-A20 | P2 | Frontend list/count workflows over-fetch and fan out requests | Source-confirmed cost pattern |
| KG-A21 | P2 | Backend read models perform avoidable per-row/full-item work | Source-confirmed cost pattern |
| KG-A22 | P2 | Documentation overstates guarantees and the error contract | Source-confirmed |
| KG-A23 | P3 | Module boundaries and low-value residue need bounded cleanup | Improvement |
| KG-A24 | P3 | Release assurance lacks several integration/operational gates | Verified assurance gap; not a production incident |

### KG-A01 — Forced password change is not a backend boundary

**Evidence:** `backend/accounts/permissions.py:58–112` (`_active_user`, `HasRequiredPermissions`); `backend/accounts/views.py:35–99`; `backend/accounts/models.py` (`must_change_password`); `frontend/src/App.tsx:437–441`.

The React route guard displays the forced-change screen, but backend permission checks only require an authenticated, active user with the relevant permissions. They do not reject a user whose `must_change_password` flag is true. Login creates a normal authenticated session. There is no compensating enforcement in the inspected middleware/settings.

**Consequence:** a user with an administrator-issued temporary/reset password can call otherwise authorised API operations directly without changing that password. The flag is not an enforced restriction. This is not an authentication bypass or access to permissions that the account never possessed; it is a bypass of the intended forced-change state.

**Repair:** establish one backend restricted-account policy. Explicitly allow only the operations needed to inspect that state, change the password and end the session; deny protected business reads/writes until cleared. Apply it consistently to APIViews, ViewSets and any intended admin access. Do not duplicate the rule in every endpoint. Preserve ordinary role/authority checks after the gate.

**Acceptance:** an authenticated forced-change user cannot read students, create a session, score, import, administer users or exercise final-decision authority through direct HTTP requests. Password change, current-user bootstrap and logout still work. Resetting an existing account re-establishes the restriction. Define/test whether changing the password ends or preserves the current session.

### KG-A02 — Logout leaves sensitive query data behind

**Evidence:** `frontend/src/auth.tsx:85–105`; `frontend/src/App.tsx:461–485`; `frontend/src/candidateAssessmentData.ts:210–238`; `backend/audit/models.py:105–113`.

Logout's success handler sets only `['currentUser']` to null. It does not clear the application query cache, despite the adjacent comment saying that the cache is cleared. The same QueryClient lives for the app's lifetime. Login similarly replaces the current-user query without isolating other keys. Assessment-note drafts use candidate-only keys with `gcTime: Infinity`.

**Consequence:** another account using the same app instance can encounter the previous user's cached data or drafts. This matters even in an internal staff app: audit visibility differs by permission. An administrator can cache user-management events that an instructor with grading-audit access is not entitled to receive from the backend. Reusing the same query key can expose old results while the new request is pending or failing. This exposure sequence is a source-derived risk, not an executed browser demonstration here.

**Repair:** define an identity boundary for all sensitive queries and drafts. On successful logout, confirmed authentication loss and account switch, cancel relevant in-flight work and clear/reset sensitive state before admitting the next identity. Ensure late request completion cannot repopulate the old identity's data. Merely invalidating queries is insufficient. Account-scoped cache keys can help but do not replace logout cleanup.

**Acceptance:** log in as administrator, load sensitive audit data and a notes draft, log out, log in as a differently authorised instructor, then delay/fail the network. No prior-account content appears. Test pending requests completing during the switch, session expiry, and back/forward navigation. A failed logout request must not falsely claim that the server session ended.

### KG-A03 — Locks protect individual rows, not complete grading invariants

**Evidence:** `backend/gradings/services.py:322–386`, `:1456–1483`, `:1895–1951`, `:1955–2008`, `:2051–2105`; model validation at `backend/gradings/models.py:493–500` and `:983–1007`; concurrency tests in `backend/gradings/test_concurrency.py`.

The repeated `select_for_update(of=('self',))` syntax is consistent, but the lock protocol is not. Selecting related rows does not lock them when `of` includes only the model itself.

| Operation | Explicit lock taken | Related state relied on without the same coordinating lock |
| --- | --- | --- |
| Transition session | Session | Candidate/assessment completion and outcomes |
| Complete/reopen assessment | Assessment | Session state; required item state; candidate state |
| Update assessment item | Item | Assessment status, session status, candidate withdrawal |
| Register candidate | No explicit row lock | Session openness and student's current state |
| Finalise outcome | Outcome | Session/candidate eligibility |
| Promote | Outcome, then candidate, assessment, student | Session state; also a different order from some cleanup paths |

Two concrete source-derived schedules:

1. An item edit locks the item and reads its assessment as in progress. Before the edit saves, completion locks the assessment, sees the old required item result as assessed, and commits completion. The first transaction then clears that item to `NOT_ASSESSED`. Item model validation does not recheck the parent's completed state. The final state can contradict completion's requirement.
2. Reopen locks a completed assessment and reads its session as open. Session locking concurrently sees the completed assessment and commits `LOCKED`. Reopen then persists `IN_PROGRESS`. A locked session can now contain a reopened incomplete assessment.

Registration versus session locking and withdrawal versus decision-making require the same analysis. Existing concurrency tests exercise duplicate generation, duplicate outcome creation, competing finalisations, duplicate promotions and competing session transitions. Those are useful, but they do not test these different-operation pairs.

**Repair:** specify a shared lock hierarchy and revalidate state after acquiring it. A simple per-session coordinating lock may be appropriate for this application's workload, with separately ordered student locks where rank is affected; choose based on the full set of workflows, not one endpoint. Keep lock acquisition deterministic. Do not blindly remove `of=('self',)` everywhere: nullable joins and unnecessarily wide locks introduce other problems.

**Acceptance:** PostgreSQL tests with separate connections and barriers force item-edit/completion, reopen/lock, registration/lock, withdrawal/finalisation, cancellation/promotion and relevant deletion races. Each result must correspond to a valid serial ordering, with coherent audit events. Do not use sleeps as the main synchronisation mechanism or SQLite as evidence.

Reference for the locking interpretation: [Django 5.2 `select_for_update`](https://docs.djangoproject.com/en/5.2/ref/models/querysets/#select-for-update).

### KG-A04 — Cleanup can revert rank from a stale view

**Evidence:** `backend/gradings/services.py:1380–1453` (`delete_grading_session`), `:1642–1700` (`delete_candidate_assessment`), `:978–1070` (`promote_candidate`); `backend/students/services.py:128` onward.

Session deletion checks each promotion against a student's current rank and later updates that rank without locking the student across the check and write. Assessment deletion locks only the assessment before performing the analogous rollback. Promotion does lock the student. These operations do not therefore share the protection needed by the invariant.

**Consequence:** after cleanup validates “this is the latest rank change”, a concurrent promotion from a different session can advance the student. Cleanup can then overwrite that newer rank with the old promotion's `from_rank`, leaving later promotion history inconsistent with `Student.current_rank`. Different lock orders also warrant explicit deadlock tests.

**Repair:** preserve the approved administrator cleanup capability, but serialise validation, history removal and rank rollback with all affected promotion/student workflows. Refresh the exact rows after lock acquisition. For multi-student session deletion, acquire relevant locks in a stable order and validate the whole operation before mutation. Do not weaken the current protection against deleting a superseded promotion.

**Acceptance:** concurrently delete an earlier session/assessment while promoting the same student elsewhere. The operation either safely refuses or produces a valid serial result; it must never overwrite a newer rank using stale validation. Cover full-session deletion, single-assessment deletion and student deletion. Audit rollback must reflect the actual committed state.

This is a missing-coordination finding, not evidence that the repository owner's deliberate hard-delete policy is itself illegitimate.

### KG-A05 — “Applicable syllabus” has two competing meanings

**Evidence:** `backend/gradings/services.py:1703–1715`; `backend/syllabus/services.py:1–25,65–114`; `backend/syllabus/migrations/0002_seed_wksa_2014_syllabus.py`; `frontend/src/SyllabusScreen.tsx`; `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md` FDR-041.

Assessment generation selects requirements for the **exact testing rank**. The browser's effective syllabus instead selects the most recent applicable mapping for each item at **any rank up to the testing rank**. Its service describes those rows as examinable content. This is semantic duplication, not simply two convenient URLs.

An isolated evaluation of the committed seed data demonstrates the difference for an adult testing for `BLUE_STRIPE`:

| Content | Exact-rank assessment technique/form selection | Cumulative browser selection |
| --- | --- | --- |
| Sohn Mohk Soo; Cho Geup Hyung | Included | Included |
| Sohn Ppae Ki; Ki Bohn Soo; Ki Cho Hyung | Omitted at this rank | Included from earlier ranks |

The exact-rank assessment also includes the six universal core areas. The discrepancy above concerns technique/form items, not those core areas.

Separately, the cumulative service restricts categories to `TECHNIQUE_SET` and `FORM`. The syllabus screen's core strip does not add weapons. Seeded `JKN` requirements include `SWORD_TECHS` and `BOHNG_DOL_LI_KI`, both present in the supplied charts, but absent from this browser content path. Cumulative browsing above the seed's supported rank range also needs an honest supported/unsupported state rather than implying a complete later-rank curriculum.

**Decision required:** is an assessment intended to cover all examinable cumulative content, or only the selected rank's new testing increment? The divergence is verified; the PDFs alone are not enough to silently choose a grading policy. If the latter is intentional, the product must explain the distinction clearly and test it. If cumulative assessment is intended, one canonical resolver must feed new snapshots and the browser, with explicit category handling.

**Acceptance:** owner-approved examples for each age band and several transitions, including `BLUE_STRIPE` and `JKN`; item/range/requiredness/category assertions at both API and snapshot levels; weapons visible where applicable; unsupported ranks handled explicitly. **Never regenerate or rewrite historical snapshots as an incidental cleanup.**

### KG-A06 — Age-band filtering returns the wrong students

**Evidence:** `backend/students/views.py:31–42`; correct bound calculation in `backend/gradings/services.py:151–189`.

When a lower birth-date bound exists, `_filter_age_band` returns immediately. It never applies the upper birth-date bound for the two middle bands.

Actual isolated-source results using 29 September 2026 and students aged 8, 12, 16 and 26:

```text
AGE_9_TO_12  -> ages [8, 12]
AGE_13_TO_17 -> ages [8, 12, 16]
```

**Repair:** compose both non-null predicates before returning. Reuse the existing canonical bounds helper; do not introduce another frontend age rule.

**Acceptance:** API filter tests for every band, birthdays at both edges, immediately outside each edge, 29 February birth dates and the configured local date. A correct age resolver does not by itself test the queryset filter.

### KG-A07 — Import files are destroyed before transaction success

**Evidence:** `backend/data_imports/services.py:179–246`, particularly `_mark_committed` and `cancel_import_batch`.

These paths delete the stored source file before saving the terminal batch state and recording the audit event. Database rollback cannot restore a file deleted from storage. An isolated fault-injection probe confirmed the order `source_file_deleted -> database_save_failed`.

**Consequence:** a later save/audit/commit failure can leave the database indicating a pending batch whose source file no longer exists. Retrying the batch is then impossible without re-uploading. Database writes may correctly roll back while the source does not.

**Repair:** commit the lifecycle transition and audit atomically; perform file removal only after successful commit, with a captured storage identity and an observable/retryable cleanup policy. `transaction.on_commit` is a useful primitive, but a callback failure must not be mistaken for a rolled-back import. Account for orphan uploads when file persistence succeeds but batch creation rolls back.

**Acceptance:** fail the batch save, fail audit recording, roll back an enclosing transaction and fail the eventual storage delete. Database and file states remain recoverable and the user receives an accurate outcome. Do not log source-file contents.

Reference: [Django transaction callbacks](https://docs.djangoproject.com/en/5.2/topics/db/transactions/#performing-actions-after-commit).

### KG-A08 — Expiry is a second, weaker import lifecycle implementation

**Evidence:** `backend/data_imports/management/commands/expire_stale_import_batches.py:29–53`; compare `_lock_uncommitted` and commit/cancel services.

The command selects pending batches, deletes their files, changes status and writes audit events without the shared row lock, an encompassing transaction or a status recheck after locking. A batch can be selected as pending and then committed concurrently before the stale command object is saved as expired. File deletion can also race source reading. A failure can separate expiry from its audit record.

**Repair:** make expiry a lifecycle service following the same lock/recheck/transaction policy as commit/cancel. The command should only select candidates and invoke it. Use bounded iteration and the post-commit storage policy from KG-A07. Reject nonsensical negative retention intervals.

**Acceptance:** race expiry against commit and cancel; precisely one terminal transition wins. Already committed batches remain committed. Each committed transition has the matching audit event. Test retries and partial command failure.

### KG-A09 — Import preview declares invalid rows “Ready”

**Evidence:** `backend/data_imports/services.py:318–395,427–489`; `backend/students/models.py:29–31,62–64`.

Preview manually implements a subset of student validation. It checks presence, dates, rank and duplicates, but not the model's 32-character WKSA ID or 150-character name limits. Commit uses the normal student service/model validation.

The actual classifier, with fake rank/existing-student lookups, returned **READY with no issues** for a 33-character WKSA ID and 151-character first name. Commit will reject that data. This undermines the review workflow and can roll back the accepted portion of the batch.

**Repair:** factor reusable, side-effect-free student input validation into one canonical path, including field constraints. Preview should classify with those rules; commit should revalidate authoritatively for races. Do not make preview create temporary database students or bypass per-student validation/audit to make commit faster.

**Acceptance:** table-driven parity tests for length boundaries, blank/whitespace values, date/rank/status rules, duplicate IDs, within-file duplicates and corrections. A row labelled ready must be committable unless intervening state changed; that race must have an understandable error.

### KG-A10 — File size does not adequately bound spreadsheet processing

**Evidence:** `backend/data_imports/services.py:98–119`; `backend/data_imports/parsers.py:29–62`; `backend/data_imports/ksw_adapter.py:285–329`.

- `upload.read()` reads the complete upload before enforcing the application byte limit.
- The generic parser loads the entire dataset before checking 5,000 rows and 50 columns.
- The legacy adapter opens read-only but converts worksheet rows to a full list; it has no equivalent application-level row, column or sheet budget and does not explicitly close the workbook.
- Compressed XLSX size is not a reliable bound on expanded worksheet work. Unknown-sheet scanning also needs a budget.
- The upload comment promises structural validation before persistence, but that immediate check is only performed for student rosters; legacy structure is parsed later.

**Consequence:** an accidental oversized/hostile workbook can consume disproportionate memory or request time. This is an administrator-only import path, which reduces exposure but does not remove availability risk. No memory exhaustion attack was executed.

**Repair:** reject known oversized uploads before reading and cap the actual read; enforce streaming row/column/sheet/work budgets while parsing; ensure workbook closure; use bounded XLSX archive checks appropriate to the selected parser. Define explicit handling of empty/unsupported legacy workbooks and preserve meaningful warnings. Keep format decoding separate from business interpretation.

**Acceptance:** boundary-sized CSV/XLSX, sparse dimensions, excessive sheets/columns/rows, malformed archives, inflated compressed content and unsupported-sheet-only workbooks. Measure peak memory/time on representative fixtures. Rejection must not persist an unusable batch or leave private source files indefinitely.

### KG-A11 — Bulk operations do not always preserve row independence

**Evidence:** `backend/gradings/services.py:128–148,1456–1538`; `backend/gradings/serializers.py:229–241`.

`_each_independently` says a row's failure, including `IntegrityError`, will not block other rows. It catches only Django `ValidationError`. Some domain services translate expected uniqueness failures; candidate registration's single-request translation is in the serializer instead. Bulk registration calls the service directly.

An isolated execution with an `IntegrityError` on row two processed rows one and two, propagated the exception and never attempted row three. In the actual bulk transaction an escaping database error can roll back earlier successful rows and produce a server error, contradicting the independent-row contract.

**Repair:** translate expected, identified constraint races at the canonical service boundary so all callers receive the same domain result. Keep savepoint handling correct. Do not blanket-swallow every `IntegrityError`, which would conceal unrelated integrity defects.

**Acceptance:** force a duplicate registration between prevalidation and insert while other rows remain valid. The conflicting row is reported, later rows run, successful rows commit and each audit record matches its row. Compare single, bulk and admin/service invocation behaviour.

### KG-A12 — Fresh audit snapshots do not prevent stale full-object saves

**Evidence:** `backend/students/services.py:71–115`; `backend/accounts/services.py:71–136`; `backend/gradings/services.py` (`apply_candidate_update`, around line 1558).

These update paths can read a fresh instance for the “before” audit snapshot but continue mutating and saving the original instance supplied by the caller. A normal `save()` writes its other loaded fields as well. Two concurrent edits to unrelated fields can overwrite each other, and an audit event may then describe an unintended reversion. A fresh read without a lock is not optimistic concurrency control.

The “no-op PATCH writes nothing” comment is also inaccurate in the student service: the save occurs before the equality comparison, so a no-op still writes and changes its update timestamp.

**Repair:** acquire a fresh authoritative object under the chosen concurrency policy and apply only explicitly requested changes, or implement a deliberate version/conditional-update protocol. Preserve Django admin's changed-field handling. Check for no-op before saving if that is the promised behaviour. Review role/authority changes together for concurrent role changes versus grants.

**Acceptance:** concurrent first-name/status and first-name/last-name edits preserve both changes or report a clear conflict. Model invariants and audit before/after values remain accurate. No-op tests assert database writes/timestamps, not only event counts.

### KG-A13 — Generated schema faithfully describes an unwanted route

**Evidence:** `backend/gradings/views.py:449–517`; `backend/schema.yml:1486–1526`; generated frontend schema.

`CandidateOutcomeViewSet` inherits the update mixin and allows PATCH, but its detail `partial_update` always raises `MethodNotAllowed`. The committed OpenAPI schema nevertheless advertises `PATCH /api/gradings/outcomes/{id}/` with a 200 response. Schema drift CI passes because it reproduces the same misleading route.

**Repair:** remove the unused detail-update surface while retaining explicit proposal/finalisation actions, or explicitly exclude the unsupported operation from the schema if routing constraints require a compatibility 405. Prefer the smallest truthful route definition. Regenerate schema and TypeScript together.

**Acceptance:** the schema and router agree on supported methods; no generated successful operation exists for a permanently rejected method. Preserve proposal/finalisation permissions and their error envelopes. Check OPTIONS/Allow behaviour, not only an authenticated happy-path request.

### KG-A14 — “All writes use the same audited service” is not true

**Evidence:** `backend/students/admin.py`; `backend/accounts/admin.py`; `backend/gradings/admin.py:123–133,393–452`; `backend/gradings/serializers.py` (`GradingSessionSerializer.update`); `backend/gradings/services.py:1895–1951`; `backend/accounts/serializers.py:289–338`.

Verified discrepancies:

- Candidate admin deletion inherits `_perform_delete -> obj.delete()`, not the audited candidate-deletion service.
- Student and user admin do not override their deletion hooks to call the corresponding cleanup/audit services. Deletion can consequently be blocked differently by protected history, or delete an unreferenced row without the domain deletion event.
- User admin's group/individual-permission edits use Django's standard many-to-many save path rather than `set_user_authority`. These changes are not represented by the domain service's normal authority audit path. `is_staff`/`is_superuser` changes likewise are not included in its ordinary profile snapshot.
- Session metadata changes such as title/location/notes follow direct serializer/admin saves rather than an equivalent audited metadata-update service.
- An assessment notes-only service update sets no `recorded_action`, so it saves without an assessment update event.
- Password serializers save the new password and then record an event without wrapping those two operations in their own shared transaction. An audit failure can follow a successful credential change.

Django admin has its own log mechanism; that does **not** make these paths equivalent to KukGrade's domain audit trail. A trusted superuser also has broad deliberate power; these findings are not a claim of an external privilege-escalation exploit.

**Repair:** enumerate supported write entry points and route each through the appropriate canonical service, or explicitly document a restricted break-glass exception with a separate audit policy. Avoid creating an all-purpose “universal service” framework. Add a session metadata update service and a meaningful notes-change event only where the product requires them. Make password change plus its domain audit atomic.

**Acceptance:** identical permitted API/admin actions produce equivalent domain state and events, including deletes, authority edits, password changes and metadata/notes changes. Fault-inject recording failure and assert intended rollback. Secret/password values must never enter event metadata.

### KG-A15 — Completion metrics are neither semantically nor numerically reliable

**Evidence:** `frontend/src/GradingSessionsScreen.tsx:115–141,281–302`; `backend/kukgrade/pagination.py:17–22`.

The current-session card labels a count “Assessments complete” but includes both `COMPLETED` and `IN_PROGRESS`. It also derives this and the awaiting-decision count from `results` of a default paginated response. The backend defaults to 50 rows. A cohort above 50 can therefore show partial counts against a full candidate total.

**Repair:** define the metric once on the backend and use a correctly bounded aggregate/projection. At minimum, use status-filtered counts for real completion rather than counting a first page. Do not “fix” this by setting an arbitrarily huge page size or relabelling incomplete assessments as complete.

**Acceptance:** 0, 1, 50, 51 and 120 assessments across statuses; all labels/counts agree with backend state. Include withdrawn candidates and define whether the denominator excludes them. Verify awaiting-decision semantics against the session/outcome lifecycle.

### KG-A16 — Read failures can masquerade as successful grading data

**Evidence:** `frontend/src/OutcomeProposalDrawer.tsx:55–73`; `frontend/src/PromotionLedgerScreen.tsx:54–135`.

The proposal drawer does not handle the assessment-items query's error state. Missing results become an empty list and the percentage defaults to 100 when no required rows are found. The promotion ledger similarly ignores prerequisite query errors. If promotion loading fails, an empty map can make already-promoted finalised passes appear eligible.

Backend guards still constrain the writes; they do not make a misleading decision screen acceptable.

**Repair:** distinguish loading, authorised empty, failed and available states. Block actions whose evidence failed to load and offer retry. Prefer the canonical assessment summary instead of reimplementing required/met rollups in the drawer, while still loading item detail where needed for review.

**Acceptance:** independently fail/delay each prerequisite request. No fake 100% result, empty-history inference or enabled decision/promotion action is presented. Existing successfully loaded data may remain visible only with an explicit stale/error state and a deliberate action policy.

### KG-A17 — Proposal submission loses partial-success state

**Evidence:** `frontend/src/OutcomeProposalDrawer.tsx:77–123,146–155`.

For a candidate without an outcome, submission first creates an outcome and then proposes it. If creation succeeds but proposal fails, the created ID is retained only in a local variable. The parent is notified only after both steps succeed. A retry can attempt creation again and hit “already has an outcome”, instead of resuming the proposal.

Also, `useDialogFocus` receives `canClose: !isSubmitting`, but direct overlay/close-button handlers still call `onClose`; the in-flight dismissal policy is not consistently enforced.

**Repair:** make the existing two-step workflow recoverable: immediately retain/cache the created outcome, reconcile uncertain network outcomes and resume using its identity. Do not add another overlapping endpoint merely to hide client state loss. If an atomic combined domain action is genuinely desired, decide that explicitly. Gate every dismissal path while the write is pending, or safely support dismissal with durable operation feedback.

**Acceptance:** creation succeeds/proposal fails; creation succeeds/response is lost; retry after reconnection; double submit; Escape, backdrop and close-button during submission. Exactly one outcome exists and the UI can recover without manual page reload or duplicate creation attempts.

### KG-A18 — Scoring mutations and invalidation are not one coherent policy

**Evidence:** `frontend/src/CandidateAssessmentScreen.tsx:140–202`; `frontend/src/candidateAssessmentData.ts:210–238`.

The optimistic item mutation snapshots the entire item list. If overlapping mutations occur, an older failure can restore that whole snapshot and temporarily erase another mutation's successful optimistic display. Same-item writes also have no explicit per-item sequencing policy. The mutation response is not used to reconcile the returned item; instead items, summary and assessment are invalidated after every settlement.

Assessment deletion invalidates only a session-shaped assessment key and candidate keys, despite also removing outcomes/promotions and potentially reverting a student's rank. It does not remove the cached by-candidate assessment, its items/summary or the notes draft. Refetch-on-remount may eventually repair parts of this, but it is not a complete invalidation contract.

The notes hook initialises local state once from a candidate-keyed cache. Its key does not include assessment identity or user identity; it is retained indefinitely until explicitly cleared. Candidate route changes without remount, deletion/recreation and identity switches need explicit handling.

**Repair:** establish a small shared key factory and mutation-specific invalidation/reconciliation helpers. Queue or otherwise reconcile writes per item; roll back only the affected change when safe, not an unrelated whole-list state. Track all pending writes before permitting completion/navigation. Scope/reset drafts to the intended user and assessment. Handle destructive changes' full dependency set.

**Acceptance:** two different items save with one failure; two rapid conflicting edits on the same item complete out of order; navigate while saves are pending; delete an assessment that has a promotion; regenerate for the same candidate; switch candidate/account. UI and server converge without resurrected drafts, stale rank or false completion. These browser interleavings were not executed during this audit.

### KG-A19 — Audit presentation invents status from substring matches

**Evidence:** `frontend/src/OverviewScreen.tsx:138–190`.

`formatAuditEvent` prioritises words such as `pass`, `complete` and `promot` in the prose summary and labels a match “Approved”. An isolated execution of those actual statements returned “Approved” for:

```text
Password reset for Example User.
Outcome proposed as PASS.
Outcome finalised as FAIL, overriding proposed PASS.
```

The first is not a grading approval, the second is not final and the third is a failure. The third string was a synthetic input illustrating the algorithm, not a claim that a real audit record with exactly that sentence was observed.

**Repair:** map the action enum and structured outcome metadata to display semantics. Unknown actions should retain the server's action label, not infer approval from free text. Keep actor and target identity conceptually separate.

**Acceptance:** password reset, proposed pass, finalised fail overriding pass, conditional outcome, withdrawal, promotion and unknown action fixtures receive accurate labels. Free-text notes containing “pass” must not change status.

### KG-A20 — Session and roster screens perform avoidable network work

**Evidence:** `frontend/src/GradingSessionsScreen.tsx:253–367`; `frontend/src/OverviewScreen.tsx`; `frontend/src/BuildGradingCohortScreen.tsx`; all-page helpers in `frontend/src/api.ts`.

The session screen loads all sessions to derive years/current session, then requests a separately paginated session list. For N visible sessions it issues N candidate-list requests and N assessment-list requests to obtain counts, in addition to spotlight requests. These are list payloads, not count-only reads. Other workflows collect entire rosters/history before filtering or computing dashboard figures.

All-page helpers solve truncation correctness for genuinely bounded workflows, but using them everywhere transfers scale problems into the browser. Parallel requests reduce wall-clock waiting; they do not remove database/network work.

**Repair:** add justified aggregate fields to an existing session read projection, with documented semantics, and obtain distinct years/current-session selection without downloading all history. Use server-side student search/pagination for cohort selection once the actual expected roster warrants it. Preserve deliberate “select all matching” semantics through IDs/server criteria rather than silently selecting only one page. Do not create several near-identical dashboard endpoints.

**Acceptance:** record request count, payload size, backend query count and render behaviour at representative cohort/history sizes. For the session list, request count for counts should not grow by two per visible session. This audit establishes the growth pattern, not measured production latency.

### KG-A21 — Backend read paths do unnecessary work

**Evidence:** `backend/gradings/services.py:1102–1160,1193` onward; `backend/gradings/serializers.py:454–473`; `backend/gradings/views.py:327–343`; `backend/data_imports/services.py:302–395`; `backend/accounts/views.py:148–157` and user capability serialization.

Concrete opportunities:

1. Unified grading history does not eager-load reverse `promotion` before accessing it for each outcome: an N+1 pattern.
2. Assessment lists prefetch full item objects and traverse them repeatedly to compute counts, even for callers that need only session/card counts. Use database annotations or a lighter projection when that is the actual payload.
3. The assessment summary orders a related-item queryset after the view has already prefetched the default item relation, creating an avoidable second retrieval rather than reusing a consistent ordering/projection.
4. Student import classification performs rank resolution and existing-student lookup per row, then repeats classification at commit. At 5,000 populated rows that is thousands of avoidable lookup queries before creation/audit work. Preload the relevant rank/ID sets; still revalidate race-sensitive writes.
5. User listing computes capabilities per user without a dedicated bulk permission read strategy. Profile this path; simply adding a prefetch is not sufficient unless the permission computation actually consumes it.

**Repair:** use query-count tests first, then targeted eager loading, annotations and lookup maps. Keep one implementation of shared summary semantics. Do not bypass validation/audit with indiscriminate `bulk_create`, remove constraints, or add Redis to conceal inefficient queries.

**Acceptance:** query-count growth tests for 1/10/100 history entries and assessments; preview fixtures at 100/1,000/5,000 rows; identical response content and row classifications. Capture before/after measurements rather than asserting an unmeasured speedup.

### KG-A22 — Documentation promises more than the code proves

**Evidence:** `docs/current-system.md`, `docs/architecture.md`, `docs/api_contract.md`; compare the findings above and `backend/kukgrade/urls.py`, `backend/health/views.py`.

| Claim or implication | What the audited code supports |
| --- | --- |
| Backend enforces all access restrictions | Most role/authority checks do; forced password change does not |
| Admin writes use the same audited services | Several create/update paths do; deletion, authority and other exceptions remain |
| Consistent row-lock syntax means consistent locking | `of=('self',)` is consistently used but does not coordinate all related operations |
| Immutable assessment snapshots/completed assessments are model/shell-wide guarantees | Serializer/admin/service restrictions exist; assessment/item `clean()` does not enforce all snapshot/parent immutability, and arbitrary ORM writes are not universally prevented |
| Bulk rows are independent, including database errors | The shared helper catches only `ValidationError` |
| Every API error has one envelope | DRF exceptions are centralised; unknown `/api/...` URLs use default Django 404 handling, and readiness deliberately returns a separate 503 payload |
| Schema declares every response | Success schemas are strong; the impossible outcome PATCH and missing explicit error responses remain |
| Workflow screens always collect complete datasets | The session spotlight computes status counts from the first assessment page |
| No-op student updates write nothing | Save happens before the no-op comparison |
| Every type in `api.ts` is generated | Most domain shapes are generated aliases; there are handwritten small payload/helper types, including promotion notes and import corrections |

**Repair:** update normative claims alongside fixes, with the exact enforcement layer stated. Explicitly separate DB constraints, supported-service invariants, UI affordances and trusted-maintainer bypasses. Readiness can legitimately have a distinct operational contract if documented. Add an API-specific unknown-route JSON handler if uniform errors are required. Describe error schemas and known exceptions rather than claiming universal coverage.

Do not edit old audit history to imply its conclusions were never made. Mark supersession and correct the current-system documentation. “The docs say it is done” is not acceptance evidence.

### KG-A23 — Bounded cleanup, not an indiscriminate shrinking exercise

**Evidence:** full tree inventory, call/reference searches, module sizes and manifest review.

No nontrivial exact duplicated backend function bodies were found by a simple AST-body comparison of functions of at least nine lines with docstrings excluded. A textual production-reference scan did not identify an exported `api.ts` function with zero references. These are useful negative checks, **not proof of no dead or semantically duplicated code**.

Worth addressing after the defects:

- `gradings/services.py` is over 2,100 lines; its models/serializers and large frontend session/cohort screens combine several cohesive responsibilities. Split by domain/workflow boundaries without inventing a generic abstraction layer or changing imports/contracts unnecessarily.
- The very large backend grading test file and `App.test.tsx` make ownership/fixtures difficult. Split by feature and retain cross-feature integration tests; test volume is not itself bloat.
- `RankVisual` and other callers import `BeltSwatch` from `SyllabusScreen`. Move reusable presentation into a neutral component module; a shared visual should not depend on a full screen.
- Syllabus loading has a bespoke effect/loading/error approach where most screens use the shared query library. Standardise useful behaviour without converting every tiny local state into a query.
- Neither logo asset filename had a production reference in the inspected source. Treat them as removal candidates pending packaging/design-use confirmation, not as a meaningful performance fix by themselves.
- Import batch statuses `NEEDS_REVIEW`, `READY`, `PARTIAL` and `FAILED` are exposed but not assigned by the current lifecycle services. Clarify whether reserved, historical or unnecessary before removing enum/database compatibility.
- Separate historical design boards/audits from current instructions in the docs index. They are not automatically runtime bloat; retain useful decision provenance.

The build's main JS was **470.27 kB raw / 129.81 kB gzip** and main CSS **140.65 kB / 22.14 kB gzip**, with additional lazy chunks. These figures justify a bundle/CSS coverage baseline, not a claim that the app is catastrophically oversized. No browser coverage trace was collected, so this report does not declare particular CSS selectors dead.

**Acceptance:** each deletion has a reference/build/test check and a clear reason. File extraction preserves behaviour. Do not mix a mass rename/reformat with a locking or data-integrity fix.

### KG-A24 — CI is strong but not a complete release assurance system

**Evidence:** `.github/workflows/ci.yml`, `Dockerfile`, `compose.prod.yml`, `backend/docker/entrypoint.sh`, `docs/deployment.md`.

Current CI does not demonstrate a real production-image HTTP session/CSRF/static/API flow against a database, an upgrade from representative existing data, or a backup restoration rehearsal. Frontend tests predominantly use mocked API responses; they can agree with an inaccurate contract. npm auditing exists, but equivalent Python dependency/container vulnerability assurance is not present in the inspected workflow.

The deployment docs explicitly assign backup scheduling, encryption/off-host retention and restore testing to the operator, and import expiry is external/manual. Those are disclosed responsibilities, not hidden implemented features. No running schedule or restore evidence was available in this audit.

**Repair:** add proportionate smoke/contract tests and an explicit release checklist. Test migrations against a sanitised prior-schema fixture, not only an empty database. Verify restoration of both the database and private pending-import files. Add a maintained Python dependency security check and deliberate base-image/update policy. Pin third-party action/image revisions according to the project's reproducibility/security policy; do not freeze them indefinitely without an update process.

**Acceptance:** a clean-room release rehearsal records revision, migration path, HTTP smoke checks, restore result and rollback compatibility. No production database or personal data is used in CI. Security scan results are time-specific, not a permanent safety certificate.

## 4. API coherence and duplication assessment

The committed schema contains **61 paths and 81 advertised HTTP operations**. One advertised operation is the permanently rejected outcome-detail PATCH described in KG-A13. The full inventory appears in Appendix A.

Endpoint count alone is not a duplication metric. The following distinctions are reasonable and should be retained unless a concrete client/domain change makes one redundant:

| Apparently overlapping surfaces | Assessment |
| --- | --- |
| Assessment summary and outcome summary | Both use the assessment-summary implementation. Assessment summary is available before an outcome exists; outcome summary is a lifecycle-oriented read. This is not two independent grading algorithms. |
| Single and bulk registration/generation/start/promotion | Bulk orchestration reuses the domain operations. The failure contract needs repair, not removal of bulk workflows. |
| Student rank history and grading history | Rank history is promotion-ledger evidence; grading history combines native outcomes and labelled legacy records. Distinct meanings. |
| Legacy current-rank and testing-rank resolution | Different fields with a shared resolver. Do not conflate historical claimed rank with present student rank. |
| Self profile/password and administrator user management | Different authority and proof requirements. Keep the boundary explicit. |
| Health and readiness | Process liveness versus database readiness. Intentional operational separation. |
| Raw syllabus requirements and effective requirements | Useful different read models, but the meaning of effective content versus assessment applicability needs KG-A05. |
| Session/candidate PUT and PATCH | Same serializer/service family rather than separate business implementations; inconsistent with PATCH-only student/user resources but not inherently a defect. Remove unsupported clientless surfaces only after a consumer check. |

Actual duplication worth consolidating is **policy**, not every repeated line: syllabus applicability, import/domain validation, count/summary semantics, lifecycle expiry, audit entry-point handling and frontend query/mutation conventions.

A suitable strict pattern is:

1. URL/view: authenticate, authorise, select the intended operation.
2. Serializer: parse and describe transport input/output; no alternative hidden business rule.
3. Domain service: acquire ordered locks, reread, validate, mutate and record the event in one transaction.
4. Models/database: field and relationship invariants with clear guarantees; not a second competing workflow engine.
5. Read projections: query efficiently and expose canonical metrics/summary semantics.
6. Frontend: present those semantics, manage request state and local drafts, never invent grading approval from prose or infer success from missing data.

This is a pattern to make existing code consistent, not a proposal for six new framework layers.

## 5. Database and migration conclusions

### 5.1 Keep these protections

- PostgreSQL-only execution is an honest constraint. The composite foreign key migration and row-locking semantics make a casual SQLite fallback inappropriate.
- Unique candidate/session, assessment/outcome/promotion relationships prevent important duplicate records.
- The composite `(assessment_id, candidate_id)` foreign key is valuable: it prevents attaching an outcome to another candidate's assessment. Its supporting composite uniqueness is not redundant merely because a one-to-one relation also exists.
- Checks tying result state to assessor/timestamp, lifecycle states to timestamps and numbered range validity are useful defence in depth.
- Protected rank/user/history relationships, explicit administrator cleanup and actor snapshots are deliberate data-lifecycle choices.
- Seed and backfill migrations must remain reproducible; they should not import mutable future application services to reduce apparent duplication.

### 5.2 What those constraints do not guarantee

The database does not currently make “every required item is assessed before a completed assessment stays completed”, “no reopen after a session locks”, or “cleanup cannot overwrite a later promotion” atomic across the related rows. Those depend on the services' lock protocol. Existing checks can all pass while the cross-row business state is wrong.

| Model family | Main concern / conclusion |
| --- | --- |
| User, groups and permissions | Good permission primitive; enforce forced-change state and unify audited supported authority changes |
| Student | Stable string identifier/rank relations; repair filter, import validation and stale updates |
| Rank and syllabus catalogues | Read-only exposed catalogues are sensible; resolve cumulative applicability and preserve seed history |
| Session/candidate | Lifecycle model is understandable; registration/transition/withdrawal coordination needs work |
| Assessment/items | Snapshot design is appropriate; enforcement is service/API-level in places and cross-operation locks are incomplete |
| Outcome/promotion | Distinct proposal, decision and rank change are coherent; do not merge them into an ambiguous “save grade” endpoint |
| Legacy grading | Source-labelled, non-promoting historical records and reconciliation are appropriate; keep provenance separate from current rank |
| Import batch/source | Lifecycle and storage must be coordinated; database atomicity alone cannot cover file deletion |
| Audit event | Append-only domain interface and actor snapshots are valuable; entry-point coverage and transaction parity need repair |

There are **30 numbered migrations across seven app migration directories**. Their presence is not bloat. CI establishes clean-database migration compatibility and no detected model/migration drift at the audited SHA; it does not prove a safe upgrade/restore on the actual deployed database. No SQL execution plans or production index utilisation measurements were available. Do not add indexes indiscriminately: use query profiles and representative cardinalities first.

## 6. Hardcoding, dependency and repository hygiene decisions

| Item | Decision |
| --- | --- |
| WKSA seed rows, age-band enum values and frozen migration checks | Legitimate domain/versioned data. Do not replace historical literals with live imports. |
| Repeated age-band labels/options in frontend | Consolidation candidate: one presentation catalogue tied to generated values, with one backend rule for ages. |
| Belt colours/appearance and six core-area presentation categories | Presentation/domain constants are not intrinsically bad hardcoding. Keep them central and exhaustive; account for weapons and unknown categories. |
| `www.kukgrade.co.uk`, production network names and school-specific legacy adapter | Plausible intentional single-tenant deployment/integration choices. Parameterise only if portability is actually required; isolate rather than generalise the adapter speculatively. |
| Development/CI passwords and build-only secret in templates | Clearly scoped examples/build inputs, not evidence of leaked production credentials. No complete historical secret scan or live environment audit was performed. |
| Pagination, 5 MiB upload default, worker/thread limits | Reasonable policy/configuration values; validate limits and document capacity assumptions. Limits must be applied before expensive work. |
| npm and uv lockfiles | Keep. They support reproducibility; do not delete them as generated noise. |
| OpenAPI YAML and generated TypeScript | Keep the drift-checked relationship; fix misleading routes and error coverage at the source. Never hand-edit generated output as the fix. |
| `openpyxl` imported directly but supplied transitively by `tablib[xlsx]` | Declare direct runtime dependencies deliberately or document/test the coupling. This is packaging clarity, not evidence it currently fails. |
| Small handwritten payload/helper types | Prefer generated request shapes where available. Keep generic client errors/utility types if the schema cannot express them; do not pretend all are generated. |
| Design-register HTML/JSON, audit documents and extensive tests | Development evidence, not automatically shipped runtime code. Improve discoverability and remove proven residue, not useful history. |

The dependency set is reasonably restrained for the feature set. There is no evidence supporting a move to microservices, a second API framework, a new importer framework, an ORM replacement, a worker queue or a shared cache solely to solve the findings here. The single-worker deployment is deliberate, including its process-local throttle assumption; increasing workers later requires revisiting shared throttling and capacity, not silently multiplying it.

## 7. Required regression and assurance matrix

These are acceptance scenarios to add or strengthen, not claims they were run here.

| Area | Minimum regression set |
| --- | --- |
| Authentication | Direct API attempts before mandatory password change; reset during existing session; successful/failed logout; account switch with cached data and in-flight requests |
| Grading concurrency | Item edit vs completion; reopen vs lock; register vs lock; withdraw vs finalise; promote vs cancellation; cleanup vs later promotion |
| Atomicity/audit | Forced recording failure for supported writes; no domain event without its committed action and no action silently committed when audit is required |
| Imports | Preview/commit validation parity; unique-constraint races; file/database rollback; expiry/commit race; oversized/sparse/compressed workbook budgets; unknown sheets; corrections and retry |
| Syllabus | Approved exact/cumulative policy across bands/ranks; weapons; optional items; later unsupported ranks; historical snapshots unchanged |
| API contract | Router/schema method parity; error responses; anonymous/forbidden/405/unknown route; generated request types; partial bulk results |
| Frontend correctness | Failed prerequisite fetches, 51+ rows, partial-success retry, account/candidate changes, overlapping optimistic mutations, deletion invalidation, accurate action labels |
| Efficiency | Request/query counts at representative cardinalities; bounded memory; no O(N) request fan-out merely to render counts |
| Release | Production-image HTTP smoke, schema upgrade fixture, restore rehearsal including pending uploads, security checks, narrow log/PII review |

Use real PostgreSQL for locking/constraint tests. Mocked frontend tests remain useful, but add a small number of real backend/frontend contract flows for the highest-risk workflows. Do not seek a nominal “100% coverage” number as a substitute for these scenarios.

## 8. Sequenced remediation plan for Claude

The following is a plan, **not authorisation to execute changes now**.

| Step | Work | Recommended permission level | Recommended reasoning level | Exit condition |
| --- | --- | --- | --- | --- |
| 0 | Confirm working revision, read instructions, inspect worktree; reproduce findings against current code | Read-only | High | Each finding confirmed, superseded or explicitly unresolved with evidence |
| 1 | Enforce password-change restriction and identity-safe frontend state: KG-A01–02 | Workspace-write, only after owner authorises implementation | High | Direct-API and account-switch regressions pass |
| 2 | Design/implement one lock protocol, cleanup coordination and safe updates: KG-A03–04,11–12 | Workspace-write; disposable local test DB only | High / highest available for lock design | Deterministic PostgreSQL races pass; no hidden widening of privileged cleanup |
| 3 | Resolve syllabus policy with owner; fix age filtering and content display: KG-A05–06 | Read-only for decision; workspace-write after approval | High | Cross-layer syllabus tests and age-boundary tests pass; historical data unchanged |
| 4 | Repair import lifecycle, validation and resource handling: KG-A07–10 | Workspace-write; synthetic fixtures only | High | Failure injection, expiry race and size-boundary tests pass |
| 5 | Correct schema/audit parity and frontend recovery/state/metrics: KG-A13–19,22 | Workspace-write | High | Contract, admin/API parity and frontend failure-path tests pass |
| 6 | Optimise measured queries/requests; perform bounded extraction/deletion: KG-A20–21,23 | Workspace-write | Medium–high | Recorded before/after budgets; no behaviour regression |
| 7 | Release rehearsal and assurance: KG-A24 | Workspace-write for tests/docs; separate approval for staging/deployment | High | Full CI plus integration/upgrade/restore evidence |

Do not grant unrestricted production access for a code review or local fix. No deployment, live-data migration, secret extraction, branch protection change, force push or destructive repository cleanup is implied by this document. Separate focused changes from broad refactors so each can be reviewed and reverted.

### Paste-ready Claude instruction

> Treat this report as an independent audit of KukGrade commit `668159a9e5660c9c15612d444206b6fe755b4e86`, not as infallible truth and not as permission to modify anything. Start read-only. Read AGENTS.md and the current implementation, identify your exact revision and worktree state, and revalidate every finding you intend to address. Separate confirmed defects, source-derived concurrency risks, product decisions and optional cleanup. Do not accept documentation or green CI as proof of an untested invariant. Do not manufacture new findings to justify a rewrite.
>
> Return a concise validation table and a phased implementation proposal using the finding IDs. Ask the owner to decide exact-rank versus cumulative assessment content before changing snapshot generation. Preserve intentional administrator cleanup, historical snapshots, legacy provenance, audit history and role/authority separation. Recommend permission and reasoning levels per phase. Do not implement until explicitly authorised.
>
> If implementation is subsequently authorised, work in small reviewable changes, add failing regression tests first where practical, use real PostgreSQL for concurrency, and keep generated contracts in sync. Prove fixes at every affected entry point, including API, bulk actions, admin and commands. Record commands/results and unverified limits. Do not weaken tests, remove constraints, edit historical migrations or bypass audit to make CI pass. Do not add overlapping endpoints, generic abstraction frameworks, workers or caches without a demonstrated requirement. Finish with the full verification suite and a finding-by-finding disposition.

## 9. Final acceptance standard

The next review should be able to answer all of the following with evidence:

1. Which layer owns each business rule, and do every supported caller and the UI agree?
2. Can two different valid actions interleave and produce an invalid grading/rank state?
3. Can a failed operation leave file storage, database state, audit history or browser state claiming different outcomes?
4. Can a user see another user's cached data or bypass a mandatory account state through the API?
5. Does “Ready”, “Complete”, “Approved” or “Eligible” mean exactly what the system has actually established?
6. Are list/count/history costs bounded and measured rather than hidden behind all-page downloads or per-row queries?
7. Does the generated contract describe real supported operations, including failure behaviour?
8. Can the exact release be upgraded, backed up, restored and rolled back under documented conditions?

Until then, the accurate status is **a capable application needing focused hardening**, not “everything verified” and not “a bloated codebase that should be rebuilt”.

## Appendix A — Complete advertised API path inventory

The following is mechanically derived from the committed schema, not an assertion that every advertised method works. See KG-A13 for the known false PATCH. Authentication, authorisation and body semantics remain defined by the relevant view/serializer/service.

| Path | Advertised methods |
| --- | --- |
| `/api/audit-events/` | GET |
| `/api/audit-events/{id}/` | GET |
| `/api/auth/change-password/` | POST |
| `/api/auth/login/` | POST |
| `/api/auth/logout/` | POST |
| `/api/auth/me/` | GET, PATCH |
| `/api/data-imports/batches/` | GET, POST |
| `/api/data-imports/batches/{id}/` | GET |
| `/api/data-imports/batches/{id}/cancel/` | POST |
| `/api/data-imports/batches/{id}/commit/` | POST |
| `/api/data-imports/batches/{id}/preview/` | POST |
| `/api/gradings/assessment-items/` | GET |
| `/api/gradings/assessment-items/{id}/` | GET, PATCH |
| `/api/gradings/assessments/` | GET |
| `/api/gradings/assessments/{id}/` | GET, PATCH, DELETE |
| `/api/gradings/assessments/{id}/reopen/` | POST |
| `/api/gradings/assessments/{id}/summary/` | GET |
| `/api/gradings/assessments/bulk-start/` | POST |
| `/api/gradings/candidates/` | GET, POST |
| `/api/gradings/candidates/{id}/` | GET, PUT, PATCH, DELETE |
| `/api/gradings/candidates/{id}/create-outcome/` | POST |
| `/api/gradings/candidates/{id}/generate-assessment/` | POST |
| `/api/gradings/candidates/{id}/withdraw/` | POST |
| `/api/gradings/candidates/bulk-generate-assessments/` | POST |
| `/api/gradings/candidates/bulk-register/` | POST |
| `/api/gradings/candidates/bulk-update-status/` | POST |
| `/api/gradings/legacy-records/` | GET |
| `/api/gradings/legacy-records/{id}/` | GET |
| `/api/gradings/legacy-records/{id}/link-student/` | POST |
| `/api/gradings/legacy-records/{id}/resolve-current-rank/` | POST |
| `/api/gradings/legacy-records/{id}/resolve-testing-for-rank/` | POST |
| `/api/gradings/legacy-records/{id}/unlink-student/` | POST |
| `/api/gradings/legacy-records/{id}/void/` | POST |
| `/api/gradings/outcomes/` | GET |
| `/api/gradings/outcomes/{id}/` | GET, PATCH — PATCH always rejects; KG-A13 |
| `/api/gradings/outcomes/{id}/finalise/` | PATCH |
| `/api/gradings/outcomes/{id}/promote/` | POST |
| `/api/gradings/outcomes/{id}/propose/` | PATCH |
| `/api/gradings/outcomes/{id}/summary/` | GET |
| `/api/gradings/outcomes/bulk-promote/` | POST |
| `/api/gradings/promotions/` | GET |
| `/api/gradings/promotions/{id}/` | GET |
| `/api/gradings/sessions/` | GET, POST |
| `/api/gradings/sessions/{id}/` | GET, PUT, PATCH, DELETE |
| `/api/health/` | GET |
| `/api/ranks/` | GET |
| `/api/ranks/{id}/` | GET |
| `/api/ready/` | GET |
| `/api/students/` | GET, POST |
| `/api/students/{id}/` | GET, PATCH, DELETE |
| `/api/students/{id}/grading-history/` | GET |
| `/api/students/{id}/rank-history/` | GET |
| `/api/syllabus/items/` | GET |
| `/api/syllabus/items/{id}/` | GET |
| `/api/syllabus/requirements/` | GET |
| `/api/syllabus/requirements/{id}/` | GET |
| `/api/syllabus/requirements/effective/` | GET |
| `/api/users/` | GET, POST |
| `/api/users/{id}/` | GET, PATCH, DELETE |
| `/api/users/{id}/authority/` | PATCH |
| `/api/users/{id}/set-password/` | POST |

## Appendix B — Whole-tree accountability manifest

All paths below were inventoried at the pinned commit. Text retrieval/hash verification, source tracing, AST checks and test/contract/document inspection have different assurance levels; listing a path is not a claim of exhaustive dynamic verification. The sole binary exclusion is marked. Appendices are included so a follow-up reviewer can check that frontend, backend, database, tests, documentation and deployment files were not silently omitted.

### repository/operations

```text
.dockerignore
.env.example
.env.production.example
.github/workflows/ci.yml
.gitignore
AGENTS.md
Dockerfile
README.md
compose.prod.yml
compose.yaml
pyrightconfig.json
```

### backend/.python-version

```text
backend/.python-version
```

### backend/README.md

```text
backend/README.md
```

### backend/accounts

```text
backend/accounts/__init__.py
backend/accounts/admin.py
backend/accounts/apps.py
backend/accounts/groups.py
backend/accounts/migrations/0001_initial.py
backend/accounts/migrations/0002_remove_manager_role.py
backend/accounts/migrations/0003_remove_inert_final_decision_boolean.py
backend/accounts/migrations/0004_user_must_change_password.py
backend/accounts/migrations/0005_seed_deleted_user_placeholder.py
backend/accounts/migrations/__init__.py
backend/accounts/models.py
backend/accounts/permissions.py
backend/accounts/serializers.py
backend/accounts/services.py
backend/accounts/test_permission_matrix.py
backend/accounts/tests.py
backend/accounts/urls.py
backend/accounts/views.py
```

### backend/audit

```text
backend/audit/__init__.py
backend/audit/admin.py
backend/audit/apps.py
backend/audit/migrations/0001_initial.py
backend/audit/migrations/0002_alter_auditevent_action.py
backend/audit/migrations/0003_alter_auditevent_action.py
backend/audit/migrations/0004_alter_auditevent_action.py
backend/audit/migrations/0005_alter_auditevent_action.py
backend/audit/migrations/0006_actor_snapshot_and_new_actions.py
backend/audit/migrations/__init__.py
backend/audit/models.py
backend/audit/recording.py
backend/audit/serializers.py
backend/audit/testing.py
backend/audit/tests.py
backend/audit/urls.py
backend/audit/views.py
```

### backend/data_imports

```text
backend/data_imports/__init__.py
backend/data_imports/admin.py
backend/data_imports/apps.py
backend/data_imports/ksw_adapter.py
backend/data_imports/management/__init__.py
backend/data_imports/management/commands/__init__.py
backend/data_imports/management/commands/expire_stale_import_batches.py
backend/data_imports/mappings.py
backend/data_imports/migrations/0001_initial.py
backend/data_imports/migrations/__init__.py
backend/data_imports/models.py
backend/data_imports/parsers.py
backend/data_imports/serializers.py
backend/data_imports/services.py
backend/data_imports/storage.py
backend/data_imports/test_ksw_adapter.py
backend/data_imports/test_legacy_import.py
backend/data_imports/testing.py
backend/data_imports/tests.py
backend/data_imports/urls.py
backend/data_imports/views.py
```

### backend/docker

```text
backend/docker/entrypoint.sh
```

### backend/gradings

```text
backend/gradings/__init__.py
backend/gradings/admin.py
backend/gradings/apps.py
backend/gradings/legacy_services.py
backend/gradings/migrations/0001_initial.py
backend/gradings/migrations/0002_candidateassessment_candidateassessmentitem_and_more.py
backend/gradings/migrations/0003_candidateoutcome.py
backend/gradings/migrations/0004_promotion.py
backend/gradings/migrations/0005_locked_session_exit.py
backend/gradings/migrations/0006_database_integrity_constraints.py
backend/gradings/migrations/0007_alter_candidateoutcome_options.py
backend/gradings/migrations/0008_legacygradingrecord.py
backend/gradings/migrations/0009_candidate_from_rank_and_delete_any_permission.py
backend/gradings/migrations/__init__.py
backend/gradings/models.py
backend/gradings/serializers.py
backend/gradings/services.py
backend/gradings/test_concurrency.py
backend/gradings/test_legacy_grading.py
backend/gradings/test_legacy_reconciliation.py
backend/gradings/tests.py
backend/gradings/urls.py
backend/gradings/views.py
```

### backend/health

```text
backend/health/__init__.py
backend/health/apps.py
backend/health/tests.py
backend/health/urls.py
backend/health/views.py
```

### backend/kukgrade

```text
backend/kukgrade/__init__.py
backend/kukgrade/admin_mixins.py
backend/kukgrade/asgi.py
backend/kukgrade/container_health.py
backend/kukgrade/exceptions.py
backend/kukgrade/filtering.py
backend/kukgrade/pagination.py
backend/kukgrade/settings.py
backend/kukgrade/settings_test.py
backend/kukgrade/test_container_health.py
backend/kukgrade/test_errors.py
backend/kukgrade/test_frontend.py
backend/kukgrade/test_pagination.py
backend/kukgrade/test_schema.py
backend/kukgrade/testing.py
backend/kukgrade/tests.py
backend/kukgrade/urls.py
backend/kukgrade/views.py
backend/kukgrade/wsgi.py
```

### backend/manage.py

```text
backend/manage.py
```

### backend/pyproject.toml

```text
backend/pyproject.toml
```

### backend/ranks

```text
backend/ranks/__init__.py
backend/ranks/admin.py
backend/ranks/apps.py
backend/ranks/migrations/0001_initial.py
backend/ranks/migrations/0002_seed_rank_catalogue.py
backend/ranks/migrations/__init__.py
backend/ranks/models.py
backend/ranks/serializers.py
backend/ranks/tests.py
backend/ranks/urls.py
backend/ranks/views.py
```

### backend/schema.yml

```text
backend/schema.yml
```

### backend/students

```text
backend/students/__init__.py
backend/students/admin.py
backend/students/apps.py
backend/students/migrations/0001_initial.py
backend/students/migrations/0002_add_nullable_current_rank.py
backend/students/migrations/0003_populate_current_rank.py
backend/students/migrations/0004_require_current_rank.py
backend/students/migrations/0005_student_status.py
backend/students/migrations/__init__.py
backend/students/models.py
backend/students/serializers.py
backend/students/services.py
backend/students/test_delete.py
backend/students/test_grading_history.py
backend/students/tests.py
backend/students/urls.py
backend/students/views.py
```

### backend/syllabus

```text
backend/syllabus/__init__.py
backend/syllabus/admin.py
backend/syllabus/apps.py
backend/syllabus/migrations/0001_initial.py
backend/syllabus/migrations/0002_seed_wksa_2014_syllabus.py
backend/syllabus/migrations/__init__.py
backend/syllabus/models.py
backend/syllabus/serializers.py
backend/syllabus/services.py
backend/syllabus/tests.py
backend/syllabus/urls.py
backend/syllabus/views.py
```

### backend/uv.lock

```text
backend/uv.lock
```

### docs

```text
docs/README.md
docs/action_plan.md
docs/api_contract.md
docs/architecture.md
docs/assessment-grading-redesign-handoff.md
docs/audits/2026-09-13-independent-repository-audit.md
docs/audits/2026-09-15-post-completion-audit.md
docs/audits/2026-09-19-frontend-repository-hygiene-review.md
docs/audits/2026-09-24-coherence-audit.md
docs/current-system.md
docs/data-import-and-legacy-migration.md
docs/decision_log.md
docs/deployment.md
docs/development-workflow.md
docs/permissions.md
docs/product-requirements.md
```

### frontend/Frontend-Design-Register

```text
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/README.md
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/Main.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S1B-Focus-Runner.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S1C-Ledger-Sheet.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S2A-Exception-Report.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S2B-Certificate-Proof.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S2C-Inline-Seal-Strip.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S3A-One-Drawer-Two-Stages.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S3B-Decision-Ledger-Page.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/S3C-Cohort-Adjudication-Board.dc.html
frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/boards/canvas.json
frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md
```

### frontend configuration

```text
frontend/README.md
frontend/eslint.config.js
frontend/index.html
frontend/package-lock.json
frontend/package.json
frontend/tsconfig.json
frontend/vite.config.ts
```

### frontend/src

```text
frontend/src/AddStudentScreen.tsx
frontend/src/App.css
frontend/src/App.test.tsx
frontend/src/App.tsx
frontend/src/AssessmentCompletionScreen.tsx
frontend/src/AuditScreen.css
frontend/src/AuditScreen.test.tsx
frontend/src/AuditScreen.tsx
frontend/src/BuildGradingCohort.css
frontend/src/BuildGradingCohortScreen.tsx
frontend/src/CandidateAssessment.css
frontend/src/CandidateAssessmentScreen.tsx
frontend/src/CreateGradingSessionScreen.tsx
frontend/src/GradingAttendance.css
frontend/src/GradingAttendanceDialogs.test.tsx
frontend/src/GradingAttendanceDialogs.tsx
frontend/src/GradingSessionDetailScreen.test.tsx
frontend/src/GradingSessionDetailScreen.tsx
frontend/src/GradingSessions.css
frontend/src/GradingSessionsScreen.tsx
frontend/src/ImportLegacyGradingsScreen.test.tsx
frontend/src/ImportLegacyGradingsScreen.tsx
frontend/src/ImportStudents.css
frontend/src/ImportStudentsScreen.test.tsx
frontend/src/ImportStudentsScreen.tsx
frontend/src/LegacyReconciliation.css
frontend/src/LegacyReconciliationScreen.test.tsx
frontend/src/LegacyReconciliationScreen.tsx
frontend/src/MasterFinalDecisionDrawer.test.tsx
frontend/src/MasterFinalDecisionDrawer.tsx
frontend/src/MustChangePassword.tsx
frontend/src/NavIcons.tsx
frontend/src/OutcomeDrawers.css
frontend/src/OutcomeProposalDrawer.tsx
frontend/src/OverviewScreen.css
frontend/src/OverviewScreen.tsx
frontend/src/ProfileMenu.tsx
frontend/src/PromotionLedger.css
frontend/src/PromotionLedgerScreen.test.tsx
frontend/src/PromotionLedgerScreen.tsx
frontend/src/RankVisual.test.tsx
frontend/src/RankVisual.tsx
frontend/src/StudentDetailScreen.test.tsx
frontend/src/StudentDetailScreen.tsx
frontend/src/StudentScreens.css
frontend/src/StudentsScreen.tsx
frontend/src/Syllabus.css
frontend/src/SyllabusScreen.test.tsx
frontend/src/SyllabusScreen.tsx
frontend/src/ThemeIcons.tsx
frontend/src/UserDetailScreen.test.tsx
frontend/src/UserDetailScreen.tsx
frontend/src/UserManagement.css
frontend/src/UsersScreen.test.tsx
frontend/src/UsersScreen.tsx
frontend/src/api.test.ts
frontend/src/api.ts
frontend/src/api/schema.ts
frontend/src/assets/kukgrade-logo.jpg [binary content not inspected]
frontend/src/assets/kukgrade-logo.svg
frontend/src/auth.tsx
frontend/src/candidateAssessmentData.test.tsx
frontend/src/candidateAssessmentData.ts
frontend/src/dates.test.ts
frontend/src/dates.ts
frontend/src/main.tsx
frontend/src/syllabusCategories.ts
frontend/src/test-setup.ts
frontend/src/theme.css
frontend/src/useDialogFocus.test.tsx
frontend/src/useDialogFocus.ts
frontend/src/useTheme.ts
frontend/src/vite-env.d.ts
```

## Appendix C — External references used narrowly

Repository implementation and observed CI are the primary evidence. These official references were consulted only to verify framework semantics, not to infer that KukGrade itself behaves correctly:

- [Django 5.2 queryset API](https://docs.djangoproject.com/en/5.2/ref/models/querysets/): explicit lock targets and query/eager-loading behaviour.
- [Django 5.2 transactions](https://docs.djangoproject.com/en/5.2/topics/db/transactions/): post-commit callbacks and rollback boundaries.
- [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults): inactive queries remain cached and are normally collected after five minutes; this repo overrides draft retention to infinity.

No current vulnerability claim is based on memory or an unperformed scan. No legal-compliance certification, production penetration test, load test or live-data audit is implied.
