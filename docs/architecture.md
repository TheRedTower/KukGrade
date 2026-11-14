# Architecture

KukGrade is a **modular monolith**: one Django/DRF backend, one React frontend and
one PostgreSQL database, shipped as a single container. There are no microservices
and no background worker; one will be added only when something genuinely has to run
asynchronously.

```mermaid
flowchart LR
    U[Browser] -- HTTPS --> C
    subgraph C [One container]
        direction LR
        F[React + TypeScript<br/>built static files] --- B[Django + DRF API<br/>Gunicorn]
        B --- D[(PostgreSQL 17)]
    end
```

| Layer | Technology |
| --- | --- |
| Backend | Python 3.14, Django 5.2 (LTS), Django REST Framework, drf-spectacular, ReportLab (the PDFs) |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, openapi-fetch, plain CSS on design tokens, one shipped typeface (Pretendard) |
| Database | PostgreSQL 17 |
| Testing | pytest (pypdf to read the PDFs), Vitest and React Testing Library; Playwright for the width check (dev only) |
| Quality | Ruff, mypy, ESLint, Stylelint, Prettier, GitHub Actions |
| Packaging | One multi-stage `Dockerfile`; WhiteNoise serves the built frontend |

## Repository layout

```
backend/    Django project and apps (API, domain rules, tests)
frontend/   React app (screens, components, generated API types)
deploy/     Docker Compose files for running the image anywhere
docs/       This documentation
Dockerfile  The production image
```

## Backend apps

| App | Owns |
| --- | --- |
| `kukgrade` | Settings, routing, the error envelope, pagination, query filters, serving the frontend |
| `accounts` | Email-first staff users, role groups, per-user authority permissions, password policy, first-administrator setup |
| `audit` | The append-only `AuditEvent` log and the single `record()` function that writes it |
| `ranks` | The seeded rank catalogue |
| `students` | Students, status, WKSA IDs, rank and grading history |
| `syllabus` | Syllabus items, per-rank and age-band requirements, and the cumulative resolver |
| `gradings` | Sessions, candidates, assessment snapshots, outcomes, promotions, imported legacy records, the PDF exports (`gradings/exports/`) |
| `data_imports` | Import batches and stored rows; roster import and the historical workbook adapter |
| `about` | What is running and on what terms: the project's own facts (`project.py`), its documents read from the repository's files, the Kuk Sool Won pledge, and the credits written when an image is built |
| `health` | Liveness and database checks used by the container health check |

## Principles

**The backend is the authority.** Permission checks, grading rules and syllabus
rules live in the backend and are exposed through the API. The frontend reflects
what the server says is allowed (for example, a candidate carries `can_be_moved`),
and never hard-codes a rule.

**Services own every state change.** Each app has a `services.py` that validates a
change, writes it in a transaction, and records its audit event in that same
transaction. The view calls the service: a serializer reads and checks the request
and never saves (`kukgrade.serializers.ModelSerializer` refuses to), and the view hands
what it checked to the service with the acting user, so a change is validated and
audited the same way every time. Every viewset is a `KukGradeViewSet`
(`kukgrade/viewsets.py`): no PUT, so an edit is a PATCH of what changes; a delete goes
through the app's own delete service; and every bulk action has one shape (`run_bulk`). The Django admin does not write grading or student
data at all: it shows it, and recovers accounts.

**Models refuse the worst mistakes themselves.** Deletion rules, and the immutability of
finalised outcomes, promotions, audit events and imported source text, are enforced in the
models and their querysets, so they hold from a shell or a bulk query, not only through
the API. Workflow rules are different: what a grading session may become (it starts in
draft and moves only through `transition_grading_session`), when its date may change, and
who may be registered for it, when a registration may change, move or be reinstated, and how
an outcome moves from proposed to final, are enforced by the services, under the session's lock, in one place. The database still
refuses an invalid status; a registration is always the same student's, and a final decision
never changes.

