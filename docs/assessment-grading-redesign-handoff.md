# Assessment Grading Redesign Handoff

Prepared: 2026-09-23

Target branch: `dev`

Baseline commit: `da019c516b11220653daff2e1b5b7b1f83d202b1`

Design pass: `frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/`

## Purpose

This is the implementation handoff for rebuilding the three assessment grading
screens: mat-side scoring, completion review, and the judgement layer
(instructor proposal plus Authorised Master final decision).

It is written for a coding agent starting cold from `dev`. Everything needed to
begin is in this file or in the documents it names; nothing is carried in a
chat session.

Work in small reviewable slices. Do not combine a screen rebuild with
stylesheet modularisation, test-file moves, or accessibility remediation — the
frontend hygiene work in `frontend-next-steps-handoff.md` is a separate track.

## Read Before Changing Code

Read the repository `AGENTS.md`, then:

1. `docs/current-system.md` — authority for implemented state.
2. `docs/decision_log.md` — accepted decisions, and the open decisions this
   work depends on (see §6).
3. `docs/permissions.md` — Master authority is three per-user permissions,
   never a role.
4. `docs/domain-model.md` — grading lifecycle and historical reproducibility.
5. `docs/testing-strategy.md`
6. `docs/development-workflow.md` — verification commands.
7. `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md` — the
   accepted visual direction and the FDR decisions this work supersedes.
8. `frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/README.md`
   — the nine proposed directions.

## 1. Selection gate — read this first

**No implementation may start until one direction is selected per screen.**

| Screen | Current | Proposed directions |
| --- | --- | --- |
| Mat-side scoring | SCR-019 / FDR-032, FDR-033 | 1A Single Column Run · 1B Focus Runner · 1C Ledger Sheet |
| Completion review | SCR-020 / FDR-036 | 2A Exception Report · 2B Certificate Proof · 2C Inline Seal Strip |
| Judgement | SCR-021, SCR-022 / FDR-037, FDR-038 | 3A One Drawer Two Stages · 3B Decision Ledger Page · 3C Cohort Adjudication Board |

Until selection happens, FDR-032, FDR-033, FDR-036, FDR-037 and FDR-038 remain
the approved decisions and SCR-019 through SCR-022 remain the selected
concepts. Draft FDR-042 to FDR-046 and SCR-026 to SCR-028 rows are written out
in the design pass README, ready to be moved into the register's tables when a
direction is chosen.

Record the selection in the register and in `decision_log.md` before writing
code.

## 2. Verified backend contract

Verified against `backend/gradings/` at the baseline commit. The redesign is
constrained by this; do not design past it without a schema decision.

### Models (`backend/gradings/models.py`)

**`CandidateAssessment`** — `OneToOne` on `candidate`.
Fields: `status`, `generated_at`, `generated_by` (FK User, PROTECT, required),
`started_at`, `completed_at`, `notes`, `created_at`, `updated_at`.
`Status`: `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`.
DB constraints enforce timestamp coherence: `NOT_STARTED` ⇒ both timestamps
null; `IN_PROGRESS` ⇒ `started_at` set, `completed_at` null; `COMPLETED` ⇒ both
set with `completed_at >= started_at`.
There is **no `assessed_by` on the assessment** — only `generated_by`. Assessor
attribution is per item.

**`CandidateAssessmentItem`** — FK `assessment`, `related_name="items"`.
Snapshot provenance: `source_requirement`, `source_item`, `source_rank` (all
nullable `SET_NULL`), `source_age_band`.
Display: `item_code`, `item_name`, `korean_name`, `category`,
`requirement_sequence`, `required` (default `True`), `start_number`,
`end_number` (set together, `end >= start >= 1`), `requirement_notes`.
Grading: `result`, `assessor` (FK User, PROTECT, nullable), `assessed_at`,
`assessor_notes`.
`Result`: **`NOT_ASSESSED` / `MET` / `NOT_MET` — binary verdict only, no score,
scale, percentage or partial credit.**
`category` from `SyllabusItem.Category`: `ETIQUETTE`, `FUNDAMENTALS`,
`HAND_TECHNIQUES`, `KICKING`, `FALLING`, `BREAKING`, `TECHNIQUE_SET`, `FORM`,
`WEAPONS`, `OTHER`.
Constraint `candidate_item_assessor_matches_result`: `NOT_ASSESSED` ⇒ assessor
and `assessed_at` both null; `MET`/`NOT_MET` ⇒ both non-null. **Clearing a
result wipes attribution, irreversibly.**
Uniqueness: `(assessment, source_requirement)` and
`(assessment, source_age_band, item_code, requirement_sequence)`.
Properties: `has_numbered_range`, `display_range` (`"3"` or `"3-5"`).
Default ordering is `requirement_sequence, item_name, pk` — **category is not
an ordering key, so grouping by category is a client concern.**

