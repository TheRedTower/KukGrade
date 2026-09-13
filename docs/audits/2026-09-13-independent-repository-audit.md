# KukGrade — First-Contact Repository Audit & Engineering Roadmap

**Audit baseline:** `dev` @ `464670d` (working tree carries uncommitted docs changes)
**Date:** 2026-09-13 · **Auditor:** independent review, Claude Opus 5
**Scope:** whole repository (104 tracked files) + the unmerged `feature/promotion-rank-history` worktree
**Nothing in the application was modified.** Side effects of verification only: `backend/.venv`, `frontend/node_modules`, and a running `kukgrade-db-1` Postgres container.

---

## Context

KukGrade is an internal grading-management application for Kuk Sool Won instructors, managers, administrators and authorised Masters. It replaces spreadsheet-based grading with a system of record for students, ranks, syllabus requirements, grading sessions, candidate assessments, final grading decisions and rank history. Students never log in.

This audit was commissioned as a first-contact handover: establish what actually exists, whether it is correct, what is urgent, and the order in which to finish it. Two things discovered during reconnaissance materially shape the conclusions and were confirmed with you before writing:

1. **A prior audit already exists** in the working tree (`docs/audits/remediation-status.md`, 25 findings `H-01`…`L-05`, plus an untracked `docs/current-system.md` and ~254 lines of uncommitted doc reconciliation). I formed my findings from the code first, then reconciled — §Prior-audit reconciliation.
2. **~1,380 lines of finished Promotion / rank-history / students-API work is stranded** in a separate Codex worktree at `/Users/adi/.codex/worktrees/kukgrade-promotion-rank-history/KukGrade`, unmerged and unreviewed. It is not a sketch; it is green.

---

## 1. Executive verdict

| Question | Answer |
|---|---|
| Is the codebase healthy? | **Yes — unusually so for its stage.** Disciplined, consistent, well-tested, no dead weight. |
| Urgent problems? | **No P0. Nothing requires halting development.** Four P1s must clear before any deployment or serious frontend work. |
| Is the architecture sound? | **Yes.** Clean models → services → serializers → views layering with domain logic correctly centralised in services. Do not redesign it. |
| Are the domain foundations trustworthy? | **Yes, with one caveat.** Invariants are enforced at model *and* database level to an unusual degree. The caveat is that state-gated *deletion* is enforced only in the API layer. |
| Backend completeness | **~75% of the intended domain**, and what exists is production-grade. Gaps: promotion/rank history (written, unmerged), students API (written, unmerged), syllabus versioning, audit events, role-based permissions. |
| Frontend completeness | **~5%.** Login, logout, current-user bootstrap, and an empty shell reading "Welcome back." That is the entire application. No router, no data layer, no domain screen. |
| Integration | **Effectively zero.** No React screen touches any grading endpoint. No end-to-end workflow exists in the product. |
| **Single most important thing to do next** | **Review and merge the stranded promotion/students worktree.** It closes the largest domain gap, is already green (236 tests, ruff + mypy + migrations clean), and rots a little more with every commit to `dev`. |

**Development phase: late backend foundation, entering integration.** The backend is nearly feature-complete for the core grading loop; the frontend has not started. This is the most dangerous point in a project like this — it is very easy to assume the backend is "done" and discover during UI work that contracts, permissions and error shapes were never exercised by a real client.

---

## 2. Actual architecture

```text
React 19 + Vite  ──  frontend/src/{App,auth,api}.tsx        ~300 lines total
      │                hand-rolled router (pushState + synthetic popstate)
      │                fetch wrapper, session cookies, X-CSRFToken header
      ▼
  HTTP  /api/*        session auth + CSRF, CORS credentials allowed
      ▼
DRF ViewSets          gradings/views.py, ranks, syllabus, accounts, health
      ├─ permissions  IsAuthenticated everywhere + CanMakeFinalGradingDecision on ONE action
      ├─ filtering    hand-written query_params in get_queryset() (no django-filter)
      └─ serializers  thin; delegate to services; never mutate state themselves
      ▼
Domain services       gradings/services.py — 989 lines, the real core
      │                transitions · validation · snapshots · locking · @transaction.atomic
      ▼
Django models         full_clean() on every save(); clean() enforces invariants
      │                model-level guards reject direct status writes
      ▼
PostgreSQL 17         CheckConstraint + UniqueConstraint on nearly every invariant
```

Also present: Django admin, configured as a genuine operational surface (read-only for assessments/items/outcomes, routed through the same services for sessions and candidates). It is currently the **only** way to create a student.

**Architectural judgements**

- Business logic is correctly centralised in `services.py`. Serializers and views are thin. Admin calls the same services. This is the right shape and should be preserved.
- Django's ORM `Model.save()` is overridden to call `full_clean()` on every model — unconventional, but deliberate and consistent, and it is what makes `objects.create()` safe. Keep it.
- The `services.py` module is 989 lines and will not survive much more growth. Split it by aggregate (`services/session.py`, `services/assessment.py`, `services/outcome.py`, `services/promotion.py`) when it next needs a new workflow — not before.
- There is no `api/`, `web/`, or `worker/` directory, and none should be added. `backend/` `frontend/` `docs/` is the accepted boundary.

---

## 3. Domain model as implemented

```text
User (accounts, UUID pk, email login, role: instructor|manager|administrator)
 │    can_make_final_grading_decision : BooleanField  ← INERT, see KG-003
 │    real authority = Django perm "gradings.can_make_final_grading_decision"
 │
Rank (16 seeded, White→PKJN)  order:unique  category:{COLOURED_BELT,BLACK_BELT_CANDIDATE,BLACK_BELT}
 │    progression = strictly by `order`, never by pk. Verified: no hard-coded IDs anywhere.
 ▼
Student  wksa_id:unique · first/last_name · date_of_birth · current_rank→Rank[PROTECT] · is_active
 │        (no API on dev — admin only)
 ▼
GradingSession  DRAFT→OPEN→LOCKED→COMPLETED ; DRAFT|OPEN→CANCELLED    created_by→User[PROTECT]
 │  1─n
 ▼
GradingCandidate  REGISTERED|WITHDRAWN|COMPLETED
 │   unique(session, student)                       ← DB constraint, duplicate registration impossible
 │   age_band  ← SNAPSHOT derived from DOB + grading_date, never client-supplied
 │   testing_for_rank ← must equal next active rank after student.current_rank
 │
 ├─ 1─1 ─► CandidateAssessment  NOT_STARTED→IN_PROGRESS→COMPLETED   generated_by→User[PROTECT]
 │            │  CheckConstraint ties status to started_at/completed_at nullability
 │            │  1─n
 │            ▼
 │         CandidateAssessmentItem   result: NOT_ASSESSED|MET|NOT_MET
 │            SNAPSHOT ROW — copies item_code, item_name, korean_name, category,
 │            sequence, required, start/end_number, requirement_notes at generation time.
 │            source_requirement/source_item/source_rank are SET_NULL trace links only.
 │            ⇒ editing or deleting live syllabus data cannot alter history. VERIFIED by test.
 │
 └─ 1─1 ─► CandidateOutcome  DRAFT→PROPOSED→FINALISED
              proposed_outcome/by/at + final_outcome/decided_by/at : PASS|FAIL|CONDITIONAL
              CheckConstraint enforces the whole status⇄fields matrix at DB level
              FINALISED is immutable (model clean) and undeletable (model delete + PROTECT)

           ┌─ NOT ON dev — exists only in the unmerged worktree ─────────────┐
           │  Promotion  student · outcome[1-1] · grading_candidate[1-1]      │
           │             from_rank · to_rank · promoted_by · effective_date   │
           │             ⇒ IS the rank history. Immutable, undeletable.       │
           │             OneToOne on outcome AND candidate = DB-level          │
           │             guarantee that a promotion cannot happen twice.       │
           └────────────────────────────────────────────────────────────────┘
```

