# Documentation Index

This directory contains both current-state documentation and older planning
inputs. Treat `current-system.md`, `product-requirements.md`, accepted
non-superseded entries in `decision_log.md`, and `audits/remediation-status.md`
as the primary sources before implementation.

## Primary Documents

- `current-system.md` - exact implemented architecture, endpoints, entities,
  known gaps, and deferred areas for the current `dev` baseline.
- `product-requirements.md` - product goals, users, confirmed requirements, proposed scope, and unresolved product decisions.
- `architecture.md` - modular monolith architecture, backend/frontend boundaries, data storage, deployment direction, and deferred worker guidance.
- `domain-model.md` - core domain concepts, proposed entities, grading lifecycle, and historical reproducibility rules.
- `syllabus-model.md` - data-driven versioned syllabus model and historical grading references.
- `permissions.md` - roles, backend permission enforcement, privacy rules, and audit requirements.
- `testing-strategy.md` - expected backend, frontend, permission, audit, and contract testing coverage.
- `development-workflow.md` - repository workflow, sequencing, definition of done, and unresolved engineering choices.
- `audits/remediation-status.md` - repository audit findings, stage order, and
  remediation status.

## Supporting Planning Inputs

- `action_plan.md` - earlier sequenced implementation plan, now updated with
  current foundation status.
- `api_contract.md` - mixed implemented and target REST API surface; check
  section labels before treating an endpoint as real.
- `data_model.md` - target/legacy detailed data model notes, not the current
  schema.
- `decision_log.md` - decisions that must be confirmed before implementation work proceeds.
- `grading_app_planning.md` - earlier product direction and phased
  implementation notes, retained as legacy planning context.

## Working Agreement

Use the primary documents first. The supporting planning inputs are useful context, but some terms need reconciliation before implementation. In particular, older documents mention outcomes such as defer or reassess; the confirmed final outcomes are Pass, Fail, and Conditional.

Before each meaningful implementation step, confirm the relevant unresolved
decisions, keep the change small, and update the decision log when a choice
affects structure, dependencies, data shape, user workflows, or long-term
maintainability. During audit remediation, follow the stage boundaries in
`audits/remediation-status.md`.
