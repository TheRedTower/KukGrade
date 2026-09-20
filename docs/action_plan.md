# Action Plan

This plan translates the existing project documents into a controlled implementation sequence. It should guide work without forcing premature scope.

## Current status

- The Django/DRF backend implements the core grading domain, permissions,
  append-only audit events, user administration APIs, and promotion/rank
  history.
- The React frontend implements the main instructor workflow from student and
  session setup through assessment, final decision, and promotion.
- CI, generated OpenAPI types, local PostgreSQL Compose, and backend/frontend
  verification are in place.
- The Audit browser and administrator Users account-management flow are
  implemented. Dedicated attendance/no-show selection and the authorised
  locked-session withdrawal flow are also implemented. The next frontend work
  is accessibility verification and CSS modularisation.
- Production images/deployment/backups and offline/PWA behaviour are not
  implemented. Explicit syllabus versioning remains deferred by decision.

## Phase 0 - Confirm Foundations

Completed. The accepted stack, boundaries, identity model, local database, and
constrained CSS-token design direction are recorded in the decision log and
current-system documentation.

## Phase 1 - Repository Scaffold

1. Add root-level project tooling only after confirming package/runtime choices. Done.
2. Scaffold the Django backend in `backend/`. Done.
3. Scaffold the React + TypeScript frontend in `frontend/`. Done.
4. Add local environment examples and startup documentation. Done.
5. Add minimal health checks for API and web. Done.
6. Add CI only after the first runnable backend and frontend checks exist.

## Phase 2 - Core Domain Skeleton

Completed for the accepted V1 scope. Organisation/branch entities are not part
of the current implementation; do not infer that they are required from older
planning documents without a new decision.

## Phase 3 - Syllabus and Grading Workflow

1. Core grading workflow, immutable syllabus snapshots, category/item results,
   outcome decisions, promotion, and audit events: implemented.
2. Instructor frontend workflow: implemented, including bulk cohort
   registration, assessment preparation/start, marking, decisions, and
   promotion.
3. Audit event browser and administrator Users UI: implemented against the
   existing APIs.
4. Finish frontend accessibility and CSS modularisation without changing the
   accepted workflow.
5. Explicit syllabus version publication remains deferred; historical
   reproducibility is provided by immutable assessment snapshots.

## Phase 4 - Reporting and Operational Maturity

1. Complete production image, deployment, backup/restore, monitoring, and
   readiness work before describing the application as production-ready.
2. Decide whether offline operation is required before adding a PWA, IndexedDB,
   or synchronisation/outbox architecture.
3. Add reports/exports only from an accepted reporting specification.
4. Defer certificates, notifications, and worker infrastructure until a real
   accepted workload requires them.

## Decision rule

Every implementation slice should have a clear acceptance check before it starts. If a slice needs a structural choice, record the choice in `decision_log.md` first.

Dated audit files are evidence snapshots, not live task lists. Re-verify a
finding against the current branch before implementing it.
