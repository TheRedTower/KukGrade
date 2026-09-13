# Action Plan

This plan translates the existing project documents into a controlled implementation sequence. It should guide work without forcing premature scope.

## Current status

- Phase 0 documentation exists for product direction, data model, and API contract.
- `backend/` and `frontend/` contain runnable application foundations.
- Local PostgreSQL is configured through Docker Compose.
- Health checks and backend/frontend tests exist.
- Authentication and session/CSRF foundations are implemented.
- Student, rank, syllabus, grading session, assessment snapshot, and candidate
  outcome foundations are implemented.
- Explicit syllabus versioning, least-privilege role enforcement, audit events,
  promotion/rank history on `dev`, student API/UI, grading frontend workflows,
  CI, production hardening, and worker implementation remain pending.

## Phase 0 - Confirm Foundations

1. Confirm the initial product scope for V1.
2. Confirm the development workflow and repository layout before scaffolding code.
3. Confirm backend identity strategy: Django default user vs custom email-first user model.
4. Confirm frontend styling approach: plain CSS, Tailwind, component library, or a constrained design system.
5. Confirm local development strategy: native processes, Docker Compose, or both.
6. Confirm database strategy for local development and tests.

## Phase 1 - Repository Scaffold

1. Add root-level project tooling only after confirming package/runtime choices. Done.
2. Scaffold the Django backend in `backend/`. Done.
3. Scaffold the React + TypeScript frontend in `frontend/`. Done.
4. Add local environment examples and startup documentation. Done.
5. Add minimal health checks for API and web. Done.
6. Add CI only after the first runnable backend and frontend checks exist.

## Phase 2 - Core Domain Skeleton

1. Implement organisation, branch, role, rank, and student models. Partially
   done: custom user, role field, rank catalogue, and initial student model
   exist; organisation, branch, explicit active/inactive/left status, and
   production role policy remain pending.
2. Add serializers, viewsets, permissions, and admin configuration for those
   models. Partially done for auth, ranks, syllabus, and grading foundations;
   student API and least-privilege action rules remain pending.
3. Add frontend routes for login shell, dashboard shell, students list, and
   student detail. Login/protected shell exists; real routing and student
   screens remain pending.
4. Add focused tests for model constraints and API permissions. Existing tests
   are extensive for implemented foundations; role/action permission coverage
   remains pending.

## Phase 3 - Syllabus and Grading Workflow

1. Implement syllabus versions, categories, criteria, and rank pathways.
   Current implementation has syllabus items and requirements only; explicit
   versioning and publication remain pending.
2. Implement grading sessions, candidates, examiner assignments, assessments,
   scores, and final decisions. Grading sessions, candidates, assessment
   snapshots, item-level met/not-met results, outcome proposals, and final
   decisions exist; examiner assignments, scoring beyond met/not-met, and
   hardened integrity boundaries remain pending.
3. Build examiner-facing scoring flows and head-instructor decision flows in
   small increments. Backend foundations exist; frontend workflows remain
   pending.
4. Add audit events around final decisions, overrides, and rank-changing
   actions. Pending.

## Phase 4 - Reporting and Operational Maturity

1. Add basic outcome and rank-distribution reports.
2. Add promotion records and simple certificate metadata.
3. Defer full certificate rendering, eligibility automation, notifications, and worker infrastructure until the V1 workflow is stable.

## Decision rule

Every implementation slice should have a clear acceptance check before it starts. If a slice needs a structural choice, record the choice in `decision_log.md` first.

During the audit cleanup programme, `docs/audits/remediation-status.md` defines
the required stage order. Do not start new product features until the relevant
remediation gate is complete.