**Permissions fail closed.** Every API viewset declares a `permission_map` per action;
an action that is not declared is denied. The two gates applied to every request (a required password
change, and the demo's closed changes) are decided on the resolved view's name, never
its path (`kukgrade/middleware.py`). Django permissions are the authority; the
`role` field is only a label that decides group membership.

**History is reproducible.** Generating an assessment copies every requirement's text
into immutable per-candidate rows, so editing the syllabus later cannot change a past
grading. Promotions, finalised outcomes, item comments, mark changes and audit events
are immutable, by one guard (`kukgrade/kept.py`); imported records are voided, never
deleted.

**One lock protocol.** Concurrent grading writes lock the grading session first, then
any students in ascending id order, and validate only against rows re-read under those
locks (`gradings/locking.py`). Bulk endpoints process each row independently in its own
savepoint and report per-row errors, so one bad row does not block the rest.

**The schema is the contract.** Every request and response is declared in the backend
and published as `backend/schema.yml` (OpenAPI). The frontend's TypeScript types are
generated from it, and CI fails if either drifts. See [api.md](api.md).

## Frontend

React with React Router and TanStack Query; styling is one stylesheet per feature on
the design tokens in `frontend/src/theme.css` (a warm gold-on-charcoal palette with
light and dark themes). API types are generated into `frontend/src/api/schema.ts`, and
`frontend/src/api.ts` holds the fetch functions. They call one `openapi-fetch` client typed
from those paths, so each call's path, parameters, body and answer are the schema's and
none is written by hand; the client adds the CSRF token and turns the error envelope into
an `ApiError`. Tests stand in for the server with `stubFetch` (`appTestSupport.ts`).
`frontend/src/queryKeys.ts` names every
query and mutation the app keeps (`keys`; a lint rule refuses a key written anywhere else)
and says what to read again after the changes several screens make (`refresh`), so a screen
that changes data and one that shows it agree. `frontend/src/queries.ts` says how long
reference data is kept: ranks, age bands, the choices and the About pages are read once a
visit, the site settings every five minutes, and records again on every visit. Every screen
is in the one bundle; only the About documents' Markdown reader is loaded on its own.

Two behaviours worth knowing:

- **Sign-in state has four values**, not three: `loading`, `authenticated`, `anonymous`
  and `error`. `anonymous` needs a real answer from the server that nobody is signed in (a 401, or a
  403 with `authentication_required`). A dropped
  connection or a 5xx is `error`, with a retry, so a backend hiccup never signs
  someone out mid-grading. Signing out clears local state only after the server
  confirms.
- **API errors** arrive in one envelope and are surfaced as an `ApiError` carrying
  `status`, `code` and per-field `fields`, so domain-rule failures can be shown as a
  message without inspecting individual fields.

## The production image

A multi-stage build compiles the frontend, installs locked Python dependencies and
copies a finished, minimal filesystem into a fresh image. It contains the app,
PostgreSQL 17 and nothing else needed to run or repair it: no tests, documentation,
build tools or package-manager caches. Its first process starts as root only to hand the
data folder to the app's user, then runs the database and the app as an unprivileged user
(UID 10001); started as that user already, as the external-database recipe does, it never
has root and that recipe can be read-only with all capabilities dropped. Base images are
pinned by digest and kept current by Dependabot.

On start, `kukgrade.serve` starts the image's own PostgreSQL (unless `POSTGRES_HOST`
points elsewhere), applies migrations, then starts one Gunicorn worker. The Django admin
site is not mounted on the network app. See [installation.md](installation.md).

## Decisions worth knowing

- **Why one worker?** Sign-in throttling uses process-local memory. Scaling out needs a
  shared cache first.
- **Why no SQLite?** A SQLite fallback once existed and could not actually run this
  application, so it was removed rather than half-supported.
- **Why no syllabus versioning?** Copying requirement text into each assessment already
  makes history reproducible. An explicit published-version entity is deferred.
- **Why is "Master" not a role?** The authority to decide, promote and override is
  granted per person, so a school can assign it to one instructor without a third tier
  of role.