**`GradingCandidate`** — `Status`: `REGISTERED` / `WITHDRAWN` / `COMPLETED`.
`WithdrawalReason`: `INJURY` / `WITHDREW` / `ABSENT` / `ADMIN_ERROR`.
`AgeBand`: `AGE_8_AND_UNDER` / `AGE_9_TO_12` / `AGE_13_TO_17` /
`AGE_18_AND_OVER`. Unique `(session, student)`. Reverse accessors
`.assessment`, `.outcome`, `.promotion`.

**`CandidateOutcome`** — separate model, `OneToOne` to both candidate and
assessment. `proposed_outcome`, `proposed_by`, `proposed_at`,
`proposal_notes`, `final_outcome`, `decided_by`, `decided_at`,
`decision_notes`, `status`, `conditional_requirements`.
`Outcome`: `PASS` / `FAIL` / `CONDITIONAL`. `Status`: `DRAFT` / `PROPOSED` /
`FINALISED`. `decided_at >= proposed_at`. `CONDITIONAL` requires non-empty
`conditional_requirements`; `PASS`/`FAIL` require it empty. `FINALISED` is
immutable at model, queryset and DB level.

**`GradingSession`** — `Status`: `DRAFT` / `OPEN` / `LOCKED` / `COMPLETED` /
`CANCELLED`.

**`Promotion`** — `student`, `outcome`, `grading_candidate`, `from_rank`,
`to_rank`, `promoted_by`, `promoted_at`, `effective_date`, `notes`. Fully
immutable: save, delete and queryset update all refuse.

There is **no category model**. Category is a denormalised `CharField` on the
item, and category-level results are computed, never stored.

### Services (`backend/gradings/services.py`)

- `generate_candidate_assessment`, `bulk_generate_candidate_assessments` —
  snapshot syllabus requirements into items.
- `update_candidate_assessment` — **the single entry point for both start and
  complete** (writes `status` and `notes`).
  `validate_assessment_can_start`: `NOT_STARTED` only, session `OPEN`,
  candidate not withdrawn.
  `validate_assessment_can_complete`: `IN_PROGRESS` only, session `OPEN` or
  `LOCKED`, candidate not withdrawn, and **every `required=True` item must not
  be `NOT_ASSESSED`** — optional items may be left unassessed. Completing also
  flips the candidate to `COMPLETED`. A `COMPLETED` assessment is immutable,
  notes included.
- `bulk_start_candidate_assessments` — per-row independent, returns
  `(started, errors)`.
- `update_candidate_assessment_item` — **only `result` and `assessor_notes` are
  writable.** Sets and clears `assessor`/`assessed_at` automatically.
  `validate_assessment_item_can_be_changed`: assessment `IN_PROGRESS` (distinct
  errors for `NOT_STARTED` and `COMPLETED`), session `OPEN`/`LOCKED`, candidate
  not withdrawn. Notes-only edits are audited too.
- `create_candidate_outcome` — session **`LOCKED`**, candidate `COMPLETED`,
  assessment `COMPLETED`.
- `propose_candidate_outcome` — `DRAFT` or `PROPOSED`; re-proposal is allowed
  and resets every final field. Refused after `FINALISED`.
- `finalise_candidate_outcome` — requires `can_make_final_grading_decision`,
  status `PROPOSED`, session `LOCKED`, and the conditional rule above. Records
  whether the final decision overrode the proposal.