**Where invariants live.** Unusually well distributed — most are enforced in *all three* places (Python `clean()`, service validation, and a Postgres constraint). Notable examples verified in the schema: `unique_grading_candidate_session_student`, `candidate_outcome_status_fields_valid`, `candidate_assessment_timestamps_valid`, `unique_assessment_item_snapshot`, `rank_order_positive`, `syllabus_requirement_end_not_before_start`.

**The one structural exception:** deletion rules are enforced *only* in the API layer (KG-009).

---

## 4. Verification run — actual results

All commands run from the repository's own documented tooling.

### Backend — `dev` @ `464670d`

| Command | Result |
|---|---|
| `uv sync` | 23 packages, clean |
| `uv run pytest -q` | **222 passed, 0 failed, 0 skipped, 0 xfail, 0 warnings** in 20.5s |
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 68 files already formatted |
| `uv run mypy …` (strict) | Success: no issues in 67 source files |
| `manage.py check` | No issues (0 silenced) |
| `manage.py makemigrations --check --dry-run` | No changes detected — model state matches migrations |
| `manage.py check --deploy` (DEBUG=false) | **3 warnings: W004 no HSTS, W008 no SSL redirect, W009 weak SECRET_KEY** |

### Backend — `feature/promotion-rank-history` worktree

| Command | Result |
|---|---|
| `pytest -q` | **236 passed** (14 more than `dev`) in 24.0s |
| `ruff check` / `ruff format --check` | clean / 72 files formatted |
| `mypy` strict | Success: no issues in 71 source files |
| `makemigrations --check` | No changes detected |

### Frontend

| Command | Result |
|---|---|
| `npm ci` | ok — **9 advisories: 5 high, 3 moderate, 1 low** (prior audit recorded 1 low; this has drifted) |
| `npm run test` | 1 file, **5 tests passed** |
| `npm run lint` / `typecheck` / `build` | all clean; bundle 197.8 kB / 62.3 kB gzip |

**Migration-from-zero is proven.** `backend/gradings/tests.py:2644` and `backend/syllabus/tests.py:440` drive `MigrationExecutor` from zero and assert the resulting constraints and seeded rows exist. `backend/gradings/tests.py:2716` asserts tests actually ran on PostgreSQL. Dependency graph checked by hand: `students/0003` correctly depends transitively on `ranks/0002_seed_rank_catalogue`, so the `Rank.objects.get(code="WHITE")` data migration cannot race. No migration churn.

### What the green suite does **not** prove

- **Zero concurrency tests.** Every `select_for_update` claim is unverified. No test runs two transactions.
- **Zero role-based permission tests against real endpoints.** `accounts/tests.py:216-237` tests the permission *classes* in isolation — giving false confidence that RBAC exists. No view uses them (KG-001).
- **No frontend test touches any domain endpoint** — only the 5 auth tests exist.
- **No query-count / N+1 assertions**, no pagination tests (there is no pagination), no load or volume testing.
- **No contract test** binds TypeScript types to serializer output. `AuthUser` is the only shared type and it is hand-maintained.

---

## 5. Findings register

Severity: **P0** immediate · **P1** release blocker · **P2** important for professional quality · **P3** hardening · **P4** optional.

