# Frontend Next-Steps Handoff

Prepared: 2026-09-20

Target branch: `dev`

Baseline commit: `2dcf7cf73f2c9df635807f9dedd9eb1bb9611e39`

Latest verified CI: [run 35521698914](https://github.com/TheRedTower/KukGrade/actions/runs/35521698914)

## Purpose

This is the implementation handoff for the remaining frontend completion and
repository-hygiene work. It is written for a new coding agent starting from the
current `dev` branch.

Work in small reviewable slices. Do not combine accessibility corrections,
stylesheet moves, test-file moves, and new product behaviour in one commit.

## Read Before Changing Code

Read the repository `AGENTS.md`, then:

1. `README.md`
2. `docs/README.md`
3. `docs/current-system.md`
4. `docs/action_plan.md`
5. `docs/decision_log.md`
6. `docs/product-requirements.md`
7. `docs/architecture.md`
8. `docs/domain-model.md`
9. `docs/permissions.md`
10. `docs/testing-strategy.md`
11. `docs/development-workflow.md`
12. `docs/api_contract.md`
13. `docs/grading_app_planning.md`
14. `docs/audits/2026-09-19-frontend-repository-hygiene-review.md`

`docs/current-system.md` is the authority for current implementation state.
The dated audit is evidence and historical context, not a live task list.

## Current Verified State

The repository is clean at the baseline above. Local and remote `dev` agree,
and only `dev` and `prod` are retained as long-lived branches.

The current frontend already includes:

- authentication, account/profile and mandatory password-change flows;
- operational overview, Students, Syllabus and grading-session screens;
- cohort construction, assessment preparation, bulk start and marking;
- instructor outcome proposals and authorised Master final decisions;
- individual and bulk promotion;
- the Audit browser and administrator Users workspace;
- attendance/no-show confirmation and authorised locked-session withdrawal;
- route-level lazy loading for the grading-session detail workspace;
- shared `useDialogFocus` behaviour on decision drawers, cohort exceptions,
  student status/edit dialogs and individual promotion confirmation;
- light, dark and system themes; and
- generated API types, CI and frontend unit/integration tests.

The latest documented verification baseline is 474 backend tests and 147
frontend tests. Re-run the suites and update the count if it changes.

Do **not** rebuild the Audit, Users, attendance, withdrawal, promotion or core
grading workflows. Do **not** reverse commit `2dcf7cf`, which deliberately
styles button variants that had fallen back to browser-default white.

## Required Work, in Order

### Slice 1: Finish Dialog and Confirmation Focus Management

Two confirmation dialogs still use local Escape handlers rather than the
shared focus-management contract:

- `frontend/src/GradingSessionsScreen.tsx`
  - grading-session deletion confirmation;
- `frontend/src/GradingSessionDetailScreen.tsx`
  - lifecycle confirmation for open, lock, complete, cancel and delete.

For each dialog:

1. Use `useDialogFocus` on the actual dialog panel, not the backdrop.
2. Give the panel `tabIndex={-1}` as the no-focusable-control fallback.
3. Move initial focus to the safest meaningful control. For destructive
   confirmations, prefer Cancel. For cancellation with a reason field, the
   reason field is also an acceptable deliberate choice.
4. Trap Tab and Shift+Tab inside the dialog.
5. Close on Escape only while no mutation is pending.
6. Prevent backdrop and close-button dismissal while a mutation is pending.
7. Restore focus to the exact button/menu item that opened the dialog.
8. Preserve the body-scroll lock and restore the previous overflow value.
9. Remove only the now-redundant component-local Escape effect.
10. Preserve all existing permissions, lifecycle rules, messages and API
    payloads.

Add regression coverage for:

- initial focus;
- forward and backward focus wrapping;
- Escape close and launcher-focus restoration;
- mutation-pending close prevention; and
- successful close/focus restoration.

The following dialogs already have working local focus behaviour and should be
verified before deciding whether to refactor them:

- `AuditScreen.tsx` event detail;
- `UsersScreen.tsx` create-user dialog;
- `UserDetailScreen.tsx` password-reset dialog; and
- `GradingAttendanceDialogs.tsx` attendance and withdrawal dialogs.

Migrating those to `useDialogFocus` is optional cleanup. Do it only if tests
prove identical behaviour; do not create churn merely for uniformity.

### Slice 2: Complete the Wider Accessibility Verification

Audit every implemented route in light and dark modes at desktop and a narrow
mobile viewport. Use a real browser for the interaction checks.

Required checks:

- complete keyboard navigation without a mouse;
- logical tab order and visible `:focus-visible` indication;
- no keyboard focus behind an open modal or drawer;
- focus restoration after menus, dialogs and drawers close;
- accessible names for icon-only buttons;
- labels and descriptions for all inputs, radio groups and comboboxes;
- useful heading order, landmarks and table headers;
- error, success, loading and progress messaging exposed with appropriate
  `alert`, `status` or live-region semantics;
- no information conveyed by colour alone;
- usable contrast in light and dark themes;
- reduced-motion behaviour under `prefers-reduced-motion: reduce`;
- 200% browser zoom without clipped actions or lost content;
- 390-pixel viewport without page-level horizontal overflow; wide tables may
  scroll inside their own labelled container;
- touch targets suitable for tablet use; and
- no fresh browser-console errors or warnings during core workflows.

`App.css` contains several `outline: none` declarations. Inspect each one and
confirm that a visible replacement focus style exists. Do not blindly remove
them, because some belong to controls with a parent-level focus treatment.

Do not add an accessibility dependency solely for this pass without first
recording why it is needed. Existing Testing Library assertions plus real
browser checks are acceptable.

Record fixes with targeted tests. Update `docs/current-system.md` only for
behaviour that is actually implemented and verified.

### Slice 3: Split `App.css` by Stable Feature Boundary

`frontend/src/App.css` is currently approximately 10,039 lines. Existing
extracted stylesheets are:

- `theme.css`;
- `AuditScreen.css`;
- `UserManagement.css`; and
- `GradingAttendance.css`.

Continue that pattern. Recommended extraction order:

1. student list/create/detail styles;
2. grading-session list/create/detail styles;
3. cohort builder styles;
4. assessment workspace and completion-review styles;
5. outcome proposal and final-decision drawer styles;
6. syllabus styles;
7. promotion-ledger styles; and
8. shared shell, login, overview and generic primitives last.

Rules for every extraction:

- move declarations verbatim before attempting simplification;
- import the new stylesheet from the owning component or route boundary;
- preserve source order where the cascade depends on it;
- keep dark-theme and responsive rules with their owning feature;
- do not rename classes or redesign screens during the move;
- do not duplicate token definitions from `theme.css`;
- run the full frontend suite, type check and production build after each
  feature boundary; and
- visually compare light, dark, desktop and mobile states before committing.

One feature stylesheet per commit is preferred. If moving a block changes the
rendered result, stop and correct the cascade rather than compensating with
new `!important` rules.

### Slice 4: Split the Monolithic Frontend Test File

`frontend/src/App.test.tsx` is approximately 4,827 lines. Move its existing
top-level screen/workflow `describe` blocks into feature-aligned test files.

Suggested destinations include:

- `Authentication.test.tsx`;
- `OverviewScreen.test.tsx`;
- `StudentsScreen.test.tsx`;
- `StudentDetailScreen.test.tsx`;
- `GradingSessionsScreen.test.tsx`;
- `GradingSessionDetailScreen.test.tsx`;
- `BuildGradingCohortScreen.test.tsx`; and
- `AssessmentWorkspace.test.tsx`.

Keep the already separate Audit, Users, Syllabus, final-decision, promotion
and dialog-hook tests separate.

This is initially a mechanical move:

- preserve assertions and test names;
- preserve the total test count;
- do not change production behaviour in the same commit;
- extract shared render/API fixture helpers only after two or more destination
  files demonstrate genuine duplication; and
- keep feature-specific fixtures with their feature.

Do not include backend test or service modularisation in this frontend handoff.

### Slice 5: Reconcile Documentation and Re-run Hygiene Checks

After the implementation slices:

1. Update `docs/current-system.md` with only verified behaviour and current
   test counts.
2. Update `docs/action_plan.md` and `docs/development-workflow.md` so completed
   accessibility/modularisation work is no longer described as pending.
3. Re-check `README.md` and `docs/README.md` for stale frontend claims.
4. Re-scan tracked files for secrets, environment files, build output,
   dependency directories, coverage output, Playwright scratch files and OS
   metadata.
5. Confirm generated API types still match the committed OpenAPI schema.
6. Confirm only intended local and remote branches remain.

Do not rewrite dated audit documents to look current. Add a new dated audit if
a new evidence snapshot is useful.

## Validation Commands

Run the relevant focused tests during development, then the complete gate.

Frontend:

```sh
cd frontend
npm ci
npm run generate:types
git diff --exit-code -- src/api/schema.ts
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Repository/backend safety gate when the slice is ready to merge:

```sh
cd backend
POSTGRES_PASSWORD=kukgrade_local_password uv run ruff check .
POSTGRES_PASSWORD=kukgrade_local_password uv run ruff format --check .
POSTGRES_PASSWORD=kukgrade_local_password uv run mypy kukgrade health accounts audit ranks students syllabus gradings
DJANGO_DEBUG=true POSTGRES_PASSWORD=kukgrade_local_password uv run python manage.py check
DJANGO_DEBUG=true POSTGRES_PASSWORD=kukgrade_local_password uv run python manage.py makemigrations --check --dry-run
POSTGRES_PASSWORD=kukgrade_local_password uv run pytest
```

Also run `git diff --check` and inspect `git status --short` before every
commit. The CI workflow must pass after pushing `dev`.

## Git and Delivery Process

For each bounded slice:

1. Confirm `dev` and `origin/dev` point to the same commit.
2. Preserve any unrelated dirty work; use an isolated worktree if necessary.
3. Create a purpose-specific feature branch from current `dev`.
4. Implement only that slice.
5. Run focused tests and the proportional full gate.
6. Review the exact staged diff before committing.
7. Commit the feature branch.
8. Merge it into `dev` with an explicit merge commit.
9. Push `dev`.
10. Wait for GitHub CI to complete successfully.
11. Delete the merged feature branch locally and remotely.
12. Verify local `dev`, `origin/dev` and GitHub show the same head.

Do not merge directly to `prod`. Stable promotion remains a separate release
decision.

## Definition of Done

This handoff is complete when:

- the two remaining session confirmation dialogs meet the shared focus
  contract;
- all implemented routes pass the documented accessibility review;
- accessibility fixes have targeted regression coverage;
- `App.css` is split into coherent feature stylesheets without visual drift;
- `App.test.tsx` is split without losing tests or changing behaviour;
- current documentation accurately describes the resulting repository;
- no generated or local-only artifacts are tracked;
- frontend and backend validation gates pass;
- GitHub CI is green; and
- `dev` is clean and agrees with `origin/dev`.

## Explicitly Out of Scope

Do not add or design the following as part of this handoff:

- production hosting, containers, backup/restore or monitoring;
- offline/PWA persistence or synchronisation;
- reports, exports, certificates or notifications;
- worker infrastructure;
- a new syllabus-version model;
- new grading outcomes or roles; or
- visual redesign of the accepted workflow.

Those items require separate decisions. The confirmed outcomes remain Pass,
Fail and Conditional. Supported roles remain Instructor and Administrator;
Master authority remains three per-user permissions rather than a role.

## Suggested First Instruction to Claude

> Start from current `dev` and read `AGENTS.md` plus the documents listed in
> `docs/frontend-next-steps-handoff.md`. Implement Slice 1 only. Re-verify the
> two named dialogs against the live source before editing, add focused
> accessibility regression tests, run the complete frontend gate, review the
> staged diff, commit on a feature branch, merge to `dev`, push, wait for CI,
> and report changed files, commands, evidence and remaining risks. Preserve
> unrelated work and do not begin CSS modularisation in the same slice.
