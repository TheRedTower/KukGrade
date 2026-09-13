# Testing Strategy

## Confirmed Expectations

- Every feature requires success, validation, and permission tests where applicable.
- Database changes require migrations and tests.
- Existing relevant tests must pass before finishing a change.
- Formatting, linting, and type checks should pass before finishing implementation work.
- Use explicit fixtures and anonymised or synthetic test data.
- Do not use real student data in tests, fixtures, screenshots, or seed files.

## Backend Testing

Backend test coverage should include:

- model constraints and relationships.
- serializer validation.
- DRF endpoint success paths.
- DRF endpoint validation failures.
- role and object-level permission boundaries.
- grading workflow state transitions.
- assessment snapshot immutability across API, service, model, admin, queryset,
  database, and concurrency paths as applicable.
- syllabus version immutability and historical references once versioning is
  implemented.
- age-band and syllabus-version selection behavior once version selection is
  implemented.
- audit events for sensitive writes once audit events are implemented.
- promotion or rank-change behavior once the promotion process is accepted on
  top of the hardened domain.

Backend tests run with `pytest`:

```sh
cd backend
uv run pytest
```

Database-backed model and migration tests should run against local PostgreSQL:

```sh
docker compose up -d db
cd backend
uv run python manage.py migrate
uv run pytest
```

## Frontend Testing

Planned frontend test coverage:

- route-level rendering for main workflows.
- form validation states.
- API integration boundaries using mocked responses.
- permission-aware UI states.
- assessment draft editing flows.
- final decision review screens.
- syllabus rendering from API data rather than hard-coded rules.

React Testing Library with Vitest is configured.

## Contract And Workflow Testing

API behavior should be covered by tests before frontend work depends on it. When API contracts change:

- update documentation.
- update backend tests.
- update frontend API client types or mocks.
- update frontend tests that depend on the changed behavior.

## Test Data Rules

- Use synthetic names, membership numbers, branches, and comments.
- Keep fixtures explicit and small.
- Include examples across ranks and age bands only when needed for the behavior under test.
- Do not include production exports or copied real grading comments.

## Current Verification Commands

Backend:

```sh
docker compose up -d db
cd backend
uv sync --frozen
uv run python manage.py migrate
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py check
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts ranks students syllabus gradings
```

Frontend:

```sh
cd frontend
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
```

## Unresolved Decisions

- Whether to add end-to-end browser tests in V1.
- Whether API schema generation is required before frontend scaffolding.
- Whether test data factories should use a package or plain fixtures.
- How concurrency tests should be structured for the grading aggregate.
