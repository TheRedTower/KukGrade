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
remaining frontend hygiene work in `docs/action_plan.md` is a separate track.

## Read Before Changing Code

Read the repository `AGENTS.md`, then:

1. `docs/current-system.md` — authority for implemented state.
2. `docs/decision_log.md` — accepted decisions, and the open decisions this
   work depends on (see §6).
3. `docs/permissions.md` — Master authority is three per-user permissions,
   never a role.
4. `docs/architecture.md` — app boundaries and historical reproducibility.
5. `docs/development-workflow.md` — testing expectations and verification
   commands.
6. `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md` — the
   accepted visual direction and the FDR decisions this work supersedes.
7. `frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/README.md`
   — the nine proposed directions.

## 1. Selected directions

Selected and recorded on 2026-09-23. The nine proposed directions are kept in
the design pass README; the six not chosen remain as the record of what was
considered.

| Screen | Selected | Register | Supersedes |
| --- | --- | --- | --- |
| Mat-side scoring | **1A Single Column Run** | SCR-026, FDR-042 | SCR-019, FDR-032, FDR-033 |
| Completion review | **2B Certificate Proof** | SCR-027, FDR-043 | SCR-020, FDR-036 |
| Master final decision | **3C Cohort Adjudication Board** | SCR-028, FDR-044 | SCR-022, FDR-038 |

Two consequences of the selection worth reading before planning any slice:

- **The instructor proposal drawer survives.** 3C is a Master surface: it
  adjudicates a locked cohort and does not carry the proposal step. FDR-037's
  right slide-over is therefore retained rather than superseded, restyled under
  FDR-047 so the proposing instructor sees the same sealed evidence ledger the
  Master does — which the current implementation does not give them.
  `MasterFinalDecisionDrawer.tsx` is deleted; `OutcomeProposalDrawer.tsx` is
  kept and reworked.
- **Two new routes.** 2B and 3C are both full routes, not in-page modes, so
  `App.tsx` gains routes and `GradingSessionDetailScreen.tsx` gains entry
  points. 3C is reached from the session, not from a candidate row.

Selecting 1A also settled the clearing treatment (FDR-045, inline confirmation)
and made bulk item scoring unnecessary for this redesign — see §6.

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
Properties: `display_range` (`"3"` or `"3-5"`) - `has_numbered_range` was
removed as dead code in the 2026-09-24 coherence audit.
Default ordering is `requirement_sequence, item_name, pk` — **category is not
an ordering key, so grouping by category is a client concern.**

**`GradingCandidate`** — `Status`: `REGISTERED` / `WITHDRAWN` / `COMPLETED`.
`WithdrawalReason`: `INJURY` / `WITHDREW` / `ABSENT` / `OTHER` (with a note).
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
  `validate_assessment_can_complete`: `IN_PROGRESS` only, session `OPEN`,
  candidate not withdrawn, and **every `required=True` item must not
  be `NOT_ASSESSED`** — optional items may be left unassessed. Completing also
  flips the candidate to `COMPLETED`. A `COMPLETED` assessment is immutable,
  notes included, except that `reopen_candidate_assessment` (since 2026-09-26)
  returns it to `IN_PROGRESS` while the session is still `OPEN`.
- `bulk_start_candidate_assessments` — per-row independent, returns
  `(started, errors)`.
- `update_candidate_assessment_item` — **only `result` and `assessor_notes` are
  writable.** Sets and clears `assessor`/`assessed_at` automatically.
  `validate_assessment_item_can_be_changed`: assessment `IN_PROGRESS` (distinct
  errors for `NOT_STARTED` and `COMPLETED`), session `OPEN`, candidate
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
  requires every non-withdrawn candidate's assessment to be `COMPLETED`
  (since 2026-09-26); `LOCKED→COMPLETED` requires every non-withdrawn candidate to
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

