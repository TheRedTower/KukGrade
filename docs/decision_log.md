# Decision Log

Use this log for decisions that shape maintainability, project structure, dependencies, domain behavior, or user workflows. Keep entries short and concrete.

## Template

```md
### YYYY-MM-DD - Decision title

Status: Proposed | Accepted | Rejected | Superseded

Decision:

Context:

Consequences:
```

## Accepted decisions

### 2026-06-21 - Identity and session authentication foundation

Status: Accepted

Decision:
Use a custom Django user model with UUID primary keys, unique normalised email login, primary roles of instructor, manager, and administrator, and a separate `can_make_final_grading_decision` capability. Use Django session authentication for the React frontend rather than token authentication.

Context:
The authentication and user-model strategy were unresolved. The identity foundation needs to support staff-only access, backend-enforced permissions, Django admin management, and future branch-scoped access work without storing frontend auth tokens.

Consequences:
`AUTH_USER_MODEL` is `accounts.User`. React uses cookie-backed requests with CSRF protection and does not store credentials or tokens in local storage. Authorised Master final-decision authority is represented by capability for now, independent of the primary role. Branch- or organisation-scoped role assignments remain unresolved and out of scope for this slice.

### 2026-06-21 - Repository layout

Status: Accepted

Decision:
Use a simple monorepo with `backend/`, `frontend/`, and `docs/` as top-level boundaries.

Context:
The initial foundation request uses `backend/` and `frontend/`. Earlier planning documents used `api/` and `web/`, but no application code existed in those placeholders.

Consequences:
This keeps backend and frontend work isolated while avoiding premature package-level complexity. Worker implementation remains deferred until there is a real asynchronous workload.

### 2026-06-21 - Implementation sequencing

Status: Accepted

Decision:
Use `docs/action_plan.md` as a guide, but confirm each meaningful implementation slice before coding it.

Context:
The project has a detailed plan, but the user wants each decision clarified before implementation to avoid sprawl and preserve maintainability, efficiency, and usability.

Consequences:
Work should proceed in small, reviewable increments. Large scaffolding, dependency additions, schema changes, and UI workflow choices should be explicitly agreed before implementation.

### 2026-06-21 - Backend stack

Status: Accepted

Decision:
Use Django and Django REST Framework for the backend.

Context:
The planning and API documents are written around Django, DRF, Django auth, Django models, serializers, and viewsets.

Consequences:
Backend implementation should follow Django conventions unless a later decision supersedes this. The first unresolved backend choice is whether to use Django's default user model or a custom email-first user model.

### 2026-06-21 - Frontend stack

Status: Accepted

Decision:
Use React, TypeScript, and Vite for the frontend foundation.

Context:
The planning document recommends this stack for a coded prototype that can evolve into the final application. Routing and server-state libraries are deferred until screens and API workflows are confirmed.

Consequences:
Frontend implementation should be scaffolded around these tools. Styling, routing, and server-state choices remain open until they are needed.

### 2026-06-21 - Local development foundation

Status: Accepted

Decision:
Use native backend and frontend development servers with Docker Compose providing local PostgreSQL.

Context:
The initial foundation needs a runnable backend, frontend, and local database without committing production Docker image decisions.

Consequences:
`compose.yaml` starts PostgreSQL only. Production image layout and CI remain unresolved.

## Open decisions