- `promote_candidate`, `bulk_promote_candidates` — require
  `can_promote_student`. `validate_promotion_eligibility`: `FINALISED` with
  `final_outcome == PASS` only, session `LOCKED` or `COMPLETED`,
  **`effective_date` is forced to the session date and is not a parameter**,
  and `to_rank` must still be the next active rank after the student's current
  rank.
- `transition_grading_session`, `validate_session_transition` — `OPEN→LOCKED`
  requires every non-withdrawn candidate to have an assessment at least
  `IN_PROGRESS`; `LOCKED→COMPLETED` requires every non-withdrawn candidate to
  have a `COMPLETED` assessment **and** a `FINALISED` outcome.
- `withdraw_locked_candidate` — requires `can_override_locked_session`.
- `candidate_assessment_summary` — computes `overall` plus `categories`, each
  carrying `total`, `required`, `met`, `not_met`, `not_assessed`,
  `required_met`, `required_not_met`, `required_not_assessed`,
  `all_required_assessed`, `all_required_met`.

### REST surface (`backend/gradings/urls.py`, `views.py`)

Assessment:

- `GET /api/gradings/assessments/` — filters `candidate`, `session`,
  `student_wksa_id`, `testing_for_rank_code`, `status`
- `GET`, `PATCH`, `DELETE /api/gradings/assessments/{id}/` — `PATCH` writes
  only `status` and `notes`, and is how start and complete happen
- `POST /api/gradings/assessments/bulk-start/` → `{started, errors}`
- `GET /api/gradings/assessment-items/` — filters `assessment`, `candidate`,
  `session`, `item_code`, `category`, `result`, `required`
- `GET`, `PATCH /api/gradings/assessment-items/{id}/` — only `result` and
  `assessor_notes`. **No POST, no DELETE, no bulk item endpoint.**

Candidate: full CRUD on `/api/gradings/candidates/`, plus
`generate-assessment/`, `withdraw/`, `create-outcome/`, `bulk-register/`,
`bulk-generate-assessments/`, `bulk-update-status/`.

Outcome: `GET /api/gradings/outcomes/` (filters include `proposed_by`,
`decided_by`, `proposed_outcome`, `final_outcome`), `GET .../{id}/`,
`PATCH .../{id}/propose/`, `PATCH .../{id}/finalise/`, `GET .../{id}/summary/`,
`POST .../{id}/promote/`, `POST .../bulk-promote/`. A plain
`PATCH /outcomes/{id}/` is deliberately **405**.

### Backend capability the current UI does not use

The redesign should spend these rather than recomputing or omitting them:

- `item_counts` on the assessment serializer (`total`, `required`, `met`,
  `not_met`, `not_assessed`) — **zero references in the frontend.**
  `CandidateAssessmentScreen.tsx` recomputes its own stats from the item list.
- `GET /outcomes/{id}/summary/` — consumed only by
  `MasterFinalDecisionDrawer.tsx`, and only `categories[].all_required_met` and
  `overall.required_met`/`overall.required`. Unused at both levels:
  `required_not_met`, `required_not_assessed`, `all_required_assessed`, `met`,
  `not_met`, `not_assessed`, `total`. The scoring screen never calls it.
- `started_at`, `completed_at`, `generated_at` — never rendered.
- `generated_by` / `generated_by_email` — never rendered.
- Per-item `assessor_email` and `assessed_at` — rendered only in the not-met
  review list, so "who marked this, and when" is invisible for most rows.
- `result_display` — unused; the frontend hard-codes labels.
- `start_number`, `end_number`, `display_range` on items — unused while
  grading (only `SyllabusScreen.tsx` uses `display_range`).
- Item provenance `source_requirement`, `source_item`, `source_rank`,
  `source_age_band` — unused; deep-linking an item back to its syllabus
  requirement is supported but not built.
- `assessment_status` denormalised onto the outcome payload — unused.
- Server-side filters on `/assessment-items/` and `/assessments/` — the UI
  filters in JS instead.
- Structured per-row `errors` from `bulk-start` — a partial-failure UI is
  supported.

### Not supported — do not design around these

