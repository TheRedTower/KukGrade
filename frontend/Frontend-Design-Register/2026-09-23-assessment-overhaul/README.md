# Assessment grading overhaul — nine proposed directions (2026-09-23)

Status: **proposed, awaiting selection.** Nothing here is an accepted decision.

This pass revisits the three assessment grading screens shipped on 2026-09-16:
mat-side scoring (SCR-019), completion review (SCR-020) and the judgement
drawers (SCR-021/022). It follows the register's established process — several
competing directions per screen, one selected — but widens it to three
directions for each of the three screens.

Once a direction is chosen per screen, paste the draft rows in
[§5](#5-draft-register-entries--paste-once-a-direction-is-chosen) into
`../FRONTEND_DESIGN_REGISTER.md` and mark SCR-019 through SCR-022 superseded.

## 0. Contents

| Path | What it is |
| --- | --- |
| `boards/*.dc.html` | One artboard per direction. Interactive sources. |
| `boards/canvas.json` | Canvas index: layout, board titles and the rationale notes. |

`boards/Main.dc.html` is direction **1A**; it carries the canvas entry-point
filename rather than a descriptive one. Every other file is named for its
direction.

These are Design-canvas sources, not standalone pages: they depend on the
canvas runtime for `<x-dc>`, `<sc-for>`, `<sc-if>` and `{{…}}` bindings, so
opening one directly in a browser shows nothing. They are committed as the
authoritative source of the proposal, so the design survives the cloud session
that produced it. The markup, inline styles, copy and seeded data are all
readable as-is, and the colour tokens are copied verbatim from
`frontend/src/theme.css`.

## 1. The nine directions

| | A | B | C |
| --- | --- | --- | --- |
| **Screen 1 · Mat-side scoring** (SCR-019) | Single Column Run | Focus Runner | Ledger Sheet |
| **Screen 2 · Completion review** (SCR-020) | Exception Report | Certificate Proof | Inline Seal Strip |
| **Screen 3 · Judgement** (SCR-021/022) | One Drawer, Two Stages | Decision Ledger Page | Cohort Adjudication Board |

### Screen 1 — mat-side scoring

- **1A · Single Column Run.** No category rail. One continuous scroll in
  syllabus order with sticky category headers that carry their own progress.
  Two verdicts only; `Clear` appears after a result and warns that it erases
  the assessor and time. Header chrome collapses to one line plus a live mat
  bar. *A grading runs in ceremony order; the instructor is not jumping
  categories at random.* Costs: long syllabi scroll a long way, and there is no
  peripheral view of distant categories.
- **1B · Focus Runner.** One requirement, full bleed, readable at arm's length.
  Oversized targets, advance on mark, a thin category progress strip, a
  *Jump to* sheet and a full-list escape hatch. *Fastest one-handed mat-side
  entry with a near-zero mis-tap surface.* Costs: no overview while working;
  wrong for a desk reviewer.
- **1C · Ledger Sheet.** The WKSA paper chart, digitised: rows are
  requirements, categories are row bands, P/F are cells, notes are inline
  fields, and a rollup rail sits alongside. *Honours FDR-008 hardest and is
  closest to the source document the register already cites.* Costs: densest of
  the three, smallest targets, least suited to a phone.

### Screen 2 — completion review

- **2A · Exception Report.** Inverts the emphasis: what passed is one line and
  a disclosure, and the screen is the shortfalls — each with its note and
  assessor, each requiring confirmation before the seal unlocks. *Reviewing
  what is already fine is wasted attention.* Costs: a clean assessment has
  almost nothing to look at.
- **2B · Certificate Proof.** Renders the record as the document it becomes, so
  the instructor proofreads rather than fills in a form: core areas, Techniques
  and Forms ledgers, notes, and a seal line that stays blank until sealed.
  *Makes immutability tangible and matches "historical grading records must
  remain reproducible".* Costs: longest to read.
- **2C · Inline Seal Strip.** No route change and no mode swap. Completion is
  an in-page banner on the scoring screen that expands into a review strip,
  reusing the **FDR-040** session-transition pattern rather than inventing a
  second one. *Kills the jarring full-screen mode change and keeps scroll
  position.* Costs: least ceremony for the most permanent action in the app.

### Screen 3 — judgement

- **3A · One Drawer, Two Stages.** One stage-aware component replaces both
  drawers. The same sealed evidence sits at the top in both stages; below it
  swaps between *Propose* and *Ratify*, and at Ratify the instructor's proposal
  appears as a sealed quote above the Master's own controls. *One component,
  one language; the record reads as a chain.* Costs: still a drawer — capped
  height, roster dimmed rather than usable.
- **3B · Decision Ledger Page.** Judgement leaves the drawer for a route: one
  vertical record of four dated entries — assessment sealed, proposal,
  decision, promotion. Sealed entries are muted and locked; the live one is
  gold; the promotion entry states its preconditions instead of hiding.
  *Drawers cap vertical room, and this is the artefact an instructor may later
  be asked to justify.* Costs: loses the roster entirely.
- **3C · Cohort Adjudication Board.** Built for the real shape of the job — a
  Master finalising a whole cohort in one sitting, not opening fourteen
  drawers. Rows carry evidence, proposal and an inline decision; a detail pane
  holds the row in focus; decisions stage, then write one row at a time with
  per-row failures per **FDR-028**. Costs: invites speed over care, and the
  instructor proposal still needs its own surface.

## 2. Why the current screens are being replaced

Read off the implementation, not from taste:

**`CandidateAssessmentScreen.tsx`**

- Every requirement renders as a `caw-item-card`, directly against **FDR-008**
  (divider-led lists over repeated cards). The accepted concept in
  `19-candidate-assessment-workspace.png` shows dividers; the implementation
  grew cards.
- Four stacked chrome bands (breadcrumbs → header → progress ledger → banner)
  sit above the first requirement. On a tablet that is most of the fold.
- The three-button segmented control spends a third of its target area on
  `NOT_ASSESSED`, which is an *undo*, not a verdict.
- The 280px category rail forces mode-switching and pushes the tap targets to
  the far right while the eye reads at the far left.
- Assessor notes are a single-line `<input>`.
- Raw emoji (`⚠️`, `🔒`) rather than one consistent icon set — a correction the
  register already logs under "Corrections required during Figma
  reconstruction".
- `assessor_email` / `assessed_at` render only on not-met rows in review, so
  "who marked this, and when" is invisible for most of the record.

**Completion review**

- A **percentage per category** implies partial credit.
  `CandidateAssessmentItem.Result` is strictly `NOT_ASSESSED | MET | NOT_MET`,
  so the number is a fiction. It is removed from all three directions.
- Every statistic is recomputed in JS while the server already returns
  `item_counts` and a full `/api/gradings/outcomes/{id}/summary/` breakdown.

**Judgement layer**

- `OutcomeProposalDrawer` (`opd-`) and `MasterFinalDecisionDrawer` (`mfd-`) are
  two components with two visual languages for two stages of one artefact, with
  duplicated candidate banners and duplicated outcome-card patterns.
- The Master sees a category evidence ledger the proposing instructor never saw.
- Flourishes ("Gold Seal Authority", avatar initials) that no other screen uses.

## 3. Backend constraints the directions were drawn against

Verified against `backend/gradings/` on 2026-09-23. No board invents past these:

- `Result` is three-valued. **No score, scale, percentage or partial credit.**
- One `assessor` per item, taken from `request.user`, overwritten by whoever
  marks last. No co-sign and no panel vote.
- The `candidate_item_assessor_matches_result` constraint nulls `assessor` and
  `assessed_at` when a result returns to `NOT_ASSESSED`. Clearing is
  destructive to attribution, and the UI says so.
- Completion requires every `required=True` item scored; optional items may be
  left unassessed. `COMPLETED` is immutable — no reopen.
- Outcomes require session `LOCKED`, candidate `COMPLETED`, assessment
  `COMPLETED`. Re-proposal while `PROPOSED` resets all final fields.
  `FINALISED` is immutable.
- `CONDITIONAL` requires `conditional_requirements`; `PASS`/`FAIL` must leave it
  empty.
- Promotion requires `FINALISED` + `PASS`, session `LOCKED` or `COMPLETED`, and
  the effective date is forced to the session date — never a form field.
- **There is no bulk item-scoring endpoint.** Any "mark the rest met"
  affordance is N sequential `PATCH`es and must be drawn as a progressive,
  interruptible, partly-failable action.

### Backend capability the current UI does not spend

The redesign puts these to work: `item_counts` on the assessment serializer;
the category breakdown from `/outcomes/{id}/summary/` (two of roughly ten
fields are consumed today); `started_at`, `completed_at`, `generated_at`;
`generated_by_email`; `result_display`; `display_range` from
`start_number`/`end_number`; item provenance (`source_requirement`,
`source_rank`) for linking a requirement back to the syllabus; the server-side
filters on `/assessment-items/`; and the structured per-row `errors` from
`bulk-start`.

## 4. States every direction must carry into implementation

The boards show the working state. These must survive:

**Screen 1** — assessment missing (*Prepare assessment form*, session `DRAFT`);
`NOT_STARTED` (*Start assessment*, session `OPEN`); `COMPLETED` read-only with
no clear affordance; candidate `WITHDRAWN`; loading; request failure;
administrator-only hard delete.

**Screen 2** — reachable only from `IN_PROGRESS` with zero required items
unassessed; re-entry after completion shows the sealed record with seal
controls removed; session `OPEN` or `LOCKED` both permit completion; a clean
assessment with no shortfalls must read as success rather than as an empty
screen.

**Screen 3** — outcome preconditions as in §3; ratify controls only under
`can_make_final_grading_decision`; promotion only under `can_promote_student`;
no edit affordance may render against a `FINALISED` outcome.

All three — light and dark, tablet and phone widths, keyboard focus order,
visible focus rings, and the reduced-motion guard already in `theme.css`.

## 5. Draft register entries — paste once a direction is chosen

Replace `<direction name>` and `<A|B|C>` with the selection. These are drafts;
they are not approved until a direction is actually chosen.

### Decision rows

| ID | Decision | Status | Notes |
| --- | --- | --- | --- |
| FDR-042 | Rebuild mat-side scoring as `<direction name>`. | Proposed | Selected from three directions on 2026-09-23. Supersedes FDR-032 (dual-pane command ledger) and FDR-033's three-peer segmented control: `NOT_ASSESSED` is an undo, not a verdict, and is demoted to a Clear affordance. Requirement rows become divider-led per FDR-008. |
| FDR-043 | Rebuild completion review as `<direction name>`. | Proposed | Selected from three directions on 2026-09-23. Supersedes FDR-036 (dual-card ledger). Per-category percentages are removed: `Result` is three-valued and carries no partial credit. Counts are served, not recomputed in React. |
| FDR-044 | Unify the instructor proposal and Master final decision as `<direction name>`. | Proposed | Selected from three directions on 2026-09-23. Supersedes FDR-037 and FDR-038. One visual language and one evidence ledger across both stages; the proposing instructor sees the same evidence as the Master. |
| FDR-045 | Clearing an item result is destructive and must say so. | Proposed | The `candidate_item_assessor_matches_result` constraint nulls `assessor` and `assessed_at` when a result returns to `NOT_ASSESSED`. Attribution cannot be restored, so the UI names who and when will be erased. |
| FDR-046 | Assessment counts are served, not recomputed. | Proposed | Use the assessment serializer's `item_counts` and `GET /api/gradings/outcomes/{id}/summary/`. React must not derive met/not-met/required totals from the item list. |

### Screen rows

| ID | Screen | Theme | File | Status |
| --- | --- | --- | --- | --- |
| SCR-026 | Mat-side scoring — `<direction name>` | Light | `2026-09-23-assessment-overhaul/boards/<file>` | Proposed |
| SCR-027 | Completion review — `<direction name>` | Light | `2026-09-23-assessment-overhaul/boards/<file>` | Proposed |
| SCR-028 | Judgement — `<direction name>` | Light | `2026-09-23-assessment-overhaul/boards/<file>` | Proposed |

### Status edits to existing rows

SCR-019 → superseded by SCR-026 · SCR-020 → superseded by SCR-027 ·
SCR-021 and SCR-022 → superseded by SCR-028.

## 6. Open decisions

Settle these in `docs/decision_log.md` before implementation starts.

1. **Positive observations.** `AGENTS.md` states that assessment data must
   support positive observations. No such field exists anywhere in the backend
   — the only free text is `CandidateAssessmentItem.assessor_notes` (one per
   item) and `CandidateAssessment.notes` (one per assessment). Either add the
   field (model, migration, service, serializer, tests) or amend `AGENTS.md`.
   **None of the nine boards fakes it.** This is the one place where the
   mockups are deliberately narrower than the stated domain rules.
2. **"Mark remaining met".** N sequential `PATCH`es in the FDR-028 style, or a
   new `bulk-update-items` endpoint? 1A and 1C are where it would pay off.
3. **Clearing a result.** 1A gates it behind an inline confirm; 1B and 1C use a
   single warned action. Pick one and apply it everywhere (FDR-045).
4. **Keyboard scoring in 1C.** The legend is drawn. Real key handling needs a
   scoped (not global) handler and a defined focus model before it is promised.
5. **Where judgement lives.** 3B and 3C are routes, not drawers. Either means
   the session roster needs a new entry point, and
   `MasterFinalDecisionDrawer.tsx` and `OutcomeProposalDrawer.tsx` are deleted
   rather than refactored.

## 7. Implementation surface, when it comes

No API, schema or migration change is required by any direction as drawn,
unless open decisions 1 or 2 are answered "add it".

- `frontend/src/CandidateAssessmentScreen.tsx` — split; completion review
  currently lives inside it as a second render branch.
- `frontend/src/CandidateAssessment.css`, `frontend/src/OutcomeDrawers.css`
- `frontend/src/OutcomeProposalDrawer.tsx`,
  `frontend/src/MasterFinalDecisionDrawer.tsx`
- `frontend/src/GradingSessionDetailScreen.tsx` — the entry points
- `frontend/src/App.test.tsx`, `frontend/src/MasterFinalDecisionDrawer.test.tsx`
  — the largest test surface in the repo; expect substantial rewriting.
