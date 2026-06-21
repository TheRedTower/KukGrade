# Action Plan

This plan translates the existing project documents into a controlled implementation sequence. It should guide work without forcing premature scope.

## Current status

- Phase 0 documentation exists for product direction, data model, and API contract.
- `backend/` and `frontend/` contain the initial runnable application foundation.
- Local PostgreSQL is configured through Docker Compose.
- Health checks and first tests exist.
- Domain features, authentication, syllabus, grading, and worker implementation are still deferred.

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

1. Implement organisation, branch, role, rank, and student models.
2. Add serializers, viewsets, permissions, and admin configuration for those models.
3. Add frontend routes for login shell, dashboard shell, students list, and student detail.
4. Add focused tests for model constraints and API permissions.

## Phase 3 - Syllabus and Grading Workflow

1. Implement syllabus versions, categories, criteria, and rank pathways.
2. Implement grading sessions, candidates, examiner assignments, assessments, scores, and final decisions.
3. Build examiner-facing scoring flows and head-instructor decision flows in small increments.
4. Add audit events around final decisions, overrides, and rank-changing actions.

## Phase 4 - Reporting and Operational Maturity

1. Add basic outcome and rank-distribution reports.
2. Add promotion records and simple certificate metadata.
3. Defer full certificate rendering, eligibility automation, notifications, and worker infrastructure until the V1 workflow is stable.

## Decision rule

Every implementation slice should have a clear acceptance check before it starts. If a slice needs a structural choice, record the choice in `decision_log.md` first.