| ID | Sev | Area | Finding | Evidence | Impact / Recommendation |
|---|---|---|---|---|---|
| KG-001 | **P1** | AuthZ | Every grading write endpoint is `IsAuthenticated` only. Any instructor can create/delete sessions, register/withdraw candidates, generate assessments, record MET/NOT_MET as assessor, and propose outcomes. The four role permission classes exist, are exported and are unit-tested — and are wired to **zero** views. | `gradings/views.py:56,112,209,266,336`; `accounts/permissions.py:29-57`; usage grep returns only `accounts/tests.py` | No least privilege; directly contradicts `docs/permissions.md` and AGENTS.md. Worse, the passing tests imply RBAC exists. Wire the classes to views and add endpoint-level permission tests. |
| KG-002 | **P1** | Config | Production settings fail open. `DEBUG` defaults **True**; `SECRET_KEY` defaults to a literal committed to the repo; `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` derive from `not DEBUG`. A deploy with a missing env file runs with debug tracebacks, a publicly-known signing key (session and CSRF forgery) and non-secure cookies. | `settings.py:23-28,149-150`; `check --deploy` → W004/W008/W009 | Make `DJANGO_SECRET_KEY` and `DJANGO_DEBUG=false` mandatory in non-dev; add HSTS, SSL redirect, `SECURE_PROXY_SSL_HEADER`. Fail loudly at startup. |
| KG-015 | **P1** | Contract | The frontend discards all field-level validation errors. `apiRequest` reads only `body.error.message` or `body.detail`; DRF validation errors are `{"field": ["msg"]}` — neither key present — so every 400 degrades to `"API request failed with status 400"`. | `frontend/src/api.ts:74-88` vs `serializers.raise_drf_validation_error` | The backend's careful per-field messages are unreachable by any UI. **Blocks every form in the application.** Fix before frontend work starts, not during. |
| KG-019 | **P1** | CI | No CI whatsoever. No `.github/`. The suite is green only because someone ran it locally. | `ls .github` → not found | Nothing prevents a red commit reaching `dev`. Add a workflow running the exact documented commands + `check --deploy`. |
| KG-008 | **P2** | Domain | **Locked sessions have no safe exit.** `ALLOWED_SESSION_TRANSITIONS[LOCKED] == {COMPLETED}`; withdrawal requires session DRAFT/OPEN; deletion requires DRAFT/OPEN; and LOCKED→COMPLETED requires every non-withdrawn candidate to hold a FINALISED outcome. A candidate who is injured, leaves mid-grading, or was registered in error blocks the session **permanently**. | `services.py:33-35, 299-311, 371-382, 185-208` | The only in-app escape is to mark their unassessed required items `NOT_MET` and finalise a `FAIL` — **fabricating results into a record the system then treats as immutable history**. **RESOLVED 2026-09-13:** authorised post-lock withdrawal (reason + actor, blocked once the outcome is FINALISED), plus `LOCKED→CANCELLED` for a genuinely abandoned grading. *My finding; not in the prior audit.* |
| KG-029 | **P2** | Audit | **Outcome revisions are silently discarded.** `propose_candidate_outcome` overwrites the previous proposal in place — blanking `proposed_outcome`, `proposed_by`, `proposed_at` and `proposal_notes` and writing the new values. Only one proposal exists at any moment, with no record it ever said anything else. If instructor A proposes PASS and instructor B changes it to FAIL, the Master who must adjudicate sees only "FAIL, proposed by B". | `services.py:472-508` | **RESOLVED 2026-09-13:** log it, don't gate it. No reason field, no approval step, no proposal-history model — revisions stay free until the Master finalises, and an append-only audit event records each one. *My finding; not in the prior audit.* |
| KG-009 | **P2** | Integrity | State-gated deletion is API-layer only. `validate_session_can_be_deleted` / `validate_candidate_can_be_deleted` are called solely from the two `destroy()` methods. `Model.delete()`, `QuerySet.delete()`, `manage.py shell` and **Django admin bulk delete** all bypass them — `GradingSessionAdmin` and `GradingCandidateAdmin` have no `has_delete_permission` override. | `views.py:100-107,157-164`; `gradings/admin.py:62,290` | Finalised outcomes happen to be backstopped by the `PROTECT` FK graph (proven at `tests.py:2345-2364`), but nothing protects a DRAFT/PROPOSED outcome or an in-progress assessment. Move the gates into `Model.delete()` and a custom `QuerySet.delete()`, and lock down admin deletion. |
| KG-004 | **P2** | API | **No pagination anywhere.** No `DEFAULT_PAGINATION_CLASS`. `/api/gradings/assessment-items/` unfiltered returns every snapshot row in the database (one candidate alone generates ~30–80). | `settings.py:125-137` | Adding pagination later is a **breaking response-shape change on every list endpoint** the frontend will consume. Add it now, before any UI depends on bare arrays. *My finding; not in the prior audit.* |
| KG-003 | **P2** | AuthZ | `User.can_make_final_grading_decision` is inert. Runtime authority is the Django permission; the boolean is never consulted — yet it is prominent in admin (`list_display`, `list_filter`, a fieldset literally labelled "KukGrade access"), returned by `/api/auth/me/`, and typed in the frontend. | `accounts/models.py:74`; `permissions.py:60-65`; `admin.py:74,93`; `serializers.py:23`; `frontend/src/api.ts:18`; proven inert by `accounts/tests.py:240-264` | An administrator ticking the box grants nothing; a superuser gets authority implicitly. Privilege *confusion*, not escalation. Remove the field, or make it the authority source — do not ship both. |
| KG-016 | **P2** | Frontend | The auth provider converts any failure into "anonymous". The `isAnonymousResponse(error)` branch and the fallback branch do **exactly the same thing**. | `frontend/src/auth.tsx:52-63` | A network blip, a 500, or a CORS error silently signs the user out mid-grading. Distinguish transport failure from 401/403 and surface a retryable error state. |
| KG-017 | **P2** | Contract | Three error envelopes coexist: `{"error":{code,message}}` for auth/permission; raw DRF `{"field":[...]}` for validation; and `{"detail": "..."}` returned with **400 for what is semantically 405** on outcome PATCH. | `kukgrade/exceptions.py:15-30`; `views.py:414-428` | No single contract for the client. Pick one envelope, apply it in the exception handler, document it, and test it. |
| KG-010 | **P2** | Integrity | `CandidateOutcome` ↔ `CandidateAssessment` candidate consistency is model-only; no DB constraint. A `QuerySet.update()` could attach an outcome to another candidate's assessment. | `gradings/models.py:490-497` | Add a DB-level guarantee (denormalised candidate_id + composite FK, or a trigger). |
| KG-018 | **P2** | API | Invalid list filters return `200 []` instead of `400`. `queryset.none()` on every unrecognised value, in ~14 places. | `gradings/views.py` passim | A frontend typo silently renders "no candidates" instead of an error. Decide the policy and apply it uniformly. |
| KG-020 | **P2** | Deps | 9 npm advisories after `npm ci` (5 high, 3 moderate, 1 low): vitest, @vitest/mocker, esbuild, postcss, browserslist, js-yaml, nanoid, brace-expansion, baseline-browser-mapping. | `npm audit` | **All in dev/build tooling; none in the shipped `react`/`react-dom` runtime**, so production exposure is low. But prior audit recorded "one low-severity" — it has drifted, which is exactly what CI is for. |
| KG-024 | **P2** | Gap | No students API on `dev`. Candidate registration needs a numeric student PK obtainable only from Django admin. | no `students/views.py` on `dev` | No end-to-end workflow can exist in React. *Resolved by the worktree.* |
| KG-027 | **P2** | Process | ~1,380 lines of Promotion / rank-history / students-API work stranded unmerged. Verified green: 236 tests, ruff, format, mypy, migrations all clean. | `/Users/adi/.codex/worktrees/kukgrade-promotion-rank-history/KukGrade` | Highest-value unclaimed asset in the project. Review and merge; it rots against `dev` daily. |
| KG-005 | P3 | Security | `BrowsableAPIRenderer` enabled in all environments — renders an HTML UI over the entire authenticated API including student names, WKSA IDs and grading notes. | `settings.py:132-135` | Restrict to DEBUG. |
| KG-006 | P3 | Security | No throttling on `/api/auth/login/`; unlimited password attempts. | `settings.py` REST_FRAMEWORK; `accounts/views.py:15-24` | Add `ScopedRateThrottle` on login. |
| KG-007 | P3 | Audit | No logging config and no audit trail. `transition_grading_session(..., actor)` and `create_candidate_outcome(..., actor)` **accept an actor and ignore it** — the audit hook is stubbed but unimplemented. | `services.py:235,447` | Not a defect today; a P1 before production. The parameters show where the smallest correct solution goes: an append-only `AuditEvent` written inside the existing service transactions. |
| KG-011 | P3 | Integrity | `CandidateAssessmentItem.assessor` unconstrained — nothing enforces "assessor set iff result ≠ NOT_ASSESSED". The service maintains it; nothing else does. | `services.py:976-985` | Add a CheckConstraint. |
| KG-012 | P3 | Dead code | `validate_outcome_assessment_state` checks `status != COMPLETED` (raises), then checks `== WITHDRAWN` — unreachable. | `services.py:406-413` | Delete the dead branch. |
| KG-013 | P3 | Correctness | `GradingSessionSerializer.validate` mutates `self.instance.grading_date` during validation, leaving the instance dirty if a later check fails. | `serializers.py:79-84` | Validate against a local, don't mutate. |
| KG-014 | P3 | Domain | No explicit `SyllabusVersion`. Snapshots copy display fields, which *does* protect historical meaning — but there is no way to answer "which published syllabus version was this graded against?" | `services.py:760-780`; AGENTS.md calls it confirmed | Provenance/reporting gap, not a correctness defect. See re-severity note below. |
| KG-021 | P3 | Concurrency | Inconsistent locking. `propose_`/`finalise_candidate_outcome` use `select_for_update(of=("self",))`; `generate_candidate_assessment`, `create_candidate_outcome`, `update_candidate_assessment*` and worktree `promote_candidate` use bare `select_for_update()` with `select_related`, which on Postgres **also locks the joined session, student and rank rows**. | `services.py:480,528` vs `789,450,881,967` | Unnecessary contention; deadlock surface grows with each new workflow. Standardise on `of=("self",)`. |
| KG-022 | P3 | Tests | Zero concurrency tests. Every locking guarantee is asserted by code reading only. | whole suite | Add `TransactionTestCase`-style double-transaction tests for promotion, outcome creation and session transition. |
| KG-025 | P3 | Domain | `Student.is_active` is binary; AGENTS.md requires active / inactive / **left**. | `students/models.py:23` | Confirmed requirement, unimplemented. |
| KG-026 | P3 | Audit | On `dev`, `Student.current_rank` can be changed freely with no history and no audit record. | `students/models.py` | The worktree adds a guard, but only *once a promotion already exists* — the first rank change is still unguarded. |
| KG-023 | P3 | Cleanliness | `CandidateAssessment` carries both `generated_at` and `created_at`, both `auto_now_add`. | `models.py:257,266` | Redundant field. |
| KG-028 | P3 | Worktree | `promote_candidate(effective_date=…)` is accepted but validation requires it to equal `session.grading_date`, so the parameter can only be redundant or wrong. The serializer already rejects client-supplied values. | worktree `services.py` `validate_promotion_eligibility` | Remove the parameter, or give it a real policy (e.g. certificate-dating). |

---

## 6. Fix before further feature development

> **No issue discovered requires stopping normal feature development.**

That is a deliberate finding, not a courtesy. There is no P0: nothing is deployed, no real student data exists, no invariant is currently being violated, and the suite is genuinely green. Manufacturing a blocker here would be wrong.

However, **four P1s must clear before two specific gates:**

- **Before any deployment:** KG-002 (fail-open settings) and KG-019 (no CI).
- **Before any serious frontend work:** KG-015 (validation errors unreachable) and KG-004 (no pagination). Both are cheap now and expensive later — they change the shape of every response and every form the UI will be built against. Building screens first means rebuilding them.

KG-001 (no RBAC) sits between the two: it is safe today because every user is trusted staff in a single-tenant deployment, and unsafe the moment a real instructor account exists.

---

## 7. What is already good — do not rewrite this

This section exists so future sessions do not "improve" work that is already correct.