- `item_counts` on the assessment serializer — **zero references in the
  frontend**, and it is weaker than it looks. It returns only `total`,
  `required`, `met`, `not_met` and `not_assessed`, with **no required-split**,
  and the generated type is `{ [key: string]: number }`. It therefore cannot
  drive the completion gate or the "N required remaining" counter: optional
  items may legitimately be left unassessed, so `not_assessed > 0` does not
  mean incomplete. `CandidateAssessmentScreen.tsx` recomputes its own stats
  from the item list because the server does not currently serve what the
  screen needs. See §6.1.
- `GET /outcomes/{id}/summary/` — carries the full overall and per-category
  breakdown including `required_met`, `required_not_met`,
  `required_not_assessed`, `all_required_assessed` and `all_required_met`, but
  at doc-authoring time was consumed only by `MasterFinalDecisionDrawer.tsx`,
  and only `categories[].all_required_met` and
  `overall.required_met`/`overall.required`. **It is reachable only once a
  `CandidateOutcome` exists**, which requires session `LOCKED` and assessment
  `COMPLETED` — so it is unavailable during scoring and at completion review.
  The underlying service, `candidate_assessment_summary(assessment)`, takes
  an assessment and works at any status; the outcome view is a two-line
  wrapper over it (`gradings/views.py`, `CandidateOutcomeViewSet.summary`).
  **Resolved by slice 2**: the same service is now also exposed on the
  assessment resource (`GET /assessments/{id}/summary/`), which the scoring
  and completion screens call instead. See §6.1.
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
- Editing an item after completion without reopening it first, or reopening
  once the session has locked.
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
controls removed, and a reopen control while the session is still `OPEN`;
completion is only possible in an `OPEN` session; a clean
assessment with no shortfalls must read as success, not as an empty screen.

**Judgement** — outcome preconditions per §2; re-proposal allowed while
`PROPOSED`; no edit affordance may render against a `FINALISED` outcome;
ratify controls only under `can_make_final_grading_decision`; promotion only
under `can_promote_student`.

**All three** — light and dark (FDR-012 layered charcoal, not an inversion),
tablet and phone widths, ≥44px targets (FDR-007), text-plus-icon status never
colour alone (FDR-003), keyboard focus order with visible rings, and the
reduced-motion guard already in `theme.css`.

## 5. Implementation slices

One commit per slice. Each must pass the §7 commands before the next begins.

1. **Selection and register.** *Done, 2026-09-23.* FDR-042 to FDR-047 and
   SCR-026 to SCR-028 recorded; SCR-019, SCR-020 and SCR-022 superseded;
   decision-log entries written.
2. **Serve the counts (FDR-046).** *Done, 2026-09-23.* Two parts, backend
   first.
   *Backend:* the existing `candidate_assessment_summary` service is exposed
   on the assessment resource — `GET /api/gradings/assessments/{id}/summary/`,
   a two-line action mirroring the outcome one, plus contract documentation
   and permission tests (`gradings/tests.py`:
   `test_assessment_summary_is_served_while_the_assessment_is_in_progress`,
   `test_assessment_summary_requires_the_view_permission`,
   `test_assessment_summary_rejects_a_write`). No model, migration or service
   change.
   *Frontend:* the client-side stat derivation in `CandidateAssessmentScreen.tsx`
   was replaced with that response (`candidateAssessmentData.ts`), and the
   per-category percentage removed. Schema and frontend types regenerated.
   See §6.1 — accepted.
3. **Split the screen.** *Done, 2026-09-23.* Completion review moved out of
   `CandidateAssessmentScreen.tsx`'s `isReviewMode` branch into
   `AssessmentCompletionScreen.tsx` on
   `gradings/:sessionId/assessments/:candidateId/review`. The five shared
   queries and derived rollups moved to `candidateAssessmentData.ts`, and
   `RankVisual` to its own file, so nothing is duplicated. No visual change.