- **Positive observations.** No praise, strength or highlight field exists
  anywhere in the backend. The only free text is `assessor_notes` (one per
  item) and `CandidateAssessment.notes` (one per assessment). See §6.1.
- Any score, numeric grade, percentage, star rating or partial credit.
- Multiple assessors per item, co-signing, or panel voting. One `assessor` FK,
  overwritten by whoever marks last.
- A stored category-level result, category comment or category sign-off.
- Editing an item after completion, or reopening a `COMPLETED` assessment.
- Editing `item_name`, `category`, `required` or `requirement_notes`, or
  adding/removing items. No create or delete route for items.
- Bulk item scoring ("mark all met in this category") — no endpoint; it would
  be N sequential `PATCH`es.
- Per-item photo, video, attachment or timer.
- An assessor identity chosen by the UI — always `request.user`.
- Grading before the session is `OPEN`, or proposing/finalising before `LOCKED`.
- Promotion on `CONDITIONAL` or `FAIL`, or a user-chosen promotion date.
- Editing a `FINALISED` outcome or any `Promotion`.
- Draft or autosave of an unsubmitted result. Every `PATCH` is a durable,
  audited write.

## 3. What is wrong with the current screens

Read off the implementation at the baseline commit, and the reason this
redesign exists.

**`frontend/src/CandidateAssessmentScreen.tsx`**

- Every requirement renders as a `caw-item-card`, against **FDR-008**
  (divider-led lists over repeated cards). The accepted concept
  `19-candidate-assessment-workspace.png` shows dividers; the implementation
  grew cards.
- Four stacked chrome bands — breadcrumbs, header, progress ledger, banner —
  sit above the first requirement. On a tablet that is most of the fold.
- The three-button segmented control spends a third of its target area on
  `NOT_ASSESSED`, which is an undo, not a verdict.
- The 280px category rail forces mode-switching and puts the tap targets at the
  far right while the eye reads at the far left.
- Assessor notes are a single-line `<input>`.
- Raw emoji (`⚠️`, `🔒`) rather than one icon set — a correction the register
  already records under "Corrections required during Figma reconstruction".
- Completion review lives inside this file as a second render branch
  (`isReviewMode`), which is why the file is ~40k.

**Completion review**

- A per-category **percentage** implies partial credit that `Result` does not
  have. The number is a fiction and must not be reintroduced.
- Every statistic is recomputed in JS while the server already serves
  `item_counts` and the full summary breakdown.

**Judgement layer**

- `OutcomeProposalDrawer` (`opd-`) and `MasterFinalDecisionDrawer` (`mfd-`) are
  two components with two visual languages for two stages of one artefact, with
  duplicated candidate banners and duplicated outcome-card patterns.
- The Master sees a category evidence ledger the proposing instructor never
  saw.
- Flourishes ("Gold Seal Authority", avatar initials) that no other screen
  uses.

## 4. States every rebuild must carry

**Mat-side scoring** — assessment missing (*Prepare assessment form*, session
`DRAFT`); `NOT_STARTED` (*Start assessment*, session `OPEN`); `COMPLETED`
read-only with no clear affordance; candidate `WITHDRAWN`; loading; request
failure; administrator-only hard delete. Optional items may stay
`NOT_ASSESSED`; only `required=True` gates completion.

**Completion review** — reachable only from `IN_PROGRESS` with zero required
items unassessed; re-entry after completion shows the sealed record with seal
controls removed; session `OPEN` or `LOCKED` both permit completion; a clean
assessment with no shortfalls must read as success, not as an empty screen.

**Judgement** — outcome preconditions per §2; re-proposal allowed while
`PROPOSED`; no edit affordance may render against a `FINALISED` outcome;
ratify controls only under `can_make_final_grading_decision`; promotion only
under `can_promote_student`.

**All three** — light and dark (FDR-012 layered charcoal, not an inversion),
tablet and phone widths, ≥44px targets (FDR-007), text-plus-icon status never
colour alone (FDR-003), keyboard focus order with visible rings, and the
reduced-motion guard already in `theme.css`.

## 5. Suggested implementation slices

One commit per slice. Each slice must pass the §7 commands before the next
begins.