1. **The assessment snapshot design is genuinely right.** `CandidateAssessmentItem` copies every display field at generation time and keeps `source_*` links as nullable `SET_NULL` traces. Editing, deactivating or deleting live syllabus data provably cannot alter a historical assessment — proven by `test_assessment_snapshot_survives_live_syllabus_edits` and `test_deleting_source_requirement_and_item_preserves_snapshot_display_data`. This is the hardest problem in the domain and it is solved.

2. **The `CandidateOutcome` status⇄fields CheckConstraint** (`models.py:418-452`) encodes the entire DRAFT/PROPOSED/FINALISED matrix — including `decided_at >= proposed_at` — in the database. A corrupt outcome row cannot exist even via raw SQL. Exemplary.

3. **The "use the service" guard pattern.** `GradingSession.clean()` rejects direct status writes; `CandidateOutcome.clean()` rejects status changes without `_allow_status_transition`. State transitions cannot be smuggled through an ordinary `save()`. Tests prove the spoofing attempts fail.

4. **Rank progression is ordinal, never positional.** `get_next_active_rank` filters on `order__gt` among `active=True`. No hard-coded IDs, no pk arithmetic, no string comparison anywhere in the codebase. Inactive ranks are skipped correctly and it is tested.

5. **Age band as a snapshot, not a computation.** `GradingCandidate.age_band` is derived once from DOB + grading date and stored; the grading date is then frozen once candidates exist. Leap-day birthdays are handled explicitly (`services.py:86-94`). Clients cannot supply it, and a test proves changing a student's DOB afterwards does not retroactively alter the candidate.

6. **Admin is a first-class, safe surface.** Assessments, items and outcomes are read-only with `has_add_permission`/`has_delete_permission` disabled; session and candidate saves route through the *same* services as the API, with transaction rollback tested. Most projects leave admin as an unguarded back door.

7. **The test suite is real, not decorative.** 222 tests that assert database constraint violations, drive migrations from zero, exercise admin form paths, verify rollback, and prove spoofing is rejected. Its weaknesses (§4) are gaps in *coverage*, not in *quality*.

8. **Tooling discipline.** `mypy --strict` passes across 67 files with `warn_unreachable`. Ruff clean. Zero TODO/FIXME/XXX/HACK, zero skipped tests, zero xfail, one justified `noqa` pair. This is rare.

---

## 8. Permission matrix (as enforced today)

| Operation | Anonymous | Any authenticated user | Requires `gradings.can_make_final_grading_decision` | Notes |
|---|---|---|---|---|
| `GET /api/health/` | ✅ | ✅ | — | AllowAny, liveness only |
| `POST /api/auth/login/` | ✅ | — | — | CSRF-protected, no throttle (KG-006) |
| `GET /api/auth/me/` | ❌ | ✅ | — | `ensure_csrf_cookie` bootstraps the CSRF token |
| `GET /api/ranks/`, `/api/syllabus/*` | ❌ | ✅ read-only | — | writes correctly 405 |
| `POST/PATCH/DELETE /api/gradings/sessions/` | ❌ | ✅ **all roles** | — | ⚠ KG-001 |
| `POST/PATCH/DELETE /api/gradings/candidates/` | ❌ | ✅ **all roles** | — | ⚠ KG-001 |
| `POST …/generate-assessment/` | ❌ | ✅ **all roles** | — | ⚠ KG-001 |
| `PATCH /api/gradings/assessment-items/{id}/` | ❌ | ✅ **all roles** | — | ⚠ any user is recorded as assessor |
| `POST …/create-outcome/` | ❌ | ✅ **all roles** | — | ⚠ KG-001 |
| `PATCH …/outcomes/{id}/propose/` | ❌ | ✅ **all roles** | — | ⚠ KG-001 |
| `PATCH …/outcomes/{id}/finalise/` | ❌ | ❌ | ✅ | **the one correctly-gated operation** |
| `POST …/outcomes/{id}/promote/` *(worktree)* | ❌ | ❌ | requires `gradings.can_promote_student` | correctly separated from final-decision authority |
| Django admin | ❌ | `is_staff` + model perms | — | bulk delete not gated (KG-009) |

**No object-level permissions exist, and none are currently needed** — the system is single-tenant with no branch/club scoping, so there is no IDOR surface in the classical sense. That changes the moment branches are introduced; design for it then, not now.

---

## 9. Security & GDPR assessment

### Security vulnerabilities
- None exploitable today. CSRF is correctly configured (`csrf_protect` on login with `authentication_classes = []`, `ensure_csrf_cookie` on `/auth/me/`, `CSRF_FAILURE_VIEW` returning JSON). Login errors are generic and do not reveal account existence (tested). Inactive users cannot authenticate (tested). Passwords use Django's hasher with all four validators. No raw SQL, no `mark_safe`, no `dangerouslySetInnerHTML`, no file upload surface.
- **KG-002** is the one real exposure, and only on deploy.

### Authorization weaknesses
- **KG-001** — the substantive one. **KG-003** — misleading capability display.

### Data-integrity risks
- **KG-009** (API-only deletion gates), **KG-010** (cross-candidate outcome attachment), **KG-011** (unconstrained assessor), **KG-008** (the fabricated-FAIL escape from a locked session — an *integrity* risk disguised as a UX problem).

### Privacy / GDPR engineering gaps
- **Data minimisation is good.** The only personal data on `Student` is `wksa_id`, names and `date_of_birth` — and DOB is genuinely load-bearing (it derives the age band). No address, phone, email, medical or payment fields. No student login. This is a defensible minimal set.
- **DOB is never exposed through any API.** Not on `dev`, and not in the worktree's students API (which returns only rank history). It is visible only in Django admin. Good.
- **The real gap is access breadth, not field breadth.** Any authenticated user can read `/api/gradings/assessment-items/` and retrieve every free-text `assessor_notes`, `proposal_notes` and `decision_notes` about every student — including minors — across every session, unpaginated and unscoped. That is KG-001 + KG-004 compounding into a privacy problem.
- **No erasure or anonymisation path.** `Student` uses `PROTECT` FKs throughout, so a student with grading history cannot be deleted. That is correct for auditability but means there is no answer to an erasure request. The architecture needs a deliberate anonymise-in-place design (scrub names, retain `wksa_id` and history) — not deletion.
- **No audit log** (KG-007), so "who viewed/changed this student's record" is unanswerable.
- **No retention policy** expressed anywhere in code or config.
- Dev/test data is synthetic throughout (`example.com` emails, fictional names). The repo contains no real student data. `.env` is gitignored, `.env.example` carries only placeholders. Clean.

### Later hardening
HSTS, SSL redirect, `SECURE_PROXY_SSL_HEADER`, login throttling, structured logging, dependency scanning in CI, backup/restore procedure (nothing in the repo addresses backups).

---

## 10. Auditability: can you defend a decision six months later?

| Question | Today |
|---|---|
| Who proposed this outcome, and when? | ✅ `proposed_by`, `proposed_at` |
| Who made the final decision, and when? | ✅ `decided_by`, `decided_at`, immutable |
| Who assessed each individual item? | ✅ `assessor`, `assessed_at` per item |
| Exactly which requirements were assessed? | ✅ snapshot rows, immune to syllabus edits |
| Which syllabus *version*? | ❌ KG-014 |
| Who promoted the student, from what rank to what? | ⚠ only in the unmerged worktree |
| Who created/cancelled the session? | ⚠ `created_by` only; transitions are unattributed (KG-007) |
| Who changed a student's rank outside a grading? | ❌ no record at all |
| Who *viewed* a record? | ❌ |

**Verdict: a grading decision is already defensible; everything around it is not.** The smallest correct fix is **not** event sourcing. It is one append-only `AuditEvent` model (actor, action, entity type, entity id, timestamp, JSON summary) written inside the service transactions that already exist — the `actor` parameters at `services.py:235,447` are the ready-made insertion points.

