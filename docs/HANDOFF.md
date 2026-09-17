# Handoff

Written 2026-09-17 by Claude (Sonnet 5) for whichever model or agent picks up
this repository next - Gemini or otherwise - if the current session runs out
of usage mid-task. Read this whole file before touching anything. It is a
snapshot, not a source of truth about the code: where it disagrees with
`docs/current-system.md`, `docs/decision_log.md`, or the code itself, those
win - update or delete this file once you no longer need it.

## Read this first: the working agreement

The user has repeated this instruction many times across this project, in
almost the same words each time. Breaking it is the single most likely way
to lose their trust immediately:

> Step by step. Verify, test, then and only then commit and move on. Don't
> implement everything in one go.

Concretely:

1. Pick **one** small, self-contained unit of work. Not "the whole feature,"
   one step toward it.
2. Implement it.
3. Verify it for real: run the actual test suite, linter, type checker and
   build - see **Verification commands** below. Don't report success from
   reading the code.
4. For any guard, permission check, default, or piece of logic you're
   relying on to be load-bearing, prove it: temporarily break it, run the
   specific test that should fail, confirm it fails for the *right* reason,
   then restore the original code exactly (re-edit it back - never
   `git checkout` to "restore," since that can silently discard unrelated
   uncommitted work).
5. Stop. Report what you did and how you verified it. Wait for the user to
   say "commit" (or equivalent) before committing.
6. When told to commit: create a `feature/<short-name>` branch off `dev`,
   commit there, `git checkout dev && git merge --no-ff feature/<short-name>
   -m "merge: ..."`, then `git branch -d feature/<short-name>`. Never
   `git commit --amend` a commit that might already be merged or pushed;
   only amend a same-turn, not-yet-merged local commit, and only to fix a
   mistake you just made (this happened once this session - see the git log
   for `36f3bd0`, amended before merging because its message took credit for
   a fix from an earlier commit).
7. Pushing to `origin/dev` is a **separate** confirmation from committing.
   "Commit" does not imply "push." Ask, or wait to be asked.
8. Never invent scope. If the user's request implies a decision they haven't
   made (which library, what copy, whether a feature should exist at all),
   either make the smallest reasonable default and say so, or ask - don't
   silently expand the task.
9. If something you're about to build resembles a security- or
   privacy-relevant decision that was already made and rejected (see
   `docs/decision_log.md`), re-read that entry and re-surface its reasoning
   to the user before proceeding, rather than silently re-implementing or
   silently refusing.

The user has confirmed this exact workflow works well for them multiple
times this session by letting it run unmodified across many steps. Don't
"optimize" it away by batching several steps together to save time.

## What KukGrade is

A grading-management application for a Kuk Sool Won (martial arts) school:
tracks students, staff, grading sessions, candidate assessments, outcomes,
promotions and rank history. Backend is Django + Django REST Framework +
PostgreSQL; frontend is React + TypeScript + Vite. Monorepo: `backend/`,
`frontend/`, `docs/`. It holds data on minors - this shapes several
decisions (see below) and should shape your own judgement calls too.

Authoritative docs, in priority order when they disagree:

- `docs/current-system.md` - what's actually implemented, verified by
  running the tooling. Read this first for "what exists."
- `docs/decision_log.md` - why things are the way they are, and decisions
  that must not be silently re-litigated. Read this before proposing
  anything that smells like a past decision (auth strategy, account
  creation, throttling, syllabus versioning, etc.).
- `docs/api_contract.md` - the HTTP contract.
- `docs/permissions.md` - the authorization model.
- Everything else in `docs/` (`architecture.md`, `data_model.md`,
  `development-workflow.md`, etc.) is older and may be stale in places -
  `development-workflow.md` in particular still lists resolved items under
  "Unresolved Decisions." Prefer `current-system.md` and `decision_log.md`.

## Current git state (as of this handoff)

Branch: `dev`. Working tree clean except pre-existing untracked items (see
**Untracked files that are not mistakes** below).

`dev` is **7 commits ahead of `origin/dev`, not yet pushed**:

```text
e388e6a merge: add a theme toggle and first-time login copy
36f3bd0 feat: add a theme toggle and first-time login copy
16fd5c2 merge: redesign login screen to match the SCR-008 concept
c9b0000 fix: give the login brand panel its own colour in dark mode
f7898f2 feat: redesign login screen to match the SCR-008 concept
c401151 merge: adopt Quiet Command design tokens
03c21cd feat: adopt Quiet Command design tokens
```

Do not push these without asking first - the user asks for push as a
separate, explicit step every time (see point 7 above). Everything below
`03c21cd` in `git log` is already on `origin/dev` and CI-green.

## What happened this session, in order

All of this was the frontend foundation + design-register work, done as
separate steps per the working agreement, each committed and merged
individually (see git log above for the exact commit pairs):

