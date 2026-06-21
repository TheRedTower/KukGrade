# Documentation Index

This directory is the current source of truth for KukGrade planning. Treat these documents as planning inputs until the relevant implementation decisions are accepted in `decision_log.md`.

## Primary Documents

- `product-requirements.md` - product goals, users, confirmed requirements, proposed scope, and unresolved product decisions.
- `architecture.md` - modular monolith architecture, backend/frontend boundaries, data storage, deployment direction, and deferred worker guidance.
- `domain-model.md` - core domain concepts, proposed entities, grading lifecycle, and historical reproducibility rules.
- `syllabus-model.md` - data-driven versioned syllabus model and historical grading references.
- `permissions.md` - roles, backend permission enforcement, privacy rules, and audit requirements.
- `testing-strategy.md` - expected backend, frontend, permission, audit, and contract testing coverage.
- `development-workflow.md` - repository workflow, sequencing, definition of done, and unresolved engineering choices.

## Supporting Planning Inputs

- `action_plan.md` - earlier sequenced implementation plan.
- `api_contract.md` - earlier draft REST API surface.
- `data_model.md` - earlier detailed data model notes.
- `decision_log.md` - decisions that must be confirmed before implementation work proceeds.
- `grading_app_planning.md` - earlier product direction and phased implementation notes.

## Working Agreement

Use the primary documents first. The supporting planning inputs are useful context, but some terms need reconciliation before implementation. In particular, older documents mention outcomes such as defer or reassess; the confirmed final outcomes are Pass, Fail, and Conditional.

Before each meaningful implementation step, confirm the relevant unresolved decisions, keep the change small, and update the decision log when a choice affects structure, dependencies, data shape, user workflows, or long-term maintainability.