---

## 11. Claim verification matrix

Documentation claims checked against implementation.

| Claim (source) | Verdict | Evidence |
|---|---|---|
| "Historical gradings reference the exact immutable syllabus used" (README) | **PARTIALLY IMPLEMENTED** | Snapshot rows preserve *content* (verified); no `SyllabusVersion` entity exists |
| "Permissions enforced by the backend, not hidden in the frontend" (README) | **PARTIALLY IMPLEMENTED** | True for finalisation only; all other writes are `IsAuthenticated` (KG-001) |
| "Supported roles include authorised Master" (AGENTS.md) | **CONTRADICTED** | `User.Role` = instructor/manager/administrator; "Master" is a Django permission, not a role |
| Session transitions & terminal states (README) | **VERIFIED** | `services.py:24-38`; parametrised valid/invalid transition tests |
| "OPEN→LOCKED requires IN_PROGRESS or COMPLETED assessments" | **VERIFIED** | `services.py:155-184`; four dedicated tests |
| "Finalised outcomes are immutable" | **VERIFIED** | model `clean()` + `delete()` + DB CheckConstraint + `tests.py:2345` |
| "Candidate age_band is a snapshot; clients cannot set it" | **VERIFIED** | `serializers.py:120` read-only; spoofing test passes |
| "testing_for_rank must be the next active rank" | **VERIFIED** | `services.py:118-132`; skips inactive ranks, tested |
| "Duplicate candidate registration is impossible" | **VERIFIED (DB level)** | `unique_grading_candidate_session_student` |
| "Deletion is state-gated" (backend/README) | **IMPLEMENTED BUT NOT WIRED** | API-layer only; model/queryset/admin bypass (KG-009) |
| "Student API/UI is deferred" (README) | **VERIFIED on `dev`** | …but implemented in the unmerged worktree |
| "Promotion, current_rank updates, rank history remain deferred" (README) | **VERIFIED on `dev`** | …but fully implemented + tested in the worktree |
| "Audit events are a confirmed requirement, not implemented" (AGENTS.md) | **VERIFIED** | honest; `actor` params exist as stubs |
| "Student status must support active/inactive/left" (AGENTS.md) | **DOCUMENTED BUT NOT IMPLEMENTED** | binary `is_active` (KG-025) |
| "The boolean does not grant final-decision authority" (decision_log, uncommitted) | **VERIFIED** | `accounts/tests.py:240-264` proves it |
| "222 tests collected, 221 DB errors" (remediation-status Stage 0) | **OUTDATED** | Postgres now running: **222 passed** |
| "`npm ci` reported one low-severity issue" (remediation-status) | **OUTDATED** | now 9 advisories (5 high) |
| `docs/api_contract.md` endpoint tables | **MOSTLY VERIFIED** | already reconciled by the uncommitted Stage 1 doc work; implemented vs target is now labelled |

---

## 12. Feature completion matrix

| Feature | Backend | API | Permissions | Tests | Frontend | E2E | Prod ready |
|---|---|---|---|---|---|---|---|
| Authentication & session | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | PARTIAL *(KG-002, KG-006)* |
| Users & roles | PARTIAL | MISSING | PARTIAL | PARTIAL | MISSING | MISSING | MISSING |
| Students | PARTIAL *(no left status)* | MISSING *(worktree: PARTIAL)* | MISSING | PARTIAL | MISSING | MISSING | MISSING |
| Ranks | COMPLETE | COMPLETE *(read-only)* | PARTIAL | COMPLETE | MISSING | MISSING | PARTIAL |
| Syllabus catalogue | PARTIAL *(no version)* | COMPLETE *(read-only)* | PARTIAL | COMPLETE | MISSING | MISSING | PARTIAL |
| Grading sessions | COMPLETE | COMPLETE | MISSING | COMPLETE | MISSING | MISSING | PARTIAL |
| Candidates | COMPLETE | COMPLETE | MISSING | COMPLETE | MISSING | MISSING | PARTIAL |
| Assessments & snapshots | COMPLETE | COMPLETE | MISSING | COMPLETE | MISSING | MISSING | PARTIAL |
| Outcomes & final decision | COMPLETE | COMPLETE | COMPLETE | COMPLETE | MISSING | MISSING | PARTIAL |
| Promotions & rank history | MISSING *(worktree: COMPLETE)* | MISSING *(worktree: COMPLETE)* | MISSING *(worktree: COMPLETE)* | MISSING *(worktree: COMPLETE)* | MISSING | MISSING | MISSING |
| Audit events | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Syllabus versioning | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Reports / certificates | NOT REQUIRED YET | — | — | — | — | — | — |

---

## 13. Completion scorecard

| Area | State | Confidence | Notes |
|---|---|---|---|
| Students | **Correct but incomplete** | High | Model solid; no API on `dev`; missing `left` status |
| Ranks | **Production quality** | High | Ordinal progression, seeded, constrained, tested |
| Syllabus | **Correct but incomplete** | High | Catalogue excellent; versioning absent |
| Sessions | **Production quality, one design gap** | High | State machine correct; locked-session trap (KG-008) |
| Candidates | **Production quality** | High | DB-level duplicate protection, snapshot age band |
| Assessments | **Production quality** | High | Best-engineered part of the system |
| Outcomes | **Production quality** | High | Immutability enforced at three layers |
| Rank history | **Written, unmerged** | High | Green in the worktree; unreviewed |
| Permissions | **Fragile** | High | One correct gate; RBAC classes unwired (KG-001) |
| API surface | **Correct but incomplete** | High | Clean REST; no pagination, three error shapes |
| Frontend | **Prototype** | High | Auth only; ~5% of intended surface |
| Integration | **Not started** | High | No React screen calls any domain endpoint |
| Tests | **Strong, with named blind spots** | High | 222 real tests; no concurrency, no endpoint RBAC |
| Security | **Correct but incomplete** | High | Sound fundamentals; fail-open config |
| GDPR architecture | **Correct but incomplete** | Medium | Good minimisation; no erasure, retention or audit |
| DB integrity | **Production quality** | High | Constraint use is exemplary; deletion gates are the exception |
| Deployment | **Not started** | High | No CI, no prod image, no backup story |
| Documentation | **Good, mid-reconciliation** | High | Stage 1 doc work is solid but **uncommitted** |

**Overall maturity: late backend foundation / pre-integration.** Not derived by averaging — the backend genuinely deserves "near production quality" in its implemented areas, and the frontend genuinely deserves "prototype". The project's maturity is set by the weakest link that blocks delivery, which is integration.

---

## 14. Prior-audit reconciliation

The existing register (`docs/audits/remediation-status.md`) is **accurate and competent**. I independently reached the same conclusion on almost every item. Deltas:

| Prior | My verdict | Note |
|---|---|---|
| H-01, H-02 | **CONFIRM** → KG-009 | Correct; I'd add that the `PROTECT` FK graph backstops the *finalised* case, narrowing real exposure |
| H-03 | **CONFIRM** → KG-001 | Correct; I raise it to P1 and add that the passing isolated tests create false confidence |
| H-04 | **CONFIRM, RE-SEVERITY High→P3** → KG-014 | The snapshot already protects historical *meaning*. Version provenance is a reporting/compliance requirement, not a correctness defect. Do not sequence it ahead of permissions. |
| H-05 | **CONFIRM** → KG-007 | Correct; P3 now, P1 before production |
| H-06 | **CONFIRM, refined** → KG-021 | Correct, but the specific defect is *inconsistent* `of=("self",)` usage causing over-locking, not absent locking |
| M-01, M-03, M-04, M-07, M-08, M-09, M-10, M-11 | **CONFIRM** | M-08→KG-015 and M-09→KG-002 both raised to **P1** |
| M-02 | **CONFIRM** → KG-025/KG-026 | |
| M-05 | **CONFIRM, and Implemented** | Stage 1 doc work is genuine — but **still uncommitted**, so the "truth" is one `git checkout` from being lost |
| M-06 | **CONFIRM (blocked by decision)** | Correctly parked |
| M-12 | **CONFIRM** | Candidate PUT/same-value PATCH rejection after snapshot |
| L-01, L-02, L-03, L-05 | **CONFIRM** → KG-012, KG-018, KG-013 | |
| L-04 | **CONFIRM** | Health is liveness-only; add readiness when deploying |
| — | **MISSED: no pagination** → KG-004 | Breaking change if deferred past frontend work |
| — | **MISSED: locked-session trap** → KG-008 | The fabricated-FAIL escape corrupts immutable history |
| — | **MISSED: BrowsableAPI in prod** → KG-005 | |
| — | **MISSED: no login throttling** → KG-006 | |
| — | **OUTDATED: test/audit counts** | 222 pass (not 221 errors); 9 npm advisories (not 1) |

