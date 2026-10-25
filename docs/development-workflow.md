# Development Workflow

## Working rules

- Inspect existing docs, code, tests, and contracts before changing
  implementation.
- Prefer small, reviewable slices, and avoid unrelated changes.
- Do not add dependencies without explaining their purpose.
- Do not change an API contract silently: update `backend/schema.yml`, the
  generated frontend types, `api_contract.md`, and tests in the same change.
- Keep a worker dormant until there is a real asynchronous workload.
- Use anonymised or synthetic data only. Never commit secrets, credentials,
  production exports, or real student data - including in fixtures,
  screenshots, and seed files.
- Dated audit documents are snapshots. Verify a finding against the current
  branch before treating it as work.

## Testing expectations

- Every feature needs success, validation, and permission tests where they
  apply; sensitive writes also need an audit-event test.
- Database changes need migrations and tests. Model rules are tested at the
  model as well as the API, since admin and the shell bypass the API.
- A defect fix lands with a test that fails without the fix.
- Keep fixtures explicit and small. Shared builders live in each app's
  `testing.py` (for example `kukgrade/testing.py`, `data_imports/testing.py`),
  never in another app's `tests.py`.
- Frontend tests mock the API at the `./api` module boundary with responses in
  the generated schema's shape, so a contract change breaks the test rather
  than hiding behind a hand-made fixture. Declare each fixture with
  `satisfies <GeneratedType>` (or a type annotation), never an `as` cast:
  `jsonResponse` takes `unknown`, so an untyped fixture is not checked at all
  and silently keeps fields the API no longer serves.

## Verification commands

CI runs all of these on every push and pull request. Run them before
finishing a change.

Backend (needs the local PostgreSQL from `docker compose up -d db`):

```sh
cd backend
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings data_imports
DJANGO_DEBUG=true uv run python manage.py check
DJANGO_DEBUG=true uv run python manage.py makemigrations --check --dry-run
DJANGO_SETTINGS_MODULE=kukgrade.settings_test uv run python manage.py spectacular --file schema.yml --validate --fail-on-warn
git diff --exit-code -- schema.yml
uv run pytest -n auto   # in parallel, one test database per core; plain `uv run pytest` runs serially
```

Frontend:

```sh
cd frontend
npm ci
npm run generate:types
git diff --exit-code -- src/api/schema.ts
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --audit-level=high
```

The two `git diff --exit-code` steps prove the committed OpenAPI schema
matches the serializers, and the committed frontend types match the schema.

Local database:

```sh
docker compose up -d db
cd backend
uv run python manage.py migrate
```

The local Compose database binds PostgreSQL to `127.0.0.1` only and stores data
under `.local/postgres/`, which Git ignores. Use `.env` for local overrides.
Production commands live in `deployment.md`.