4. **Rebuild mat-side scoring as 1A.** *Done, 2026-09-24.* Divider-led rows in
   syllabus order, sticky category headers carrying their own progress, two
   verdict targets plus the confirmed `Clear` (FDR-045), per-row assessor
   attribution, and the persistent mat bar. The category sub-rail, the
   three-peer segmented control, the progress ledger and the single-line note
   input are gone; chrome icons are inline SVG rather than emoji. Notes are a
   textarea. `CandidateAssessment.css` lost the dual-pane, sub-rail, item-card
   and segmented-control blocks.
5. **Rebuild completion review as 2B.** *Done, 2026-09-24.* The record as a
   proof sheet: rank transition, core grading areas, requirement ledgers,
   every recorded note, the editable assessment note, and a seal line blank
   until sealed. Provenance and counts in a side column — `generated_by_email`,
   `generated_at`, `started_at` and `completed_at` surface here. Sealing is
   gated on an explicit proofread acknowledgement. One deliberate deviation
   from the board: the ledgers are **not** limited to Techniques and Forms.
   Every non-core category present in the snapshot gets a ledger under its
   served `category_display`, because a Weapons or Other requirement that was
   scored must still appear or the permanent record would omit part of what
   was assessed. `CORE_CATEGORY_CODES` moved from `SyllabusScreen` to
   `syllabusCategories.ts` so the syllabus and the record cannot disagree
   about what a core area is.
6. **Build the Cohort Adjudication Board as 3C.** *Done, 2026-09-28.*
   `/gradings/:id/decisions`: every non-withdrawn candidate is a row carrying
   the served counts, the instructor proposal and an inline Pass /
   Conditional / Fail; the detail pane shows the row in focus. Decisions
   stage, then write one candidate at a time through the existing finalise
   endpoint; a failed row keeps its error and stays staged, and only failed
   rows retry (FDR-028). A Conditional cannot be recorded without re-test
   requirements. The board is read-only unless the session is `LOCKED` and
   the user holds `can_make_final_grading_decision`. One deliberate deviation
   from the board, as in slice 5: the detail pane shows every recorded
   `assessor_notes` value, not only shortfalls. `MasterFinalDecisionDrawer`,
   its test and its `mfd-` styles are deleted, and the session screen's
   decision actions link to the board.
7. **Restyle the proposal drawer (FDR-047).** Give `OutcomeProposalDrawer.tsx`
   the board's evidence presentation so the instructor sees the sealed
   assessment ledger before proposing.
8. **Dark, responsive and accessibility parity pass** across all four surfaces.

## 6. Open decisions

Mirrored in `decision_log.md`.

1. **Assessment summary endpoint — accepted 2026-09-23.** Add
   `GET /api/gradings/assessments/{id}/summary/` returning
   `candidate_assessment_summary(assessment)`, the same service and response
   shape the outcome endpoint already returns, reachable at any status. A
   viewset action, contract documentation and permission tests; no model,
   migration or service change. This is slice 2's backend half.
   **No open decision now blocks any slice.**
2. **Positive observations — resolved.** `AGENTS.md` was amended on 2026-09-23
   rather than a field added. `CandidateAssessmentItem.assessor_notes` is the
   single per-item free-text field and records both shortfalls and positive
   observations; `CandidateAssessment.notes` carries the overall observation.
   No migration.
3. **Bulk item scoring — deferred.** No selected direction includes a "mark
   remaining met" affordance, so nothing depends on it.
4. **Clearing a result — accepted.** Inline confirmation naming the assessor
   and time it erases (FDR-045).
5. **Keyboard scoring — not applicable.** It was specific to 1C, which was not
   selected.
6. **Where judgement lives — resolved.** 3C is a route; see §1.

## 7. Verification

Run the full command set in `docs/development-workflow.md` - the one
canonical list, so it cannot drift from what is duplicated here. Backend
migration checks are required if any open decision is answered "add the
field".

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