1. **Selection and register.** Record the chosen direction per screen. Move the
   draft FDR-042 to FDR-046 and SCR-026 to SCR-028 rows into
   `FRONTEND_DESIGN_REGISTER.md`, mark SCR-019 to SCR-022 superseded, and add
   the decision-log entries. No code.
2. **Serve the counts (FDR-046).** Replace client-side stat derivation with
   `item_counts` and `/outcomes/{id}/summary/`. Remove the per-category
   percentage. Behaviour-preserving apart from the percentage; do it before any
   layout change so the diff stays readable.
3. **Split the screen.** Extract completion review out of
   `CandidateAssessmentScreen.tsx` into its own component, still rendering the
   current design. Pure refactor, tests updated in place.
4. **Rebuild mat-side scoring** to the selected direction, including the
   destructive-clear treatment (FDR-045) and per-row assessor attribution.
5. **Rebuild completion review** to the selected direction.
6. **Unify the judgement layer** to the selected direction. If 3B or 3C is
   chosen, this adds a route and deletes both drawer components rather than
   refactoring them, and `GradingSessionDetailScreen.tsx` needs a new entry
   point.
7. **Dark, responsive and accessibility parity pass** across all three.

## 6. Open decisions that block implementation

Mirrored into `decision_log.md` under "Open decisions". Settle 1 before slice
4, and 2 and 3 before slice 4 is designed.

1. **Positive observations.** `AGENTS.md` states assessment data must support
   positive observations. No such field exists in the backend. Either add
   `CandidateAssessmentItem.positive_note` (model, migration, service,
   serializer, permission and validation tests) or amend `AGENTS.md`. None of
   the nine design boards fakes it — this is the one place where they are
   deliberately narrower than the stated domain rules.
2. **"Mark remaining met".** N sequential `PATCH`es presented as a progressive,
   interruptible, partly-failable action in the FDR-028 style, or a new
   `bulk-update-items` endpoint.
3. **Clearing a result.** Inline confirm, or a single warned action. Whichever
   is chosen applies everywhere (FDR-045).
4. **Keyboard scoring.** Only relevant if 1C is selected. Needs a scoped — not
   global — key handler and a defined focus model before it is promised.
5. **Where judgement lives.** 3B and 3C are routes, not drawers, and change the
   roster's entry point.

## 7. Verification

Backend (from `backend/`), required if any open decision is answered "add the
field":

```
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py migrate
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings
```

Frontend (from `frontend/`):

```
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
```

Regenerate the OpenAPI schema and frontend types if the API contract changes.
Do not hand-write response types.

## 8. Test surface and risks

- `frontend/src/App.test.tsx` is ~190k and the largest test file in the
  repository. It covers the assessment workspace in detail and will need
  substantial rewriting. Budget for this — it is the dominant cost of slices 4
  to 6, not the components themselves.
- `frontend/src/MasterFinalDecisionDrawer.test.tsx` and
  `GradingSessionDetailScreen.test.tsx` are directly affected.
- Permission boundaries must stay covered: `can_make_final_grading_decision`,
  `can_promote_student`, `can_override_locked_session`, and the
  administrator-only assessment delete.
- Historical reproducibility must not regress. The redesign is a read-and-write
  surface over existing snapshots; it must not rewrite or infer past assessment
  data.
- No API, schema or migration change is required by any direction as drawn,
  unless open decision 1 or 2 is answered "add it".

## 9. Files expected to change

- `frontend/src/CandidateAssessmentScreen.tsx` (split)
- `frontend/src/CandidateAssessment.css`, `frontend/src/OutcomeDrawers.css`
- `frontend/src/OutcomeProposalDrawer.tsx`,
  `frontend/src/MasterFinalDecisionDrawer.tsx`
- `frontend/src/GradingSessionDetailScreen.tsx` (entry points)
- `frontend/src/App.tsx` (routes, if 3B or 3C)
- `frontend/src/App.test.tsx`,
  `frontend/src/MasterFinalDecisionDrawer.test.tsx`,
  `frontend/src/GradingSessionDetailScreen.test.tsx`
- `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md`
- `docs/current-system.md`, `docs/decision_log.md`
