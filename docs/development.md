# Development

How to run KukGrade from source, check your changes, and keep dependencies current.
For the shape of the code, see [architecture.md](architecture.md); for how to submit
a change, [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/), for a local PostgreSQL
- [uv](https://docs.astral.sh/uv/), which installs Python 3.14 and the backend's dependencies
- Node 22.22.2 or newer (Vite 8 and jsdom 31 require it)

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

The dev server forwards `/api` to the backend, so the browser only ever talks to
<http://localhost:5173>. Open it, enter the setup code on the setup page and create the
first administrator. The API's health check is <http://localhost:8000/api/health/>.

Each app's migrations were rebuilt from scratch on 13 November 2026, before any club
had installed KukGrade: one `0001_initial` each, plus a seed for the ranks and one for
the syllabus. A database made before then cannot follow them; recreate it (drop the
database, then `migrate`).

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
uv export --frozen --no-emit-project -o /tmp/requirements.txt
uvx pip-audit@2.10.1 -r /tmp/requirements.txt --disable-pip   # known vulnerabilities, like npm audit below
uv run ruff check .
uv run ruff format --check .
uv run mypy .
DJANGO_DEBUG=true uv run python manage.py check
DJANGO_DEBUG=true uv run python manage.py makemigrations --check --dry-run
DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')" DJANGO_DEBUG=false DJANGO_ALLOWED_HOSTS=kukgrade.example.com uv run python manage.py check --deploy --fail-level WARNING
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
npm run lint        # ESLint, then Stylelint (stylelint.config.mjs) for the CSS
npm run format:check   # Prettier (.prettierrc.json); `npm run format` rewrites the files
                       # (blame skips the reformat: git config blame.ignoreRevsFile .git-blame-ignore-revs)
npm run knip        # unused files, exports and dependencies (knip.json leaves out the generated types)
npm run typecheck
npm run test
npm run build
npm audit --audit-level=high
```

**Production image** (from the repository root):

```sh
docker build --target production -t kukgrade:ci .
.github/scripts/image-smoke.sh kukgrade:ci   # starts it as deployed, signs in, stops it cleanly (--keep-demo leaves the demo on 6943)
```

**Width check** (the demo image running on port 6943; see `frontend/e2e/README.md`):

```sh
cd frontend
npx playwright install chromium webkit   # once
npm run test:widths                 # every screen: Chrome at nine widths, WebKit as an iPhone and an iPad (CI: four widths, nine on a release tag)
```

The two `git diff --exit-code` steps prove the committed OpenAPI schema matches the
serializers and the committed frontend types match the schema.

## Conventions

- **Every feature has tests**: a success case, a validation case and a permission
  case where they apply. Sensitive writes also need an audit-event test. A bug fix
  comes with a test that fails without it.
- **A rule covers every path, and every promise has a test.** When a rule says "never" or
  "only when" (a final decision is never erased, outcomes move only in a locked session, a band
  needs a syllabus), find every code path that does that act, not just the one in front of you,
  and test each. Anything `features.md` or `privacy.md` promises is proved by a test; write
  those pages from the code, not from memory. A rule the server owns reaches the screen as a
  field (`can_*`, `next_action`), and the screen never compares statuses to work it out again.
- **Test data is synthetic.** Use `example.com` addresses and made-up names. Never
  commit real student data, exports, secrets or screenshots containing them.
- **Builders live in `testing.py`** inside their own app, never in another app's tests.
- **Frontend tests mock the API at the `./api` module boundary**, or stand in for the
  server with `stubFetch` (`appTestSupport.ts`, never `vi.stubGlobal("fetch")` directly,
  since the client sends a `Request`), with fixtures declared `satisfies <GeneratedType>`,
  so a contract change breaks the test instead of hiding. Answer GET requests with
  `serve({ "/api/students/{id}/": student, ... })`: each key is a schema path and each value
  must be that path's response type, and a list's page comes from `page()`. A test file
  moves to `serve` when a change already touches it.
- **Never hand-write an API type** in the frontend. Declare the shape in the backend
  (`@extend_schema`), regenerate `schema.yml`, then `npm run generate:types`.
- **Layout numbers live in `frontend/src/layout.css`, nowhere else**, and the page is the
  only thing that scrolls. See [Layout](#layout).
- **Build with the shared pieces, not your own CSS.** There is one piece for each job; see
  [Shared pieces](#shared-pieces).
- **Colours, sizes and every other design value come from `frontend/src/theme.css` (tokens)
  or `layout.css` (widths and the shared pieces), and every class a screen uses is defined.**
  See [Design values](#design-values).
- **A button is `<Button variant="primary|secondary|ghost|danger|danger-quiet|link">`** (or a link given
  `buttonClass({ variant })`), styled in `frontend/src/controls.css` and nowhere else: primary
  for the one thing to do, secondary or ghost beside it, danger for what cannot be undone, danger-quiet for a smaller risky action in a list, link for one that reads as a link,
  `small` inside a table or card, `block` for one as wide as its box, `icon` for one that is only an icon (its words in its `aria-label`). A screen may add a class for its own place and colours (the navigation rail's ink), never its own type. Do not write a new
  `.xyz-btn` class; `tokenRules.test.ts` fails on a button class outside `controls.css`.
- **A badge is `<Badge tone="success|warning|danger|info|neutral">`** (a link given
  `badgeProps(tone)`), and a status the system defines has one component in `StatusBadge.tsx`
  (`SessionStatusBadge`, `StudentStatusBadge`, `AssessmentBadge`, `OutcomeBadge`,
  `RequirementBadge`): the one way to show it, so it cannot look different on two screens.
  Their look is in `controls.css`; a tone is a `data-tone` attribute, written once there for badges, marks and a chosen outcome alike, and the status colours (`--color-status-*`) are tokens in
  `theme.css`, with a dark value each.
- **A link in running text is a plain `<Link>` or `<a>`, with no class.** `App.css` gives every
  unclassed link one look (the accent, underlined, the same once visited), and `layout.css`
  gives a name in a `ResponsiveTable` the cell's own colour with an accent underline and a
  full-size target. A link with a class is a component (a button, badge or navigation item)
  and styles itself. A screen never colours or underlines its own links.
- **Text wraps by one inherited rule**, `overflow-wrap: break-word` on `body` in `App.css`: it
  breaks between words, and inside a word only when the word cannot fit on a line of its own.
  A screen does not set `overflow-wrap`, and nothing uses `anywhere`, which lets a table
  squeeze a column to one letter wide and split ordinary words.
  A date never splits: the formatters in `dates.ts` (`formatRecentTime` for "Today 14:30") join its
  parts with no-break spaces (it may break only after a comma), so a screen shows a date only through them.
- **A view calls the service; a serializer never saves.** A viewset is a `KukGradeViewSet`
  and its serializers are `kukgrade.serializers.ModelSerializer`; `perform_create` and
  `perform_update` hand the checked data to the app's service, a delete names its service
  (`ServiceDestroyMixin`), a bulk action goes through `run_bulk`, and an action's own
  query parameters are declared (`query_filters=` on the action, or a query serializer
  read with `read_query`), never parsed by hand. `kukgrade/test_view_machinery.py` holds it.
- **Database changes need a migration** and a test; model rules are tested at the model
  as well as through the API.
- **Keep syllabus and grading rules in the backend.** Components render what the API
  returns.

### Layout

- A screen adds its root class `page` (one width for every page) and writes no width,
  gutter, max-width or breakpoint of its own. Breakpoints (`compact` 40rem, `wide` 56rem)
  are in `layout.ts` and must match the CSS.
- `layoutRules.test.ts` fails if a stylesheet adds `nowrap`, sideways scroll, a fixed
  `min-width`, a width query that is not at a breakpoint, a box that scrolls up and down
  inside the page, or a new `auto-fit` grid.
- **The page is the only scroller.** A box scrolling inside it traps a swipe and hides what
  is under it. A side panel stays in view with `.split__aside` and `stickyAside`; a bar at
  the foot of the window with `position: sticky; bottom: 0` (and `footBar` when a side panel
  must stay above it); long text reads in the page, folded in a `.disclosure` if need be.
  The sidebar beside the page and a dialog over it are the two exceptions.
- `.page` stacks its sections itself: header to content is always `--space-6`, section to
  section `--section-gap`. A section never sets its own margin, and a stack clears its
  sections' default margins.
- Every screen must fit at every width; there is no list for parking one that does not. If
  a screen does not fit at some width, look in `layout.css` and at how the screen uses it;
  nowhere else.

### Shared pieces

Before adding a style, look for the piece that already does the job. If there is none and a
second screen will want it, add it to `layout.css` or `theme.css` once, not to the screen.

**Page structure**

| For | Use |
| --- | --- |
| A screen's root | `.page` |
| A page's title area (title, subtitle, way back, the page's actions) | `PageHeader`, with `back` and `actions` |
| The one way back: to the page this one was opened from, named by its title, or to the page above when it was opened any other way | `BackLink`, inside a `PageHeader` or on its own (`pageTrail.ts`; a `PageHeader` names its page, and a screen without one calls `usePageLabel`) |
| A record's page until its record is there (loading, not found, could not be loaded, each with the way back) | `RecordPage` with `recordStatus` and `useIdParam` |
| A boxed section | `.card` (`.card--flush` when its contents bring their own padding) |
| A box of sections or fields that is not the page (a card, a form) | `.stack` (`--1` to `--4` and `--6` for parts that sit closer, a step of the space scale) |
| Things side by side on one line | `.row` (`--wrap`, `--inline`, `--1`, `--3`, `--4`) |
| Cards, fields or facts side by side that wrap onto more rows | `.tiles`: each at least `--tile-min` (14rem; `--narrowest` 10rem, `--narrow` 12rem, `--broad` 18rem, `--broadest` 20rem), `.tile-full` for one on a row of its own. A short last row shares its width, so a row never ends in a gap (the width check fails on one that does) |
| A set that always holds the same number of things | `.even-set` around `.even-set__items`: six go 2, 3 or 6 to a row, four 1 or 2, three 1 or 3, so every row holds the same |
| A main column with a side panel | `.split` (`.split--rail` for a narrow menu: above the page on a phone, at its side beside it) |
| A row of buttons or a header | `.action-row` (`--end` for a form's Cancel and Save) |
| Key figures | `.stats` (side by side, wrapping only when a label's longest word no longer fits) |
| A section that folds open | `.disclosure` on a `<details>` |
| A list with no bullets | `.list-plain` |
| Words a phone's row has no room to show (still read out) | `.visually-hidden--phone` |
| A row of choices too long for the screen | `ScrollRail`: a plain native scroller (swipe or wheel, snap to an item, an edge fade; arrows page it on a pointer screen and are hidden on touch). The one place a screen may scroll a row sideways |
| A grid that is wide by nature, such as a preview of the user's own spreadsheet | `.scroll-region`, the only other sideways scroller |

**Tables, lists and filters**

| For | Use |
| --- | --- |
| Every table (cards on a narrow page) | `ResponsiveTable` (see below) |
| A list with nothing to show yet | `EmptyState` and `LoadingState` |
| Page controls | `Pagination` (it writes "Showing 1–10 of 25 students" itself; `flush` at the foot of a flush card), fed by `usePagedQuery` |
| A list's filters and page, kept in the address so a reload, a shared link and Back keep them | `useUrlFilters` (changing a filter goes back to the first page) |
| A set of filters | `.filter-bar` (`.filter-bar__count` for how many results they leave) |
| A search box | `SearchField` (`.field--search`, which draws its own magnifier): the list follows as you type, with no Search button |

A `ResponsiveTable` has one `primary` column (the card's title) and at most one
`actions: "inline"` column. `empty` replaces the table when there are no rows. `selected`
marks the row a side panel shows, and `.row-target` on the control that selects it makes a
tap anywhere on the row or card a tap on that control (the row's other buttons still answer
for themselves). `flush` drops the border for a table that fills a card, and `detail` shows
what a row's own button opened beneath it, across the table. Rows sit in the middle of their
line, and an `actions` column's buttons sit side by side at the end of the row, on one line
while it is a table; a screen does not wrap them in its own box or build its own row grid.

**Forms and controls**

| For | Use |
| --- | --- |
| A labelled text box, select or date box | `.field`, through `Field`, which writes the label, required star, error and help and wires them to the control. `.field--sentence` for a form's own labels, `.field__hint` for help, and `aria-invalid` draws the error edge. One size and one iOS date-box fix, in `layout.css`; `.form-text-input` and `.form-select-input` share it |
| A drop-down of `{value, label}` options | `Select` inside a `Field` (`all` adds a filter's "All ..." entry) |
| A pick-one row of buttons (a switch, or filter chips with counts) | `ChoiceGroup` |
| A checkbox with its words | `.check` |
| A modal (a sheet on a phone) | `Dialog` |
| A modal that asks to confirm | `ConfirmDialog`: a form, so Enter confirms; Cancel before the action, and focused first when the action is destructive |
| A form's save | `useMutation` (no hand-rolled busy and error flags) |
| Writes to one thing that must land in the order they were made | A mutation `scope`: each assessment item has its own, as `useItemWrites` sets up; a session's staged decisions and their recording share one |
| A screen that warns about unsaved edits across many rows | `useDirtySet` |
| A Copy button | `useClipboard` |

**Text, messages and marks**

| For | Use |
| --- | --- |
| Text | A heading element (`h1` to `h4`, sized once in `layout.css`) or a type role: `.eyebrow` and `.eyebrow--muted` for small capitals, `.item-title` for the name a row or tile is about, `.subtext` for a sentence under a heading, `.meta` for a time, count or by-line, `.menu-link` for a place to go in a menu, rail or row of tabs, `.section-title` (`--display` for the About page's name) for a section's title, and one look for inline `code`. A screen stylesheet sets no `font-size` or `font-weight` of its own (`tokenRules.test.ts` counts it as `ownType`) |
| A boxed message | `Alert` |
| One line of error text | `ErrorText` |
| A short status label | `Badge`. Its text is centred; a `Button`'s text reads from the start when it wraps, so an arrow stays beside its words. One rule each in `controls.css`, never a per-screen text-align |
| A single symbol, initials or a number in a circle | `.mark` (`--success`, `--warning`, `--danger`, `--neutral`; `--small`, `--large`, `--display`); a screen may set the circle's size and colours |
| An icon | `Icons.tsx` |
| A rank-to-rank line | `RankTransition` (and `CandidateRanks`) |
| A link that opens a new tab, out of the app (`href`) or to a page of it kept beside this one (`to`) | `ExternalLink` (it says so to a screen reader) |
| An email address | `EmailAddress`, which lets it wrap after the `@` or before a dot |
| A Korean name | `lang="ko"`, which keeps it whole |
| Joining class names | `cx` |

### Design values

- **The one typeface is Pretendard** (`--font-sans`, loaded in `main.tsx` and served by the
  app itself, never a font host): Latin as in Inter and Korean to match, but no hanja, so
  text in Chinese characters would fall back to a system font and needs a different typeface.
- **The scales.** A value that sits between two steps takes the nearer one; if a design
  really needs a new step, add it to the scale for everyone.

  | Scale | Tokens |
  | --- | --- |
  | Type size | `--font-size-xs` to `-3xl` (eight steps, 0.75rem to 2rem) |
  | Type weight | `--font-weight-normal` to `-title` (400 to 800) |
  | Corners | `--radius-xs`, `-sm`, `-control`, `--radius` and `-pill` |
  | Elevation | `--shadow-xs` to `-lg` and `--shadow-up` |
  | Focus and validation marks | `--ring-*` and `--edge-accent` |
  | Space | `--space-1` to `-7` (0.25rem to 3rem; a hairline offset of 0.2rem or less and a clearance over 3.25rem are not steps) |
  | Letter-spacing | `--tracking-label`, `-display` and `-tight` |
  | Line height | `--line-height-tight`, `-snug` and `-body` |
  | Change time | `--duration`, the only one (a `transition` names what changes, never `all`) |

- **Motion.** A change the person asks for that redraws the page (the sidebar, the theme, a
  settings or About section) goes through `smoothly` (`smoothly.ts`; `SmoothNavLink` for a
  link between views of one screen), a view transition styled in `layout.css` that a browser
  without one, or reduced motion, skips; `e2e/motion.spec.ts` checks both. What opens takes
  the `reveal` animation.
- **Stylelint** (`stylelint.config.mjs`, part of `npm run lint`) rejects invalid CSS and what
  is already at zero everywhere: a named colour, an id selector, `!important` (the
  reduced-motion rule in `theme.css` is the one exception) and a word-splitting
  `overflow-wrap: anywhere` or `word-break: break-all`.
- **`tokenRules.test.ts`** fails on anything a stylesheet holds outside the tokens, with no
  list of exceptions: raw colours, dark-mode patches, `!important`, its own type, space,
  letter-spacing, line-height, transition, radius and shadow literals, z-index, and a button
  class of its own. It also fails on a `var()` fallback, a token that is used but not defined
  (or defined but never used), a design token defined outside those two files, and a class
  used in the code that no stylesheet defines.

## Search

One function, `kukgrade/search.py`, is every list's search box; a list declares the text it offers
(`search("search", (…fields…))` in its viewset: a column, or an expression for text a screen shows
such as `label_of` a status or `date_words` a date). It matches every word, ignores accents and
case, finds part of a word, forgives a slip in a word of letters (PostgreSQL `pg_trgm`) and ranks
the results. Do not write a list's search by hand (`icontains`, or filtering in Python or in the
browser): it will not behave like the others. Wrap prose (notes, summaries) in `ExactOnly` so only
names and titles are matched by likeness. `kukgrade/test_search.py` holds the behaviours.

## Query budget

`backend/gradings/test_query_baseline.py` holds the hot paths to a ceiling, and the
roster and list tests hold their counts flat as data grows. Measured 2026-11-05:

| Request                                                                                                | Queries        | Ceiling |
| ------------------------------------------------------------------------------------------------------ | -------------- | ------- |
| Mark an item (first mark, or a later change with a reason), with the assessment's counts in the answer | 18 (76 before) | 20      |
| Comment on an item                                                                                     | 11 (26 before) | 14      |
| Item list for an assessment (page of 9)                                                                | 4              | 6       |
| Assessment summary (a lone mark no longer asks for it)                                                 | 2              | 4       |
| Student list (any length of page)                                                                      | 2              | 4       |
| A session's roster (any number of candidates)                                                          | 12 or fewer    | 12      |

Marking an item once cost 76: about fifty of those statements were the database
re-checking constraints that `Model.save()` had just validated (`full_clean()` runs a
statement per foreign key and a few per CHECK and UNIQUE constraint, and the write is then
checked again by the database anyway). The hot writes (an item's update, its comment and
change rows, and audit events) now use `kukgrade.modelchecks.clean_without_database_checks`:
Python still judges field types, choices and the model's own `clean()`, and the foreign keys
and constraints stay the authority (`test_hot_writes_still_refused.py`). Use it only where a
service already decides every value. When a change lowers a path, lower its ceiling in the
same change and update this table.

## Dependency updates

Nobody edits dependency versions or base-image digests by hand.
[Dependabot](../.github/dependabot.yml) opens a weekly pull request when a Python
package, an npm package, a GitHub Action, or a base image pinned in the `Dockerfile` has
a newer version. Each updates the manifest and its lockfile together and runs the full
CI. Merge one once its checks are green.

- Minor and patch updates arrive grouped; a major version gets its own pull request.
- A new Python or Node _line_ is never proposed automatically: it is a decision. Change
  `python:3.14-slim` in the `Dockerfile`, `requires-python` and the tool targets in
  `backend/pyproject.toml` (then `uv lock`), `backend/.python-version`, `node:22-alpine`
  and `node-version` in `.github/workflows/ci.yml`, together.
- Held back on purpose (ignored in the Dependabot config): Django 6 and django-stubs 6
  (Django 5.2 is long-term support to 2028) and TypeScript 7 (`openapi-typescript` does
  not support it yet). Security updates are still taken.
- An override in `frontend/package.json` lifts a package that a tool pins below its
  security fix. Today: `minimatch` 10 to 11 (GHSA-g3hv-75wg-m249), which ESLint and
  typescript-eslint still ask for as `^10` and use only to match our own config's file
  patterns. Remove an override once the tools ask for the fixed version themselves.
- A package whose output is committed can fail CI until you add a follow-up commit to the
  Dependabot branch: `drf-spectacular` needs `schema.yml` regenerated,
  `openapi-typescript` needs `npm run generate:types`, `ruff` may need `ruff format`,
  and `prettier` may need `npm run format`.
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
   Pull requests and merges check every screen at four widths only. Before tagging, run
   the full nine-width check on `dev` (Actions, CI, Run workflow); the tag's own CI run
   repeats it, alongside the publish.
2. **Cut a release candidate on `dev`**: `git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1`.
   The [Publish image](../.github/workflows/publish.yml) workflow builds
   `ghcr.io/theredtower/kukgrade:0.2.0-rc.1` for amd64 and arm64 on native runners, runs
   `manage.py check --deploy` and `.github/scripts/image-smoke.sh` on each, and only then
   publishes it. It never moves `latest`, and its About page and sidebar name it by its tag
   (`0.2.0-rc.1`, from the build argument `KUKGRADE_BUILD_PRE_RELEASE`), so a candidate is never mistaken for the final release. A production-ready build is still tried this way
   first.
3. **Try it.** Run the candidate as a real deployment (the image tag goes in the compose
   file), work through the checks that matter for the change, and fix what turns up on
   `dev`. Each fix is a new candidate (`-rc.2`, ...).
4. **Promote**: open a pull request from `dev` into `prod` and merge it with a merge commit
   (not a squash), so `prod` holds the same commits `dev` proved. Nothing is committed to
   `prod` directly.
5. **Release**: tag the merge on `prod` as `vX.Y.Z` (no `-rc`). The workflow publishes
   `0.2.0`, `0.2` and `latest`, plus the major from 1.0. The demo site follows `latest`
   once there is one (see the [roadmap](roadmap.md)).
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

The package is public, so a tag can be pulled without signing in.

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