**Recommendation: keep one register.** Map my KG-nnn IDs into the existing `docs/audits/remediation-status.md` table rather than maintaining two.

---

## 15. Recommended sequence

The answer is **A + E, not A alone**: fix the small number of things that are cheap now and expensive later, harvest the work you already own, then integrate. Do **not** open new backend domain features.

### Phase 0 — Harvest and gate (≈1 week)
*Purpose:* stop losing work, and stop the repo from being able to go red.
Commit the Stage 1 doc reconciliation. Review and merge the promotion worktree. Add CI.
*Completion:* `dev` contains promotion + students API; CI runs the documented commands on every push; nothing uncommitted remains outside `.gitignore`.

### Phase 1 — Contract stabilisation (≈1–2 weeks)
*Purpose:* fix the response and error shapes **before** any UI is built against them.
Pagination; one error envelope; frontend error parsing; auth-provider failure handling.
*Depends on:* Phase 0. *Completion:* every list endpoint paginated; one documented error shape; the frontend can render a field-level validation error and survive a backend outage.

### Phase 2 — Permissions, integrity and audit (≈2.5 weeks)
*Purpose:* make the backend safe for more than one trusted operator, and make grading decisions reconstructable.
Wire permissions to Groups; drop the role classes and the inert boolean; move deletion gates into the model layer; add the locked-session escape; add the missing DB constraints; add concurrency tests; **build the minimal append-only `AuditEvent` and wire it to outcome proposals, final decisions, promotions and syllabus changes** (moved forward from Phase 4 — KG-029 makes it load-bearing).
*Depends on:* Phase 0. *Completion:* a permission matrix test per endpoint per role; deletion rules provable from `shell` and admin; a locked session can always be resolved without fabricating results.

### Phase 3 — Frontend integration (≈4–6 weeks, the long pole)
*Purpose:* turn a backend into a product.
Real router, server-state layer, generated or contract-tested types; then screens in workflow order: students → sessions → candidates → assessment entry → outcome proposal → finalisation → promotion.
*Depends on:* Phases 1 and 2. *Completion:* a real grading can be run end-to-end in the browser with no Django admin.

### Phase 4 — Provenance (≈1 week)
`SyllabusVersion`; student `left` status. (`AuditEvent` moved to Phase 2.)
*Depends on:* Phase 2 (needs settled permissions to record meaningful actors).

### Phase 5 — Production hardening (≈2 weeks)
Settings that fail closed; HSTS/SSL/proxy headers; throttling; structured logging; readiness probe; production image; backup and restore procedure; dependency scanning.

### Phase 6 — Release preparation
Seed/fixture tooling, operator documentation, a rehearsed restore, a pilot grading with synthetic data.

---

## 16. Immediate engineering backlog

Priority order. Each is sized to be a single reviewable slice.

**KG-NEXT-001 · Commit the documentation reconciliation · P1**
*Objective:* commit `docs/current-system.md`, `docs/audits/remediation-status.md` and the 11 modified doc files.
*Reason:* the only accurate description of the system exists solely in an uncommitted working tree. One `git checkout` destroys it.
*Files:* `docs/**`, `AGENTS.md`, `README.md`, `backend/README.md`.
*Depends on:* nothing. *DoD:* `git status` clean; `docs/current-system.md` tracked.
*Tests:* none required. 

**KG-NEXT-002 · Review and merge the promotion / rank-history / students-API worktree · P1**
*Objective:* land `feature/promotion-rank-history` into `dev`.
*Reason:* closes the largest domain gap (promotion, `Student.current_rank` updates, rank history, students API). Independently verified green: 236 tests, ruff, format, mypy, `makemigrations --check` all clean. Design is sound — `OneToOne` on both `outcome` and `grading_candidate` makes double promotion impossible at DB level; `select_for_update` on outcome/candidate/assessment/student; promotion authority correctly separated into `gradings.can_promote_student`; `effective_date` server-controlled; records immutable and undeletable; admin read-only.
*Files:* `backend/gradings/{models,services,serializers,views,urls,admin,tests}.py`, `backend/gradings/migrations/0004_promotion.py`, `backend/students/{views,serializers,urls}.py`, `backend/kukgrade/urls.py`.
*Depends on:* KG-NEXT-001. *DoD:* merged; full suite green on `dev`; KG-028 resolved (drop or justify the `effective_date` parameter); `docs/current-system.md` updated.
*Tests:* the 11 promotion tests already written, plus a concurrency test (see KG-NEXT-011).

**KG-NEXT-003 · Add CI · P1** *(KG-019)*
*Objective:* GitHub Actions running the exact documented commands on push/PR to `dev`.
*Reason:* green is currently an unverifiable local claim; the npm advisory drift from 1→9 proves the cost.
*Files:* new `.github/workflows/ci.yml`.
*Depends on:* nothing. *DoD:* backend job (Postgres service) runs `pytest`, `ruff check`, `ruff format --check`, `mypy`, `manage.py check`, `makemigrations --check`, `check --deploy`; frontend job runs `npm ci`, `test`, `lint`, `typecheck`, `build`, `npm audit --audit-level=high`; a deliberate red commit fails the build.

**KG-NEXT-004 · Make production settings fail closed · P1** *(KG-002)*
*Objective:* require `DJANGO_SECRET_KEY` when `DEBUG` is false; default `DEBUG` to **false**; add `SECURE_HSTS_SECONDS`, `SECURE_SSL_REDIRECT`, `SECURE_PROXY_SSL_HEADER`; restrict `BrowsableAPIRenderer` to DEBUG (KG-005).
*Reason:* a deploy with a missing env file currently runs with debug tracebacks, a repo-published signing key and non-secure cookies.
*Files:* `backend/kukgrade/settings.py`, `.env.example`, `README.md`.
*Depends on:* KG-NEXT-003. *DoD:* `check --deploy` emits zero warnings with a production env; startup raises `ImproperlyConfigured` with no secret key and `DEBUG=false`.
*Tests:* settings tests for both branches.

**KG-NEXT-005 · Add pagination to every list endpoint · P2** *(KG-004)*
*Objective:* set `DEFAULT_PAGINATION_CLASS` + `PAGE_SIZE`; document the envelope.
*Reason:* adding it after the UI exists is a breaking change to every list response. `/api/gradings/assessment-items/` currently returns every snapshot row in the database.
*Files:* `backend/kukgrade/settings.py`, `docs/api_contract.md`, all list tests.
*Depends on:* KG-NEXT-002 (so promotion endpoints are included). *DoD:* every list endpoint returns a paginated envelope; page size overridable per request within a cap.
*Tests:* pagination assertions on sessions, candidates, assessments, items, outcomes, promotions, ranks, syllabus.

