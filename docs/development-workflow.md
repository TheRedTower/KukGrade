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

## Dependency updates

Nobody edits dependency versions or base-image digests by hand. Dependabot
(`.github/dependabot.yml`) opens a pull request every week when a Python package
(`backend/pyproject.toml` and `uv.lock`), an npm package (`frontend/package.json`
and `package-lock.json`), a GitHub Action, or a pinned base image in the
`Dockerfile` has a newer version. Each pull request changes the manifest and its
lockfile together and CI runs on it like on any other (tests in both time zones,
the build, `npm audit`; for a base image, the image build and a `check --deploy`
inside it). Merge one once its checks are green: nothing enforces that on this
plan. Codex reviews pull requests as they open; ask for a Copilot review on one
you want read.

- Minor and patch updates arrive grouped, one pull request per kind of
  dependency; a major version gets its own, to be read before it is merged.
- A new Python or Node *line* is never proposed: it is a decision. When you
  make one, change them together: `python:3.14-slim` in the `Dockerfile`,
  `requires-python` in `backend/pyproject.toml` (then run `uv lock`),
  `backend/.python-version` (what the CI's `uv sync` follows), `[tool.ruff]
  target-version` and `[tool.mypy] python_version` in the same file;
  `node:22-alpine` and the two `node-version: "22"` in
  `.github/workflows/ci.yml` (and the `@types/node` major).
- The PostgreSQL image (`compose.yaml`, the CI service in `ci.yml`) is not
  tracked at all: a new major is a data migration (`deployment.md`).
- Dependabot only regenerates a manifest and its lockfile. A package whose
  output is committed can fail CI until you add a follow-up commit to the
  Dependabot branch (after which Dependabot stops rebasing it): `drf-spectacular`
  needs `schema.yml` regenerated, `openapi-typescript` needs `npm run
  generate:types`, and a `ruff` update may need `ruff format`. Those are grouped
  apart so they do not hold the rest back.
- Three uv versions can touch `uv.lock`: the Dockerfile's (tracked), the CI's
  `setup-uv` (the latest) and Dependabot's own. The image build in CI catches a
  lock the image's uv cannot read.
- Watch that a digest-refresh pull request for the Python or Node image
  actually arrives within a few weeks: GitHub can suppress digest-only updates
  for unchanged tags on its side, which would silently stop the base's security
  fixes arriving.
- To update something by hand anyway, change the manifest and regenerate the
  lockfile (`uv lock`, `npm install`), then run the verification commands above.
