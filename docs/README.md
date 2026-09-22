# Documentation Index

This directory contains both current-state documentation and older planning
inputs. Treat `current-system.md` as the current-state authority. Use accepted,
non-superseded entries in `decision_log.md` for decisions and the requirements
documents for intended scope, not as proof that something is implemented.

## Primary Documents

- `current-system.md` - exact implemented architecture, endpoints, entities,
  known gaps, and deferred areas for the current `dev` baseline.
- `data-import-and-legacy-migration.md` - implemented bulk student-roster
  import and historical KSW Colchester grading-workbook migration: the
  `ImportBatch` lifecycle, the workbook adapter, rank review,
  `LegacyGradingRecord` immutability/reconciliation, and the unified
  grading-history read model.
- `product-requirements.md` - product goals, users, confirmed requirements, proposed scope, and unresolved product decisions.
- `architecture.md` - modular monolith architecture, backend/frontend boundaries, data storage, deployment direction, and deferred worker guidance.
- `domain-model.md` - core domain concepts, proposed entities, grading lifecycle, and historical reproducibility rules.
- `syllabus-model.md` - data-driven versioned syllabus model and historical grading references.
- `permissions.md` - roles, backend permission enforcement, privacy rules, and audit requirements.
- `testing-strategy.md` - expected backend, frontend, permission, audit, and contract testing coverage.
- `development-workflow.md` - repository workflow, sequencing, definition of done, and unresolved engineering choices.
- `audits/2026-09-13-independent-repository-audit.md` and
  `audits/2026-09-15-post-completion-audit.md` - dated audit snapshots; verify
  their findings against current code before acting.

## Supporting Planning Inputs

- `action_plan.md` - current high-level implementation sequence.
- `frontend-next-steps-handoff.md` - current implementation handoff for the
  remaining frontend accessibility, stylesheet modularisation, test
  modularisation, validation, and delivery work.
- `api_contract.md` - mixed implemented and target REST API surface; check
  section labels before treating an endpoint as real.
- `data_model.md` - target/legacy detailed data model notes, not the current
  schema.
- `decision_log.md` - accepted decisions and their reasoning.
- `audits/remediation-status.md` - historical H/M/L register superseded by the
  KG-numbered audits; retained for traceability.
- `grading_app_planning.md` - earlier product direction and phased
  implementation notes, retained as legacy planning context.

## Working Agreement

Use the primary documents first. The supporting planning inputs are useful context, but some terms need reconciliation before implementation. In particular, older documents mention outcomes such as defer or reassess; the confirmed final outcomes are Pass, Fail, and Conditional.

Before each meaningful implementation step, confirm the relevant unresolved
decisions, keep the change small, and update the decision log when a choice
affects structure, dependencies, data shape, user workflows, or long-term
maintainability. During audit remediation, follow the stage boundaries in
the current code and the relevant dated audit evidence.