**KG-NEXT-006 · Unify the error contract end to end · P1** *(KG-015, KG-017)*
*Objective:* one envelope from `custom_exception_handler` carrying `code`, `message` **and** `fields`; fix `CandidateOutcomeViewSet.partial_update` to return 405; teach `apiRequest` to parse field errors into a typed `ApiError.fields`.
*Reason:* the backend's careful per-field messages are currently unreachable by any UI — every 400 becomes "API request failed with status 400". This blocks every form.
*Files:* `backend/kukgrade/exceptions.py`, `backend/gradings/views.py:414-428`, `frontend/src/api.ts:74-88`, `docs/api_contract.md`.
*Depends on:* nothing. *DoD:* a DRF validation error round-trips to a typed `{field: [messages]}` object in the browser; one documented envelope for every error class.
*Tests:* backend tests per error class; frontend tests asserting field extraction.

**KG-NEXT-007 · Distinguish transport failure from anonymity in the frontend · P2** *(KG-016)*
*Objective:* add an `error` auth status; only 401/`authentication_required` maps to anonymous; offer retry.
*Reason:* a 500 or network blip currently signs the user out mid-grading.
*Files:* `frontend/src/auth.tsx:30-71`, `frontend/src/App.tsx`.
*Depends on:* KG-NEXT-006. *DoD:* backend down → an error state with retry, not the login screen.
*Tests:* Vitest cases for network rejection, 500, and 403 `authentication_required`.

**KG-NEXT-008 · Wire role-based permissions to every endpoint · P1** *(KG-001)*
*Objective:* apply `IsInstructorOrAbove` / `IsManagerOrAdministrator` / `IsAdministrator` per operation, per the confirmed policy (see Question Q1).
*Reason:* any authenticated user can currently create and delete grading sessions, register candidates and record assessment results.
*Files:* `backend/gradings/views.py`, `backend/students/views.py`, `backend/ranks/views.py`, `backend/syllabus/views.py`, `docs/permissions.md`.
*Depends on:* Q1 answered; KG-NEXT-002. *DoD:* every endpoint has an explicit, documented permission class; the matrix in §8 is regenerated and correct.
*Tests:* a matrix test asserting allow/deny for every role × every significant operation. **This is the single highest-value test addition in the project.**

**KG-NEXT-009 · Resolve the inert final-decision boolean · P2** *(KG-003)*
*Objective:* remove `User.can_make_final_grading_decision` (migration, admin, serializer, frontend type) — or make it the authority source. Not both.
*Reason:* an administrator ticking a box labelled "can make final grading decision" is granted nothing.
*Files:* `backend/accounts/{models,admin,serializers}.py` + migration, `frontend/src/api.ts:18`, `docs/decision_log.md`.
*Depends on:* Q2 answered. *DoD:* exactly one authority mechanism exists in code, admin, API and UI.
*Tests:* update `accounts/tests.py:240-264`.

**KG-NEXT-010 · Move deletion gates into the model layer · P2** *(KG-009)*
*Objective:* enforce `validate_session_can_be_deleted` / `validate_candidate_can_be_deleted` in `Model.delete()` and a custom `QuerySet.delete()`; add `has_delete_permission` guards to `GradingSessionAdmin` and `GradingCandidateAdmin`.
*Reason:* the documented rules are bypassed by `QuerySet.delete()`, `manage.py shell` and admin bulk delete.
*Files:* `backend/gradings/{models,admin}.py`.
*Depends on:* nothing. *DoD:* the rule holds from ORM, queryset, admin and shell.
*Tests:* deletion attempts via each of the four paths.

**KG-NEXT-011 · Add concurrency tests for the sensitive workflows · P2** *(KG-022)*
*Objective:* `TransactionTestCase` double-transaction tests for `promote_candidate`, `create_candidate_outcome`, `finalise_candidate_outcome`, `generate_candidate_assessment`, `transition_grading_session`.
*Reason:* every locking guarantee in the system is currently asserted only by reading the code.
*Files:* `backend/gradings/tests.py` (or a new `tests_concurrency.py`).
*Depends on:* KG-NEXT-002. *DoD:* two simultaneous promotions of one outcome produce exactly one `Promotion` and one rank change; duplicate POSTs and retries are proven idempotent or safely rejected.

**KG-NEXT-012 · Give locked sessions a safe exit · P2** *(KG-008)*
*Objective:* add `LOCKED → CANCELLED`, or an attributed post-lock candidate withdrawal requiring final-decision authority.
*Reason:* a candidate who leaves mid-grading currently blocks the session forever, and the only escape is to fabricate `NOT_MET` results and finalise a false `FAIL` into an immutable record.
*Files:* `backend/gradings/services.py:24-38,299-311`, `backend/gradings/tests.py`, `docs/current-system.md`.
*Depends on:* Q3 answered. *DoD:* every locked session is resolvable without fabricating assessment results.
*Tests:* the injured-candidate and registered-in-error scenarios.

**KG-NEXT-013 · Close the remaining DB-level integrity gaps · P2** *(KG-010, KG-011)*
*Objective:* guarantee outcome↔assessment candidate consistency in the database; constrain `assessor`/`assessed_at` to be set iff `result != NOT_ASSESSED`.
*Files:* `backend/gradings/models.py` + migration.
*Depends on:* nothing. *DoD:* both violations rejected by raw SQL.
*Tests:* direct `IntegrityError` assertions, matching the existing constraint-test style.

**KG-NEXT-014 · Standardise row locking on `of=("self",)` · P3** *(KG-021)*
*Objective:* make every `select_for_update` consistent, so joined session/student/rank rows are not locked incidentally.
*Files:* `backend/gradings/services.py:450,789,881,967` + worktree `promote_candidate`.
*Depends on:* KG-NEXT-011 (so the change is covered). *DoD:* all locking uses the same explicit form; concurrency tests still pass.

**KG-NEXT-015 · Add login throttling and structured logging · P3** *(KG-006, KG-007-partial)*
*Files:* `backend/kukgrade/settings.py`, `backend/accounts/views.py`.
*Depends on:* KG-NEXT-004. *DoD:* repeated failed logins are rate-limited; a `LOGGING` config exists that does not leak credentials or personal data.

**KG-NEXT-016 · Choose the frontend foundation · P2**
*Objective:* replace the hand-rolled router; add a server-state layer; establish how TypeScript types stay in sync with serializers.
*Reason:* `usePathname` + synthetic `popstate` (`App.tsx:7-27`) will be discarded the moment real routes appear. Deciding this *before* screens are written avoids rewriting them.
*Files:* `frontend/package.json`, `frontend/src/**`.
*Depends on:* Q4 answered; KG-NEXT-005, KG-NEXT-006. *DoD:* nested routes, a caching/invalidating data layer, and a documented type-sync mechanism.
*Tests:* routing and data-layer tests.

**KG-NEXT-017 · Build the students screen · P2**
*Objective:* first real domain screen — list, search, detail with rank history.
*Reason:* the smallest complete vertical slice; unblocks candidate registration without Django admin.
*Depends on:* KG-NEXT-002, KG-NEXT-016. *DoD:* a student can be found and their rank history viewed entirely in the browser.

**KG-NEXT-018 · Add an append-only `AuditEvent` model · P2** *(KG-007)*
*Objective:* actor, action, entity type, entity id, timestamp, JSON summary — written inside the existing service transactions, starting with the `actor` parameters already stubbed at `services.py:235,447`.
*Reason:* session transitions, rank changes and student edits are currently unattributed.
*Depends on:* KG-NEXT-008. *DoD:* every sensitive action produces exactly one immutable event; events survive rollback correctly (i.e. are rolled back with the failed action).
*Tests:* an event-per-action test and a rollback test.

**KG-NEXT-019 · Design student erasure / anonymisation · P3**
*Objective:* an anonymise-in-place path (scrub names and DOB, retain `wksa_id` and grading history) plus a documented retention policy.
*Reason:* `PROTECT` FKs mean a student with history cannot be deleted, so there is currently no answer to an erasure request.
*Depends on:* KG-NEXT-018; Q5 answered. *DoD:* a documented, tested procedure that preserves auditability.