1. **Generated API types** (`openapi-typescript` against `backend/schema.yml`
   into `frontend/src/api/schema.ts`, `npm run generate:types`). Replaced
   hand-written `AuthUser`/`HealthResponse` types in `frontend/src/api.ts`.
   CI regenerates and diffs the committed file so a serializer change that
   nobody mirrors fails the build. The error envelope (`ApiErrorBody`,
   `FieldErrors`) stays hand-written - there's no OpenAPI schema entry for
   it, since `custom_exception_handler` builds error responses outside
   DRF's serializer-driven response path.
2. **React Router** replaced a hand-rolled `pushState`/`popstate` pair in
   `App.tsx`. `RequireAuth` and `LoginRoute` are declarative guards now.
3. **TanStack Query** replaced a hand-rolled effect + attempt-counter in
   `auth.tsx`. Session bootstrap is a `useQuery` on `GET /api/auth/me/`;
   login/logout are mutations that write into that query's cache on
   success. Retries are off by default (`retry: false`) - proved
   load-bearing by temporarily enabling them and watching a test that
   counts exact `fetch` calls fail.

   These three were jointly mandated by the **2026-09-14 decision log
   entry** ("Frontend stack and generated API types") - they were the
   backlog item this session actually started from.

4. **Design tokens** (`frontend/src/theme.css`): CSS custom properties for
   the "Quiet Command" visual direction from
   `frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md`
   (FDR-001 through FDR-004, FDR-012). Dark mode follows
   `prefers-color-scheme`; `[data-theme="light"/"dark"]` selectors were
   pre-wired for a manual toggle that didn't exist yet at this point.
5. **Login screen redesign** to match the approved concept screen
   `08-login.png` (SCR-008 in the register): two-panel layout (ink brand
   panel + form panel) instead of a single centered card. Copy changed to
   "Welcome back" / "Sign in to KukGrade" / "Email address"; added a
   password show/hide toggle. Six existing tests were updated for the new
   copy (not weakened - just retargeted). **Bug caught from a screenshot**:
   the brand panel's background and the page background were the identical
   colour in dark mode, so the panel visually disappeared. Fixed by adding
   a `--color-rail`/`--color-rail-border` token pair, distinct from
   `--color-page-bg` in dark mode only (see `theme.css`).
6. **Theme toggle + first-time login copy**, in direct response to the
   user watching the login screenshots and asking for more:
   - An animated three-way Light/System/Dark segmented control
     (`frontend/src/useTheme.ts`, icons in `frontend/src/ThemeIcons.tsx`,
     rendered by `ThemeToggle` in `App.tsx`) above the login form.
     "System" is the default and tracks `prefers-color-scheme` live via a
     `matchMedia` change listener. An explicit choice persists to
     `localStorage` (`kukgrade-theme`) and sets `document.documentElement`'s
     `data-theme` attribute - which `theme.css` was already wired for.
     `frontend/index.html` has a small inline script that applies a stored
     choice **before first paint**, so a returning visitor with an explicit
     dark preference never sees a flash of the light default first.
   - Login heading reads **"Sign in"** for a browser that has never
     completed a sign-in, **"Welcome back"** once it has. Tracked via a
     `localStorage` flag (`kukgrade-has-signed-in`) set in `auth.tsx`
     whenever `AuthProvider` observes a non-null user (covers both a fresh
     login and an already-valid session found on page load).
   - Confirmed with the user directly: **there is no self-registration
     page, and there should not be one** - see the new decision log entry
     below.

Frontend test count went from 17 to 21 across these steps. Backend was
untouched this session (still 468 tests, last touched in the previous
session for self-service account updates + bulk-promote).

## New decision log entry you should know about

**`docs/decision_log.md`, "2026-09-16 - No self-service account creation:
Google SSO rejected, no registration page"** (added as part of this
handoff, since the reasoning previously only existed in conversation
history and a local Claude Code plan file the next agent won't have access
to). Read it before proposing Google SSO, any other SSO provider, or a
self-registration/sign-up flow. Short version: staff use personal Gmail
addresses with no controlled Workspace domain, so SSO with
auto-create-on-sign-in would let anyone with a Gmail account self-provision
access to data on minors. Every account is administrator-provisioned,
full stop, and that's a security decision, not an oversight.

## Frontend design register

`frontend/Frontend-Design-Register/FRONTEND_DESIGN_REGISTER.md` has the
full FDR (design decision) and SCR (concept screen) tables, plus 24 PNG
mockups. **This entire directory is untracked in git** (was already
untracked when this session started) - it exists in this working tree but
will not be present in a fresh clone. If you're operating on a fresh clone
rather than this exact working directory, ask the user for these files
before starting any more design-register work; don't guess at colours or
copy from memory of this handoff.

Implemented so far against the register: SCR-008 (login). Nothing else.
FDR-005 (nav rail with Overview/Students/Gradings/Syllabus/Audit/Users) is
the next big piece of shell work and has not been started - the app still
has only a placeholder top-bar `ApplicationShell` with no real navigation or
content screens. The register's own "Remaining shared-screen design work"
and "Separate assessment design pass" sections list everything else that's
still concept-only.

## Known environment gotchas (spend time on these, don't rediscover them)

