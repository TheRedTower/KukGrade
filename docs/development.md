# Development

How to run KukGrade from source, check your changes, and keep dependencies current.
For the shape of the code, see [architecture.md](architecture.md); for how to submit
a change, [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/), for a local PostgreSQL
- [uv](https://docs.astral.sh/uv/), which installs Python 3.14 and the backend's dependencies
- Node 22.22.2 or newer (Vite 8 and jsdom 30 require it)

## Run it locally

```sh
# 1. PostgreSQL, bound to 127.0.0.1 only, data in .local/postgres/
docker compose up -d db

# 2. Backend (http://localhost:8000)
cd backend
export DJANGO_DEBUG=true            # development defaults: local database, no secret key needed
uv sync
uv run python manage.py migrate
uv run python manage.py issue_setup_code   # prints the one-time code for a fresh database
uv run python manage.py runserver 0.0.0.0:8000

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>, enter the setup code on the setup page and create the
first administrator. The API's health check is <http://localhost:8000/api/health/>.

With `DJANGO_DEBUG=true` the database defaults match `compose.yaml`, so no `.env`
file is needed. The Django browsable API is available only in debug. See
[configuration.md](configuration.md) for every setting.

## Checks

CI runs all of these on every push and pull request. Run them before opening a pull
request.

**Backend** (needs the local PostgreSQL):

```sh
cd backend
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run mypy about kukgrade health accounts audit ranks students syllabus gradings data_imports demo
DJANGO_DEBUG=true uv run python manage.py check
DJANGO_DEBUG=true uv run python manage.py makemigrations --check --dry-run
DJANGO_SETTINGS_MODULE=kukgrade.settings_test uv run python manage.py spectacular --file schema.yml --validate --fail-on-warn
git diff --exit-code -- schema.yml
uv run pytest -n auto
```

**Frontend:**

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

**Production image** (from the repository root):

```sh
docker build --target production -t kukgrade:ci .
.github/scripts/image-smoke.sh kukgrade:ci   # starts it as deployed, signs in, stops it cleanly
```

**Width check** (the demo image running on port 6943; see `frontend/e2e/README.md`):

```sh
cd frontend
npx playwright install chromium webkit   # once
npm run test:widths                 # every screen: Chrome at nine widths, WebKit as an iPhone and an iPad
```

The two `git diff --exit-code` steps prove the committed OpenAPI schema matches the
serializers and the committed frontend types match the schema.

## Conventions

- **Every feature has tests**: a success case, a validation case and a permission
  case where they apply. Sensitive writes also need an audit-event test. A bug fix
  comes with a test that fails without it.
- **Test data is synthetic.** Use `example.com` addresses and made-up names. Never
  commit real student data, exports, secrets or screenshots containing them.
- **Builders live in `testing.py`** inside their own app, never in another app's tests.
- **Frontend tests mock the API at the `./api` module boundary**, with fixtures declared
  `satisfies <GeneratedType>`, so a contract change breaks the test instead of hiding.
- **Never hand-write an API type** in the frontend. Declare the shape in the backend
  (`@extend_schema`), regenerate `schema.yml`, then `npm run generate:types`.
- **Layout numbers live in `frontend/src/layout.css`, nowhere else.** A screen adds its
  root class `page` (with `page--narrow`, `page--reading` or `page--wide`) and writes no
  width, gutter, max-width or breakpoint of its own; `layoutRules.test.ts` fails if a
  stylesheet adds a width query, `nowrap`, sideways scroll or fixed `min-width`. The
  legacy ones are counted in `layoutBaseline.json`, which only ever shrinks. Breakpoints
  (`compact` 40rem, `wide` 56rem) are in `layout.ts` and must match the CSS. If a screen
  does not fit at some width, look in `layout.css` and at how the screen uses it; nowhere else.
  Build with the shared pieces, not your own CSS: `ResponsiveTable` for every table (cards
  on a narrow page), `Dialog` for every modal (a sheet on a phone), `.filter-bar` and
  `.field` for filters, `.action-row` for a row of buttons or a header, `.stats` for key figures, `.split` for a main
  column with a side panel, `.crumbs` for the trail above a title, `Pagination` for page controls, `ScrollRail` for a row
  of choices too long for the screen (it moves a page at a time and shows only whole items; the
  one place a screen may scroll sideways). A `ResponsiveTable` has one
  `primary` column (the card's title) and at most one `actions: "inline"` column; `empty` replaces
  the table when there are no rows; `selected` marks the row a side panel shows; `flush` drops the border for a table that fills a card.
  `e2e/widthDebt.json` (Chrome) and `e2e/widthDebtWebkit.json` (per WebKit device) list screens that still do
  not fit: delete a screen from them when you fix it.
- **Colours, sizes and every other design value come from `frontend/src/theme.css` (tokens)
  or `layout.css` (widths and the shared pieces), and every class a screen uses is defined.**
  `tokenRules.test.ts` counts what each stylesheet still holds outside them (raw colours,
  dark-mode patches, `!important`, type, radius and shadow literals, z-index) and fails if
  the count goes up; `tokenBaseline.json` only ever shrinks. It also fails on a `var()`
  fallback, a token that is used but not defined (or defined but never used), a design token
  defined outside those two files, and a class used in the code that no stylesheet defines
  (`classBaseline.json` lists the legacy ones). After converting a screen, lower the lists with
  `UPDATE_TOKEN_BASELINE=1 npx vitest run src/tokenRules.test.ts`; the command refuses to
  raise anything. Before adding a style, look for the shared piece that already does it; if
  there is none and a second screen will want it, add it to `layout.css` or `theme.css`
  once, not to the screen.
- **A button is `<Button variant="primary|secondary|ghost|danger">`** (or a link given
  `buttonClass({ variant })`), styled in `frontend/src/controls.css` and nowhere else: primary
  for the one thing to do, secondary or ghost beside it, danger for what cannot be undone,
  `small` inside a table or card, `block` for one as wide as its box. Do not write a new
  `.xyz-btn` class; `tokenRules.test.ts` counts the button classes outside `controls.css`
  (`buttonClass`) and fails if the count goes up.
- **A badge is `<Badge tone="success|warning|danger|info|neutral">`** (a link given
  `badgeClass(tone)`), and a status the system defines has one component in `StatusBadge.tsx`
  (`SessionStatusBadge`, `StudentStatusBadge`, `AssessmentBadge`, `OutcomeBadge`,
  `RequirementBadge`): the one way to show it, so it cannot look different on two screens.
  Their look is in `controls.css`, and the status colours (`--color-status-*`) are tokens in
  `theme.css`, with a dark value each.
- **Database changes need a migration** and a test; model rules are tested at the model
  as well as through the API.
- **Keep syllabus and grading rules in the backend.** Components render what the API
  returns.

## Dependency updates

Nobody edits dependency versions or base-image digests by hand.
[Dependabot](../.github/dependabot.yml) opens a weekly pull request when a Python
package, an npm package, a GitHub Action, or a base image pinned in the `Dockerfile` has
a newer version. Each updates the manifest and its lockfile together and runs the full
CI. Merge one once its checks are green.

- Minor and patch updates arrive grouped; a major version gets its own pull request.
- A new Python or Node *line* is never proposed automatically: it is a decision. Change
  `python:3.14-slim` in the `Dockerfile`, `requires-python` and the tool targets in
  `backend/pyproject.toml` (then `uv lock`), `backend/.python-version`, `node:22-alpine`
  and `node-version` in `.github/workflows/ci.yml`, together.
- Held back on purpose (ignored in the Dependabot config): Django 6 and django-stubs 6
  (Django 5.2 is long-term support to 2028) and TypeScript 7 (`openapi-typescript` does
  not support it yet). Security updates are still taken.
- A package whose output is committed can fail CI until you add a follow-up commit to the
  Dependabot branch: `drf-spectacular` needs `schema.yml` regenerated,
  `openapi-typescript` needs `npm run generate:types`, and `ruff` may need `ruff format`.
- The PostgreSQL image is not tracked automatically: a new major version is a data
  migration (see [installation.md](installation.md#updating)).

## Releasing

Two long-lived branches carry the whole flow:

- **`dev`** is where work lands and where every release is tried first. Pull requests
  target it, and its CI must be green.
- **`prod`** is stable. It only ever receives what `dev` has already proved, never a
  change of its own. Proper releases are cut from it, and so is the demo site.

```text
feature branch ──PR──▶ dev ──tag vX.Y.Z-rc.N──▶ try it ──PR (merge commit)──▶ prod ──tag vX.Y.Z──▶ release
```

The version is a single number in `backend/kukgrade/version.py`, kept equal to
`backend/pyproject.toml` and `frontend/package.json` by a test.

1. **Bump the version** on `dev` in a pull request, as for any change.
2. **Cut a release candidate on `dev`**: `git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1`.
   The [Publish image](../.github/workflows/publish.yml) workflow builds
   `ghcr.io/theredtower/kukgrade:0.2.0-rc.1` for amd64 and arm64 on native runners, runs
   `manage.py check --deploy` and `.github/scripts/image-smoke.sh` on each, and only then
   publishes it. It never moves `latest`, and it shows the version it is a candidate for
   (`0.2.0`), told apart from the final release by its build commit. A production-ready build is still tried this way
   first.
3. **Try it.** Run the candidate as a real deployment (the image tag goes in the compose
   file), work through the checks that matter for the change, and fix what turns up on
   `dev`. Each fix is a new candidate (`-rc.2`, ...).
4. **Promote**: open a pull request from `dev` into `prod` and merge it with a merge commit
   (not a squash), so `prod` holds the same commits `dev` proved. Nothing is committed to
   `prod` directly.
5. **Release**: tag the merge on `prod` as `vX.Y.Z` (no `-rc`). The workflow publishes
   `0.2.0`, `0.2` and `latest`, plus the major from 1.0. The demo site, once there is one
   (see the [roadmap](roadmap.md)), follows `latest`.
6. **A fix to a release already out** takes the same road: it is made on `dev`, tried as a
   new candidate (`v0.2.1-rc.1`), promoted and tagged `v0.2.1`. There is no shortcut into
   `prod`, so `prod` is never ahead of `dev`.

The first stable release also needs the first promotion: `prod` starts as the repository's
first commit, so no `latest` exists until a pull request from `dev` has been merged into it
and tagged. A candidate publishes only its own tag, so pulling `latest` before then fails.

The workflow enforces the rules rather than trusting memory: a tag whose number is not
`VERSION` fails, a `-rc` tag must be on a commit that is on `dev`, and a stable tag must be
on a commit that is on `prod`. Running the workflow by hand from a branch does everything
except push, to rehearse a release.

Each tag also gets a page under
[Releases](https://github.com/TheRedTower/KukGrade/releases), with notes written from the
pull requests merged since the last one; a candidate is marked as a pre-release.

First time only: the package is private until it is made public (the package's own page,
Package settings, Change visibility).

### How the repository is protected

GitHub enforces the branch rules above, so they hold for everyone:

- `dev` and `prod` take changes only through a pull request that merges with a merge
  commit (no squash or rebase), and only once the four CI checks pass (Backend, Frontend,
  Frontend tests (non-UTC timezone), Production image). Force-pushes and deletion are
  blocked. The owner can bypass this only through a pull request.
- Tags matching `v*` cannot be moved or deleted.
- Secret scanning with push protection, Dependabot alerts and security updates, and private
  vulnerability reporting (the route [SECURITY.md](../SECURITY.md) names) are on.
- Branches are deleted when their pull request merges.