**KG-NEXT-020 · Add `SyllabusVersion` provenance · P3** *(KG-014)*
*Objective:* a published-version entity referenced by assessment snapshots.
*Reason:* snapshots already protect historical meaning, so this is provenance, not correctness — sequence it **after** permissions and integrity.
*Depends on:* Q6 answered; KG-NEXT-013.

---

## 17. Future roadmap (not now)

**Foundational requirements** (the architecture will need these): student `left` status; organisation/branch scoping and the object-level permissions it implies; category-level assessment judgements and positive observations (blocked on decision M-06); a correction/reopening workflow for a genuinely mistaken finalised outcome.

**Operational:** production Docker image; backup and rehearsed restore; readiness probe distinct from liveness; error tracking; database migration runbook.

**Product (explicitly optional — my suggestions, not requirements):** certificate generation; grading reports and exports; candidate eligibility recommendations; attendance tracking; parent/student read-only portal; notifications. None of these are missing — they were never in scope. Do not let this list contaminate the completion assessment.

---

## 18. Questions only you can answer

**Q1 · What is the actual role-to-capability policy?** `docs/permissions.md` marks most cells "Proposed" or "Unresolved". KG-NEXT-008 cannot be implemented without it. *Blocks:* every endpoint's permission class, the permission test matrix, and all frontend affordance logic.
**RESOLVED 2026-09-13 — Django permissions are the authority primitive.** `User.role` becomes a label that assigns a Group, not an enforcement mechanism. The four unused role classes are deleted; small custom classes remain for the six custom actions. This supersedes my original three-tier recommendation: working through it showed KG-001, KG-003 and Q2 are one problem — the authority primitive had never been chosen — and a role ladder would have left two mechanisms standing. **Policy confirmed the same day:** instructors own everything Kuk Sool — scheduling gradings, registering candidates, maintaining student records, editing the syllabus, assessing, and proposing outcomes. Administrators add user and role management. The three sensitive permissions (final decision, promotion, post-lock withdrawal) are grantable independently of any group, so Master authority survives one person being unavailable. `User.Role` drops the unused `manager`. See `docs/decision_log.md`.

**Q2 · Is "authorised Master" a role, a permission, or a designation?** Currently a Django permission; AGENTS.md lists it as a role; `User.Role` does not contain it. *Blocks:* KG-NEXT-009. **RESOLVED 2026-09-13 — a permission**, consistently with every other authority in the system, as a consequence of Q1.

**Q3 · What should happen when a locked session cannot be completed?** *Blocks:* KG-NEXT-012. **RESOLVED 2026-09-13 — authorised post-lock withdrawal, with `LOCKED → CANCELLED` as a companion.**

*Correction to this audit.* My original recommendation — `LOCKED → CANCELLED` alone — was **wrong**, and I withdraw it. `PROMOTION_SESSION_STATUSES` requires a locked or completed session, so cancelling a session to deal with one injured candidate strips promotion from every other candidate who graded successfully. The remedy has to be surgical: withdraw the one candidate (final-decision authority, mandatory reason, `withdrawn_by`/`withdrawn_at`, blocked once the outcome is FINALISED), retaining the partial assessment snapshot exactly as recorded. `LOCKED → CANCELLED` stays, but for the different and rarer event of a grading abandoned outright. Exam-board practice keeps *absent* and *incomplete* coded separately from any grade for the same reason.

**Q4 · Which frontend stack?** *Blocks:* KG-NEXT-016 and every screen after it. **PARTIALLY RESOLVED 2026-09-13.** `drf-spectacular` and `drf-standardized-errors` are deferred (see the error-envelope decision), so TypeScript types stay hand-maintained for now and the type-synchronisation half of this question is still open. *Still recommended for the rest:* React Router + TanStack Query. Revisit generated types when the hand-maintained ones first drift from a serializer.

**Q5 · What is the retention and erasure policy, especially for minors?** *Blocks:* KG-NEXT-019. *My recommended default:* retain grading history indefinitely (it is the rank's provenance); support anonymise-in-place on request; document the reasoning.

**Q6 · What is a "syllabus version" operationally?** Dated editions (WKSA 2014, 2026), or an internal revision counter? *Blocks:* KG-NEXT-020. *My recommended default:* a published, immutable `SyllabusVersion` with an effective date, referenced by assessment snapshots. Do not start until permissions and integrity are done.

---

## 19. Final verdict

1. **State:** late backend foundation entering integration. Backend near feature-complete for the core loop; frontend barely started.
2. **Health:** high. Consistent, tested, type-checked, lint-clean, no dead code, no skipped tests.
3. **Urgent repair:** none requiring a stop. Four P1s gate deployment and frontend work.
4. **Domain foundations:** sound. Model the next features on the existing patterns.
5. **Session transitions:** safe and coherent — with one gap, the locked-session trap (KG-008).
6. **Assessments historically reliable:** **yes.** The best-engineered part of the system.
7. **Outcomes protected:** yes — model, service and database all enforce immutability.
8. **Promotion safe and atomic:** yes, **in the unmerged worktree**. Not present on `dev`.
9. **Rank history trustworthy:** in the worktree, yes. On `dev` it does not exist and `current_rank` can be changed silently.
10. **Permissions secure:** **no.** One correct gate; everything else is `IsAuthenticated`. Largest security gap.
11. **Student data handled appropriately:** minimisation is good and DOB is never exposed via API. Access breadth and the absence of erasure/audit are the gaps.
12. **Backend approaching completeness:** yes — roughly 75% of the intended domain, at high quality.
13. **How far behind is the frontend:** very far. Weeks of work; it is the critical path.
14. **Contracts coherent:** partially. Shapes are consistent; error envelopes and pagination are not settled. Fix before building screens.
15. **Test suite strong or merely large:** **genuinely strong.** It asserts database constraints, drives migrations from zero, and proves spoofing fails. Its blind spots are concurrency and endpoint-level permissions — both named.
16. **Largest remaining gaps:** frontend integration; role-based permissions; the unmerged promotion work; audit events.
17. **Architecture likely to cause rework:** three things — the hand-rolled router (will be discarded), absent pagination (breaking change if deferred), and the unwired permission classes (every screen's affordance logic depends on the answer).
18. **Do immediately:** commit the docs, merge the worktree, add CI, fix the error contract and pagination.
19. **Next major milestone:** a real grading run end-to-end in the browser — student → session → candidate → assessment → outcome → finalisation → promotion — with no Django admin.
20. **Leave alone:** the assessment snapshot design; the `CandidateOutcome` status/fields CheckConstraint; the "use the service" transition guards; ordinal rank progression; age-band snapshotting; the admin configuration; the services-layer architecture.

---

## 20. Verification of this audit

To reproduce every claim above:

```sh
docker compose up -d db
cd backend && uv sync
POSTGRES_PASSWORD=kukgrade_local_password uv run pytest -q                  # 222 passed
POSTGRES_PASSWORD=kukgrade_local_password uv run mypy kukgrade health accounts ranks students syllabus gradings
uv run ruff check . && uv run ruff format --check .
POSTGRES_PASSWORD=kukgrade_local_password uv run python manage.py makemigrations --check --dry-run
DJANGO_DEBUG=false POSTGRES_PASSWORD=kukgrade_local_password uv run python manage.py check --deploy   # W004 W008 W009
cd ../frontend && npm ci && npm run test && npm run lint && npm run typecheck && npm run build

# the stranded work
cd /Users/adi/.codex/worktrees/kukgrade-promotion-rank-history/KukGrade/backend
uv sync && POSTGRES_PASSWORD=kukgrade_local_password uv run pytest -q       # 236 passed
```

**Cleanup if wanted:** `docker compose down` (the `.local/postgres` volume is gitignored). `backend/.venv` and `frontend/node_modules` are gitignored.