- **jsdom in this project implements neither `window.matchMedia` nor
  `window.localStorage`** (the latter is `undefined`, not throwing -
  confirmed by direct check, not assumed). Both needed polyfills, added to
  `frontend/src/test-setup.ts` and wired via `vite.config.ts`'s
  `test.setupFiles`. If you add code that touches either API and tests
  start throwing `TypeError: Cannot read properties of undefined`, this is
  why - extend the polyfill, don't work around it per-test.
- `frontend/src/App.test.tsx` has a **file-level `afterEach`** (outside any
  `describe`) that clears the `kukgrade-has-signed-in` and `kukgrade-theme`
  localStorage keys and the `data-theme` attribute after every test, because
  those live in shared globals (`window.localStorage`, `document`) that
  would otherwise leak between tests in the same file. If you add a test
  that depends on one of these being unset, don't assume a clean slate from
  a previous describe block's `beforeEach` - the global `afterEach` already
  guarantees it, but a new `beforeEach` that explicitly *sets* one (like
  `App authentication`'s does for `kukgrade-has-signed-in`) needs to keep
  doing so for that block's tests to mean what they say.
- **No icon library is chosen yet** (flagged in the register itself as
  outstanding work: "Replace concept-only icons with one consistent
  accessible icon library"). The theme toggle's sun/moon/monitor icons
  (`frontend/src/ThemeIcons.tsx`) and the password show/hide toggle are
  small hand-written inline SVGs / plain text, deliberately not a library
  dependency. Don't add a library just to draw three icons; do pick one
  before the icon count grows past a handful of ad hoc controls like this.
- Playwright is **not a project dependency** - it isn't in
  `frontend/package.json`. Visual verification this session was done with
  an ad hoc `npx playwright@1.55.0 install chromium` into
  `~/Library/Caches/ms-playwright/`, then driving `playwright-core` directly
  from the npx cache via an absolute import path (see shell history /
  scratchpad scripts if you need the exact pattern - they're throwaway, not
  committed). If you need to screenshot the app again, either reinstall the
  same way or ask the user how they'd prefer visual verification to work
  going forward; don't add Playwright as a project dependency without
  asking, since that's a dependency-set decision, not a code change.
- The dev database, backend and frontend dev servers may or may not still
  be running depending on whether this machine session persisted - check
  before assuming:

  ```sh
  docker compose ps                                    # postgres container
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/health/
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
  ```

  To bring them up if not running: `docker compose up -d db`, then in
  `backend/`: `DJANGO_DEBUG=true DJANGO_SECRET_KEY=local-dev-only-not-secret
  uv run python manage.py runserver`, and in `frontend/`: `npm run dev`.

## Untracked files that are not mistakes

`git status` will show these as untracked. They predate this session and
are not something to add, remove, or "clean up":

- `frontend/Frontend-Design-Register/` - the design mockups, see above.
- `frontend/src/assets/` - a KukGrade logo (jpg/svg), not yet wired into
  any component.
- `.playwright-cli/`, `output/`, `tmp/` - local scratch/tooling directories
  at the repo root, unrelated to the frontend work.

## Verification commands

Backend (from `backend/`):

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts audit ranks students syllabus gradings
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py spectacular --file /tmp/check-schema.yml --fail-on-warn --validate
```

Frontend (from `frontend/`):

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

All of the above are also what CI (`.github/workflows/ci.yml`) runs on
every push - if it's not green locally, it won't be green there either.

## Immediate next steps

Nothing is currently broken or half-finished - the last merge
(`e388e6a`) is a clean, fully-verified stopping point. Options, roughly in
the order they were being discussed before this handoff was requested:

1. Ask the user whether to push the 7 commits above to `origin/dev`.
2. Continue the design-register work: the nav rail / application shell
   restructure (FDR-004, FDR-005) is the natural next step, since almost
   everything else in the register depends on real navigation existing
   first. This is a bigger step than the ones done so far - break it down
   further rather than doing it in one pass (e.g.: nav rail shell with
   static links first, then wiring each section's placeholder route,
   before any real screen content).
3. Alternatively, resume the paused backend-adjacent settings plan (email
   password reset, Account Settings page) - context for that lives only in
   this conversation's history and a local Claude Code plan file the next
   agent won't have access to, so ask the user to restate what they want
   rather than assuming the plan below is still current:
   - Step 2 (not started): email-based "forgot password" flow using
     Django's `default_token_generator`, `EMAIL_BACKEND` console/locmem for
     dev/test, a real provider deferred until there's a deployment.
   - Step 3 (not started, now unblocked since the frontend foundation
     landed): an Account Settings page reached from the profile menu -
     display name edit (`PATCH /api/auth/me/`, already implemented
     backend-side), password change (`POST /api/auth/change-password/`,
     already implemented backend-side), and an Appearance section that
     should reuse `frontend/src/useTheme.ts` rather than duplicating it.

Whichever you pick, propose it to the user first if it's not obviously a
continuation of something they just asked for - don't assume silently.
