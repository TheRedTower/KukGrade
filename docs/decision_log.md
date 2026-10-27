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

### 2026-10-27 - The black belt requirement charts are recorded as written

Status: Accepted; built (migration `syllabus/0004_black_belt_charts`)

Decision:
The WKSA Official Black Belt Requirement Charts the owner supplied are recorded
as the syllabus of the ranks they belong to, with nothing added, left out or
reworded: the 2nd degree chart for KSN adults (18+) and the Youth 2nd degree chart
for KSN 13-17 (both WKSA Version 2-1), the 3rd degree chart for PSBN (Version 3-1)
and the 4th degree chart for SBN (Version 4-1), the last two for adults only
because the sheets give no other band. That is 36, 36, 47 and 49 lines. Each line
is a requirement in the chart's reading order (down the left column, then the
right), with the range the chart prints (`1-10`, `1-15`, ...), its Korean as
printed, and a note saying which chart section it sits under; the chart's own
parentheses (`(4 DIRECTIONAL)`, `(AHP, YUHP, DEE, BAHL DEUNG)`) and the Youth
sheet's "*Must be taught AFTER age of 18 y.o." are the note verbatim. The "Under
Black Belt Curriculum" levels, the Teaching Experience line and the WKSA Pledge
are requirements too (category Other). PKJN has none. Three techniques the earlier
syllabus already holds (Yahng Sohn Mohk Soo, Ssahng Soo, Dahn Doh Mahk Ki) reuse
those items; the Youth chart prints Ssahng Soo as "Ssang Soo".

Context:
The owner asked for the sheets' syllabi to be added exactly as written. A second
reader compared every line, range, note and hangul with the images and found them
matching; the one difference found (the order of the KSN lines) was corrected.

Consequences:
Every grading assesses the cumulative syllabus (2026-09-29), so a KSN, PSBN or
SBN assessment also carries the earlier ranks' content under the chart's lines;
each higher chart restates the sets of the one below it (PSBN prints them
without a range, which replaces KSN's), as the chart does. Whether a black belt
grading should be exempt from that is for the owner to say. The 3rd and 4th
degree sheets print the teaching line as 실습경력 (the 2nd as 실습경험), kept in
the note of those lines. The special kicks' "(AHP, YUHP, DEE, BAHL DEUNG)" is
printed under Ee Dahn Cha Ki and is recorded on it. Category choices for the
lines (a chart section is not a category) are Other for sparring, study and
pledge lines, Technique set for sets and kicks, Form and Weapons for forms and
weapon skills.

### 2026-10-27 - Review of the deployment work, and a CI job that starts the image

Status: Accepted; built

Decision:
Everything built since the deployment overhaul began (2026-10-26, "The deployment
overhaul: what the owner asked for") was re-verified with
real containers, and CI now does the same on every push:
`.github/scripts/image-smoke.sh` starts the image with its own database (sets up
the first administrator, signs in, checks the closed admin, a clean database
stop, and that a session survives a restart) and as `compose.prod.yml` runs it
(UID 10001, read-only root, no capabilities, an external PostgreSQL, two proxies
declared). Removed as stale or unused: the refusal of the old
`DJANGO_BEHIND_TLS_PROXY` variable (never deployed with it), the undocumented
`GUNICORN_THREADS` and `GUNICORN_TIMEOUT` knobs (fixed at 4 and 30), the
test-only `legacy_matching.person_groups`, exports used only inside their own
frontend module, an unused CSS rule, and the sample "snakeoil" key the
PostgreSQL package left in the image.

Context:
The owner asked for everything done so far to be checked and the repository
made coherent. The review found one real defect the earlier checks missed: the
import-folder permission fix made the app refuse to start as `compose.prod.yml`
runs it (it changed a folder on the read-only root), which no test or CI step
started the image in that mode to see. The image now ships `import_uploads/` and
`tls/` private (700), the container tightens them only when they are not, and
the CI job covers that mode. CI also validates every `deploy/` Compose file.

Consequences:
The action plan was rewritten (the audit-fix branch it still listed was merged
in pull request #12), and the README, architecture, documentation index and API
contract headings were brought in line with the image carrying its own database.

### 2026-10-27 - How black belt testing works (recorded, not yet modelled)

Status: Recorded; nothing built

Decision:
Recorded as the owner described it, so a later slice can model it: a student
testing for black belt and above first registers and pays the WKSA fee, then
must sit a minimum number of gradings before the final one. For JKN that is six:
the school's quarterly gradings and the national testings (for the Colchester
school, Norwich in June and Liverpool in November); the association may require
more. The final national testing is where WKSA's senior masters decide the
promotion, with a ceremony and a certificate. The association's sheet gives 6-8
tests for JKN, 8 for KSN, PSBN and SBN, and 12 for PKJN, counted from
registration; its "Norwich/Scotland (June)" and "Liverpool (November)" are the
national dates (Scotland does not apply to Colchester).

Context:
The action plan waited on the owner's explanation before modelling black belt
gradings beyond the ID rule.

Consequences:
None in the code yet. What to model (registration, the count, national
testings as sessions or as outside events) is an open decision.

### 2026-10-27 - One container: PostgreSQL in the image, one .env, files in deploy/

Status: Accepted; built

Decision:
The production image carries PostgreSQL 17 (Debian's package, pruned: no JIT/LLVM,
Perl, replication or benchmark tools; `psql`, `pg_dump`, `pg_restore` stay). With
`POSTGRES_HOST` unset the container makes and runs its own database in
`/var/lib/kukgrade/postgres`, on a unix socket that exists only inside it (no
network listener, no password); with `POSTGRES_HOST` set it starts none and uses
that database, as `compose.prod.yml` does. `kukgrade.serve` is the one process
that does this (database, migrations, setup code, gunicorn, signals; if either
process stops the container exits). It starts as root only to hand
`/var/lib/kukgrade` to UID 10001 and runs the database and the app as that user (the supervisor itself stays root); started as
10001 already it skips that, so `compose.prod.yml` gains `user: "10001:10001"`. A
generated Django secret key is kept in `/var/lib/kukgrade/secret_key` when none is
given. `deploy/` has one small Compose file per way of being reached (direct,
nginx, Caddy, Traefik, Cloudflare Tunnel, Pangolin), each complete, naming the
image `ghcr.io/theredtower/kukgrade:latest`, with one `env_file: .env` and one
`./data` bind mount, and no `environment`, `db`, `build` or `ports` that the mode
does not need. Superseded the draft in pull request #42 (a separate database
service, a permissions service, layered override files and two sets of variables).

Context:
The owner found the first design too much to set up: two places for settings, a
database service for an image that could carry its own, and ports declared where
a proxy fronts it. A single container with one `.env` and one data folder is the
easiest thing to deploy and back up. The cost is about 80 MB more image and that
the database's major version is fixed by the image (a change is a dump and
restore, which the image detects and refuses to guess at).

Consequences:
Verified with real containers: first start, restart and `docker stop` (clean
database shutdown in under a second), data persisting in a bind mount, the setup
code, health check, the external-database mode as UID 10001 with a read-only
root filesystem and all capabilities dropped, the emergency admin screens, and
direct, Caddy and nginx deployments with `deploy/check-proxy-count.sh`
(Traefik started; Cloudflare Tunnel and Pangolin only had their files validated,
because they need an account or server). A container started without a data
volume keeps its data inside the container until it is removed.

### 2026-10-27 - Dependencies are updated by pull request, never by hand

Status: Accepted; built

Decision:
`.github/dependabot.yml` has Dependabot open weekly pull requests for the
Python packages (`pyproject.toml` with `uv.lock`), the npm packages
(`package.json` with `package-lock.json`), the pinned base-image digests in the
`Dockerfile`, and the GitHub Actions in the CI. Minor and patch updates are
grouped into one pull request per kind; a major version gets its own. Tools
whose output is committed (`drf-spectacular`, `openapi-typescript`, `ruff`,
`mypy`) are grouped apart, and the `uv` image is not grouped with the Python and
Node images, so one that needs a follow-up commit or breaks the build cannot
hold the rest back. A three-day cooldown keeps freshly published packages out.
The Dockerfile names each image once, in a `FROM` line (the `uv` image and a
shared Python base are their own stages), because that is what Dependabot reads.
The Python and Node image tags are followed by digest only: a new Python or
Node line is ignored, because it is a decision, not a refresh. The Dockerfile
does not hard-code the Python minor version in its paths.

Context:
The owner does not want to edit dependency versions or image digests by hand:
updating a package should update it everywhere, then be checked by CI and
review before it lands. A pull request is the review point; on this plan
nothing enforces that CI is green before a merge, and a Copilot review has to
be requested.

Consequences:
A deliberate move to a new Python or Node line still changes several places
together (the list is in `development-workflow.md`). The PostgreSQL image is
not tracked (a new major is a data migration). Dependabot only regenerates a
manifest and lockfile, so an update to a package with committed output can need
a follow-up commit. GitHub may suppress digest-only updates for an unchanged
tag, so it is worth watching that a Python or Node digest pull request arrives.
Security updates for a vulnerable dependency can be turned on in the
repository's Dependabot settings (not a file). The first run may open several
pull requests at once.

### 2026-10-27 - The production image keeps only what runs or repairs

Status: Accepted; built

Decision:
The image is stripped of what neither the app nor an emergency repair needs,
but not of the repair tools: `sh`, `python`, `manage.py` and `openssl` stay (the
owner's rule: strip anything not needed even in an emergency). Removed: test,
schema and project files, uncollected duplicate frontend assets, non-English
message catalogues, C sources of compiled extensions, the Brotli library after
it has compressed the assets, `pip`/`setuptools`/`wheel`, `idle`/`tkinter`,
C headers, documentation and package-manager lists, and the setuid bit on
system programs. The app's files are assembled in a separate build stage so
the final image holds exactly the running code. The three base images are
pinned by digest.

Context:
Slimming was measured, not assumed (arm64, Docker Desktop): about 313 MB
before and 244 MB after, the "before" built on the base image then cached
locally (Python 3.14.7; the pinned one is 3.14.10 and a few MB larger).
Deleting a file in a later layer does not shrink an image, so the finished
filesystem is copied into a fresh `FROM scratch` image (with the base image's
`PATH` and `LANG` set again by hand); a first version that only deleted in
a later layer saved about 32 MB, this one about 70. Most of what remains is
the Debian base, Python itself and the PostgreSQL driver's bundled libraries.
Going lower would need a different base (Alpine or a distroless image was not
chosen in this slice) or removing tools the owner wants for emergencies.

Consequences:
A base image only changes when its digest is changed in the `Dockerfile`, which
also means it does not pick up the base's security fixes by itself: refreshing
the three digests is not left as a manual job: Dependabot (see the dependency
updates entry) opens the pull requests. Adding a new Django app
needs no Dockerfile change (the whole backend is copied, then named files are
removed). A new tool the app needs from the base image (a command, a library)
has to be checked against the trimmed filesystem.

### 2026-10-26 - The deployment overhaul: what the owner asked for

Status: Accepted; partly built

Decision:
KukGrade is to be easy to deploy beyond the owner's own host, in slices: the
Django admin closed to the network; one proxy count, port 6942, and HTTPS or
plain HTTP when reached directly; an image stripped to what runs or repairs the
app (shell, Python, `manage.py` and `openssl` kept for emergencies); dependency
and base-image updates by pull request; Compose files for running it directly
or behind nginx, Caddy, Traefik, a Cloudflare Tunnel or Pangolin; a bare-metal
Linux release (a tarball with its own Python, an installer and a systemd unit,
for amd64 and arm64, with a documented build from source); the deployment side
of email made ready but switched off (variables, the DNS checklist, an outbound
check and `email_enabled`; no sending code); and the docs and CI brought up to
date. Audience: the owner's school first, easy for others to deploy; a public
release and licence are a later question.

Context:
Before this, the only deployment was `compose.prod.yml` on the owner's Traefik
host, and the image carried build and test files.

Consequences:
Each slice has its own entry below or above as it is built; `action_plan.md`
lists what is left (the bare-metal release, email readiness, publishing the
image, going live).

### 2026-10-26 - The Django admin is not served over the network
### 2026-10-26 - How the app is reached: one proxy count, a port, and HTTPS or plain HTTP

Status: Accepted; built

Decision:
The app's sign-in is the only public password entry. `kukgrade.urls` no
longer mounts `admin/`, so `/admin/...` is a 404, and the image leaves
the admin's (and the REST framework's browsable-API) static files out of the
collected set. The admin is run only from a shell, with
`kukgrade.settings_admin` and `kukgrade.urls_admin`, bound to loopback (a
throwaway container published to the host's loopback, or `runserver` on the
host). The public `/api/ready/` endpoint is removed: the container's health
check asks `/api/health/` and then the database itself, so nothing public
reports whether the database is up. (A loopback-only endpoint was tried first
and rejected on review: a reverse proxy on the same host connects from
loopback.)

Context:
The admin's own sign-in form is a separate Django view the API's login
throttle does not cover, so passwords could be guessed against it without the
10-per-minute limit (django-allauth's documentation states the same of its
own setups). Redirecting it to the app's sign-in was considered and rejected
because it would leave `/admin/` routable. The owner chose to close it as far
as possible; emergency repair keeps `manage.py`, a shell and SQL.

Consequences:
Tests that exercise the admin's rules use the emergency URL configuration
(`kukgrade.testing.render_admin_pages`). The network app has no setting that
mounts the admin. 2FA for admin accounts is not needed while it is not
reachable. `deployment.md` documents the emergency commands and a check that
each closed path answers 404.
The app can run with or without a reverse proxy. `DJANGO_NUM_PROXIES` is the
single setting for what is in front: 0 means reached directly; N means N
trusted proxies or tunnels, so the forwarded scheme is trusted and the client
address is the Nth-from-last `X-Forwarded-For` entry. `DJANGO_BEHIND_TLS_PROXY`
is removed; declaring a proxy is the opt-in it used to be. With no proxy the
app listens on port 6942, fixed (not a common service's port and not a
development server's; another host port is chosen in Compose's `ports:`, not
by a setting) and serves HTTPS itself (`KUKGRADE_TRANSPORT=https`,
the default) from a mounted certificate (`KUKGRADE_TLS_CERT`/`KUKGRADE_TLS_KEY`)
or a self-signed pair it generates with `openssl` and keeps in
`KUKGRADE_TLS_DIR`; or, only when asked (`KUKGRADE_TRANSPORT=http`), plain HTTP
with the HTTPS redirect, secure cookies and HSTS off and a warning in the log.
The gunicorn options moved from `entrypoint.sh` into `kukgrade/gunicorn_conf.py`
so the port and TLS are decided in one place, with the container health check.

Context:
Production secure defaults make a directly published app unusable over HTTP
(the session cookie is never sent back). The owner wants the app usable behind
Traefik, nginx, Caddy or a tunnel, or on its own, with one setting for the
proxy rather than several that must agree.

Consequences:
A deployment declaring proxies must not publish the port to anyone else. Direct
HTTPS needs a writable volume at `KUKGRADE_TLS_DIR` (the image creates the
directory for UID 10001); without it startup stops with a message naming the
four ways out (a writable volume, your own certificate, plain HTTP, or a
proxy). The `openssl` command must stay in the image (slice 3 keeps it).
`compose.prod.yml` keeps `DJANGO_NUM_PROXIES=2` and now routes Traefik to 6942.

### 2026-10-24 - Linking historical records becomes a review table

Status: Accepted; built on `dev`

Decision:
The owner found the one-name-at-a-time linking screen (FDR-055) clunky in
use and chose a review table (8A, FDR-059, `2026-10-24-link-records/`).
Every name as written is a row; the clear suggestions can be ticked together
and linked in one request, each name to its own student, and a row opens to
its records and a student search. "Left for now" is kept in the browser, not
the database: a personal note on what to come back to, not club data (owner,
2026-10-24). The server owns everything that is a judgement: how clear a
name's suggestion is (`suggestion`), the filters and counts, and which ranks
a name's records are written with.

Context:
The names list is grouped and scored in Python, so filtering by how clear a
suggestion is, and the chips' counts, score every name; the plain list still
scores only the page it returns. That is instant at the club's current size.
If a roster ever makes it slow, cache the scored groups per import rather
than scoring on each request. "Records already linked" on a student result
was drawn but dropped: the students list does not serve it and linking does
not need it.

Consequences:
`GET gradings/legacy-records/people/` gains `search`, `suggestion`,
`group_keys` and `exclude_group_keys` and each name gains `suggestion`,
`ranks`, `needs_rank` and `linked_student_name`; `people-summary/` counts the
names still to link by suggestion, and the names with every record linked
(for the progress bar, so a name partly linked counts once). Left names are sent as group keys, so the
browser keeps the newest 100.

### 2026-10-21 - Historical linking uses the server's group key and remaining records

Status: Accepted; audit repair

Decision:
The historical people endpoint serves `group_key`, the same normalised name
key it uses to group records. The record list accepts that key as a declared
filter, so callers can page through every spelling in the group. The
`linked` filter on people selects records before grouping: `false` means
records still awaiting a student, and `true` means linked records. A group
with different linked students has no single `linked_student`.

Context:
An exact source-name lookup missed punctuation and rank-title variants.
Filtering groups by their one-student summary also reported fully linked,
mixed-student groups as awaiting work.

Consequences:
The linking screen uses the served key and pages through group records. It
does not reproduce the name normaliser. Existing source text stays unchanged.

### 2026-10-20 - The import screens: seven screens chosen, and what they ask of the backend

Status: Accepted (design); the screens are not built yet

Decision:
The owner chose the import screens one at a time from proposed directions
(`frontend/Frontend-Design-Register/2026-10-20-imports-overhaul/`):

- **Imports hub (FDR-049):** one Imports area replaces the import buttons on
  Students and Gradings: unfinished imports first, two plain start panels,
  then every past import, filterable and paged.
- **Choose file (FDR-050):** the guide to what KukGrade reads beside the drop
  area, then a checklist of what was found once the file is read.
- **Match columns and ranks (FDR-051):** the file's first rows with a field
  chooser above each column, read live. The owner asked that what is missing
  can be typed in by whoever knows it: any cell under a matched column can be
  fixed, and a needed field the file has no column for can be typed in row by
  row ("Type each one in").
- **Review rows (FDR-052):** the rows that need attention first, fixable in
  place or left out, and a "Look over all" list of exactly what will be
  imported, fixes marked, for a person's last check before confirming.
- **Confirm (FDR-053):** on the review page itself: once every row is
  sorted, a banner with the summary and the button appears above the last
  look, and the button opens a two-sentence confirmation.
- **Results (FDR-054):** the import's own page, with the next job on top
  (linking records to students, or a second look at what KukGrade filled
  in) and every row and what happened to it below.
- **Linking historical records (FDR-055):** one name at a time, its
  records beside the students it could be, each saying whether the ranks
  fit; tick the records, choose the student, link and move on. Superseded
  2026-10-24 by a review table (FDR-059).
- **An unfinished import is still cleared 24 hours after upload.** Asked
  whether that limit is needed, the owner kept it: the uploaded file and its
  rows are personal data held outside the records, and a day is a sane time.
- **Past gradings are never retyped.** Their records keep the workbook's
  words exactly; what a person adds is what the words mean (a spelling's
  rank, later the student), and a record can be left out.

Context:
The 2026-10-20 import overhaul built the backend first. These choices
cover every import screen, from the hub to linking historical records.

Consequences:
- The backend must accept a roster mapping that has no column for a needed
  field. Such rows stay Needs attention until each is filled, so nothing
  missing is ever imported; today the mapping is refused.
- The row list must also serve each cell as the file has it (for the columns
  not imported), and the historical rows behind one rank spelling.
- The Students list must be filterable to the students one import added.
- **A row is only imported once KukGrade's own fields are right** (owner,
  2026-10-20). A row still needing attention is never imported quietly:
  each one is fixed or deliberately left out before the import can be
  confirmed, and a single "Leave out the rest" does the latter for all that
  remain. Today commit imports the ready rows and passes over the rest
  without a word; it is to refuse while any row needs attention.

### 2026-10-20 - The import overhaul: stored rows, mapping onto KukGrade's fields, suggested links

Status: Accepted; the backend built 2026-10-20 (A0-A7, below), the screens
to follow

Decision:
Imports are rebuilt backend first, then the screens. The owner's choices:

- **Rows are kept.** Every parsed row is stored with its result and any fix,
  so an import can be left and resumed, rows are reviewed page by page, and
  what happened to each row can be seen afterwards. This replaces the
  stateless preview (a fresh parse on every check, fixes resent by the
  browser, skipped rows dropped) and the claim that review rows are "held".
- **No background worker.** A large roster is made fast by validating once
  and saving in bulk, still all-or-nothing, and the row limit comes down to
  what the club needs. F-19 (about a minute for 5,000 rows) is closed by
  this, not deferred: built 2026-10-20 (A3). The limit is 1,000 rows, and
  1,000 rows now commit in 0.6 s with 44 queries, against 8.2 s and 8,953
  queries one at a time, measured locally on the same scratch database.
- **Imports map onto KukGrade's own fields.** Whatever a file has that
  matches a field is imported there; what it lacks can be supplied by the
  person importing for the whole file; columns KukGrade has no field for are
  kept as labelled extra information, not dropped and not new database
  fields. For historical gradings the comment text is kept in full as the
  grading report. No keyword tagging, AI or OCR for now.
- **Links are suggested, never made.** Historical records are matched to
  students by suggestion that a person confirms singly or in bulk. Import
  decision 3 (no auto-linking) stands, as do 4, 5, 6 and 16: rank text is
  never silently normalised, uncertainty never blocks an import, a
  historical Pass never creates a native promotion, and records are voided,
  never deleted.

Context:
Findings from the owner's real workbook (read 2026-10-20: an Information sheet
and six quarterly sheets, `062025` to `092026`, 196 rows; kept outside the
repository):

- Sheet titles are bare `MMYYYY` with no separator, which confirms the
  adapter's pattern. Months only: no row carries a day, a WKSA ID or a date.
- The existing adapter reads all 196 main-table rows (126 Pass, 39
  Conditional, 24 Fail, 7 with no recognised outcome) with no warnings, but
  **silently drops every side table**: "Unaccounted" with its own Outcome and
  Comments (062025), "Missing" and its notes (122025), "Did not attend" and
  "Current belt" (032026, 092026), a "General Comments - juniors" column
  (062026) and loose notes beside the table. They sit to the right of the
  main table in the same rows, not below it, which the adapter does not see.
  A rehearsal would have passed while losing them; the overhaul reads each as
  its own table or a sheet-level note, and shows anything it cannot place.
- 092026 has two "Name" columns (the second a duplicate of the first, with a
  merged cell), shifting the rest right by one. Header detection by content
  copes; the adapter reads the first and warns of the repeat.
- Names are first names only in the older sheets and full names in the
  newer ones, and the same person recurs across sheets ("Name" and "Name
  Surname"), so records should be grouped by person before suggesting a
  student, with a "several students share this name" state.
- Ranks are written "White Belt", "Yellow Belt" and so on (KukGrade: White,
  Yellow), "DBN" (KukGrade: Dahn Bo) and its typos "DNB" and "DBn", case
  variants ("red belt"), and "?" marking doubt.
- Outcomes include "Pass." and "Fail." with full stops, "DNA", "did not
  attend" and "N/A"; one outcome cell holds a free note.
- Sheets are padded to about 1,000 empty rows.

Built (2026-10-20), as decided above, with two choices made on the way:

- A roster takes the club's fixed rank spellings ("White Belt" is White,
  "DBN" Dahn Bo) as the rank, since a student is created at it; a rank the
  file marks as doubtful ("Red stripe?") or misspells is left for the
  importer. A historical record's rank text stays a suggestion only.
- Nothing non-blank on a grading sheet is dropped: a cell no table claims, a
  title above the table and a nameless row (a comment run on) are kept as
  sheet notes, and the preview says how many.

Both commits are one write: 1,000 roster rows in 0.6 s, and the real
workbook's 214 records in 0.1 s. An end-to-end run against the production
image on a throwaway database passed all 53 of its checks (owner-approved
plan, 2026-10-20).

Consequences:
The plan is in `docs/action_plan.md` under the import overhaul. Statements in
`docs/data-import-and-legacy-migration.md` about the stateless preview and
held review rows are superseded as each slice lands. Previous WKSA IDs are
decided (never reused) and are best built before the roster import's matching
slice, since a roster row may quote an old student ID; email, the Settings
page and release assurance are untouched.

### 2026-10-20 - The first administrator is set up from the site, with a code from the log

Status: Accepted, built 2026-10-20

Decision:
On a new deployment, visiting the site shows a setup page while no
administrator exists; whoever completes it becomes the main administrator, a
superuser. To stop a stranger or a bot claiming the site first, the page
also asks for a one-time setup code that each server start writes to the
server's own log while setup is needed - which only the host's owner can
read. The code works once, for 24 hours; a restart issues a new one. The
terminal setup command considered first is not kept, and Django's
`createsuperuser` stays switched off.

Context:
Amendment 10 of the credential lifecycle (2026-10-19): no default password;
the first administrator is prompted for at first deployment. The owner chose
a web page over a terminal prompt, and the setup code over "first visitor
wins" or "only from the server's network".

Consequences:
`accounts/setup.py` holds the rule; `/api/setup/` serves it; the
`issue_setup_code` startup command writes the code; `SetupCode` keeps only
its hash. `SetupPage.tsx` is the page, shown to a signed-out visitor on any
path while setup is needed; it is also where the theme is first chosen.

### 2026-10-20 - Who may change which account

Status: Accepted

Decision:
1. Only a superuser changes an account that can use the Django admin site -
   a superuser's, or one a superuser gave `is_staff`: its details, role,
   status, authority, password and existence. Administrators still see it.
2. Nobody changes their own role or account status; the server refuses what
   the Users screen already did not offer.
3. Administrators otherwise manage instructors and each other as before,
   including creating administrators.
Admin site access itself is granted or removed only by a superuser.

Context:
The go-live mapping of the Administrator role (`permissions.md`) found that
an Administrator could change the superuser's email, role or status, grant
it authority and delete it, and could demote or deactivate themselves
through the API although the screen hid those controls. Django admin let a
staff account with user permissions make itself a superuser.

Consequences:
`accounts.services.can_manage` is the one rule, used by every account
service, by Django admin's change and delete permissions, and served as
`manageable` so the user page goes view-only where a change would be
refused.

### 2026-10-20 - The WKSA ID scheme

Status: Accepted (format and the owner's answers). The two forms are
enforced since 2026-10-20, with a black belt rank requiring a black belt ID
and the one change from a student ID to it; the list of previous IDs is
the list of previous IDs is built (2026-10-20), after the owner's answer on reuse (below)

Decision:
A WKSA ID is never free text. It is the identifier a student is known and
tracked by, so it must have one of exactly two forms, all digits apart from
the hyphens and the `A`:

| Kind | Form | Example | Who holds it | Issued by |
|---|---|---|---|---|
| Student ID | `NNN-N-NNN` | `206-2-150` | Every student below black belt | The school owner |
| Black belt ID | `A-NNNNN` | `A-20819` | Every black belt, instructor or student | WKSA |

- In a student ID the first two parts are the school and the last three the
  student's number within it, always three digits with leading zeros
  (`206-2-007`). Colchester is `206-2`, and nearly every student holds that
  prefix; a student transferring in may keep another school's, such as
  `206-1-044`, in the same form. The home prefix is a deployment setting
  beside the club name.
- A black belt ID is `A`, a hyphen and exactly five digits.
- KukGrade never invents an ID. It records the one the school owner or WKSA
  issued; nobody using KukGrade - administrators included - chooses the
  number.
- Anything else is refused by the model and the database, and so by the
  API, Django admin and the roster import alike, from one definition on the
  server; the Add student screen shows the rule the server serves rather than
  a copy.
- On promotion to black belt the student's black belt ID replaces their
  student ID as the one they are known by. The student ID is kept on their
  record as a previous ID, so anything that still quotes it - an old roster
  spreadsheet being imported, or a search - finds the same student.

When the black belt ID is given (the owner, 2026-10-20): at the national
grading, straight after the promotion, so it takes effect at once - there is
no period as a black belt with a student ID. When the instructor or Master is
back they change the student's ID to it; that one change is the only one an
ID ever takes, apart from correcting a mistyped ID (owner, 2026-10-20: "the
ID should be editable if it's mistyped" - either form may be corrected, a
black belt ID never goes back to a student ID, and a corrected typo is not
kept as a previous ID or retired, since it was never the student's and may
be someone else's real number; the edit's audit event records it). A black
belt ID then stays with the student for good: later
ranks and certificates come under the same ID. So a black belt rank (JKN and
above) requires a black belt ID, and promotion to one waits for it to be
recorded. Until previous IDs are built, the old student ID is kept in the
audit event of that change.

How previous IDs are kept (recommended, 2026-10-20): every record inside
KukGrade - gradings, assessments, promotions - already points at the student
row itself, not at the text of their ID, so none of it needs relinking when
the ID changes. Only what arrives from outside is matched by ID. So each
student keeps a short list of the IDs they have held, each with the date it
was replaced; a lookup by ID checks the current one and then that list, and
the change is audited like any other.

Context:
Until this decision `Student.wksa_id` was any text up to 32 characters,
unique, stored as typed - only the Add student screen upper-cased it (audit
F-30, left open on 2026-10-18 for this overhaul). That let the same person be
entered twice under two spellings, and anything at all stand in for the
identifier the roster import matches students on.

Consequences:
- A migration checks every existing ID and lists any that fit neither form,
  for the owner to correct, before the rule is enforced.
- `wksa_id` stops being read-only after creation in exactly one way:
  recording a black belt ID (built 2026-10-20), which will move the old one
  into the list of previous IDs once that list exists.

Answered 2026-10-20 (school owner, by message): "The number that is allocated
stays with the student even if the student leaves." A number is never given
to a second person, so a student ID - and the one it was replaced by when a
student became a black belt - is unique for good, current or previous. A
lookup by a previous ID is never ambiguous, and KukGrade can hold that as a
rule: no new student may take an ID any student holds or has held. The
remaining work is the list of previous IDs itself (see "How previous IDs are
kept" above), built 2026-10-20: `students.models.PreviousWksaId`, written when
`update_student` replaces an ID, with the replaced IDs already in the audit
trail carried over by the migration; unique, student-form only (a database
check), refused to any new student (`Student.clean()`), and protected against
a creation racing the change by a per-ID transaction lock
(`students.services.lock_wksa_ids`). The student page shows them, the list
and Django admin search them, and a roster row quoting one is an existing
student, not a new one.

Deleted students too (owner, 2026-10-20: "same for deletions"): deleting a
student retires their current ID and every previous one
(`students.models.RetiredWksaId`), and no new student may take a retired ID.
The migration retires the IDs that earlier deletions' audit events name. A
consequence to know: re-adding a student deleted by mistake under their own
number is refused. A mistyped ID needs no release: it is corrected, not
deleted (above), so the real holder of that number is never blocked.

### 2026-10-19 - Email and credential lifecycle: the packet as amended

Status: Accepted

Decision:
`email-and-credential-lifecycle.md` is the accepted design for optional
transactional email (Resend), administrator-issued temporary credentials,
forced and signed-in password changes, and forgotten-password recovery. The
owner's amendments at its top override the sections they name. In short:
- The parts that work with email disabled are built now (slices 1-4); the
  email slices wait for the packet's readiness condition (v1.0.0).
- Passwords are 16 to 64 characters with an uppercase letter, a lowercase
  letter, a number and a special character, not common and not like the
  user's details - declared by the server, which the frontend renders.
- Temporary passwords are generated by the server, shown once, expire, and
  must be replaced at next sign-in; administrators never choose another
  person's password. If an email cannot be sent, the administrator is shown
  the temporary password once instead.
- Expiry is enforced at sign-in for the API and the Django admin site, and
  the admin site is closed while a change is required.
- `email_enabled` is served by `/api/site/`. The Resend package is used
  behind one transport boundary, with an explicit timeout.
- No default administrator password: a new deployment prompts for the first
  administrator, a superuser. Everyone else is created by an administrator.
- Commits are made per slice, after the owner approves it.

Context:
The owner wrote the packet as the full design; on 2026-10-19 it was checked
against the code. Much of the forced-change lifecycle already exists
(`must_change_password`, `ForcePasswordChangeMiddleware`); temporary
passwords are typed by administrators today, have no expiry, and the Django
admin site is outside the gate. This supersedes in part the 2026-10-18 open
decision on self set-password (F-04), now slice 1.

Consequences:
API changes to come: user creation stops accepting a password,
`set-password` stops accepting one and returns the generated temporary
password once, and `/api/site/` gains `email_enabled` and the password rules.
One new dependency when email is built (the Resend package, with `requests`).

### 2026-10-19 - The Students list shows each student's current grading (F-29)

Status: Accepted

Decision:
The "Next action" column is replaced by "Current grading": the grading the
student is registered for that has not reached its result, linked to the
session, with how far it has got - Registered, Being assessed, Assessed,
Awaiting final decision, or Passed, awaiting promotion - or "Not
registered". The list serves it as `current_grading`
(`gradings.read_models.with_current_grading`), from the same
`unsettled_registrations()` the one-grading-at-a-time rule uses, so the
column and that rule cannot disagree.

Context:
"Next action" was worked out in the browser from status alone ("Follow up
required" for Inactive, which blocks nothing). The owner chose this over
removing the column or showing time at rank.

Consequences:
API addition: `current_grading` (nullable) on each student list row.

### 2026-10-18 - Owner answers on the audit's open decisions

Status: Accepted

Decision:
- **A form taught in parts names every part taught so far (F-09).** The
  cumulative syllabus combines part notation across ranks:
  8-and-under Cho Geup Hyung (part 1 at Blue, 2 at Red stripe, 3 at Red)
  reads "Parts 1-2" at Red stripe and "Parts 1-3" from Red, where it read
  only the latest part. A latest mapping without part notation - the whole
  form, or a range - stands as before
  (`syllabus.services.cumulative_notation`). Assessment items now store this
  wording as `notation` when generated (`gradings/0013`), so a past record
  keeps it; existing items were given the wording they already showed.
- **An assessment stays deletable after lock, by administrators only (D2).**
  Kept for emergencies. Deleting needs the administrator-only cleanup
  permission; the three Master permissions do not grant it, and Django
  admin offers no delete. Tested.
- **The cohort builder bands students by age on the grading date (F-33).**
  With `eligible_for_session`, the student list's `age_band` and its
  `age_band` filter are worked out on that session's grading date, as
  registration does; otherwise today. Banding moved into the query
  (`gradings.age.with_age_band_on`).
- **Which categories are core areas is served (F-31).** Syllabus rows and
  assessment items carry `category_is_core` from
  `syllabus.models.CORE_CATEGORIES`; the frontend's own list is gone.
- **Grading services lock the students they rely on explicitly (D1).**
  `lock_in_session` locked a candidate, assessment or outcome with a query
  that inherited the model's ordering, which joined the session and
  student, so `FOR UPDATE` also locked the student - in row order, not
  ascending, and unstated. The row lock is now bare (`OF self`, no
  ordering). Of its callers, only `apply_candidate_update` relied on the
  student: moving a candidate, changing their testing rank and reinstating
  them now lock and re-read the student after the sessions. Promotion and
  assessment deletion already locked it explicitly.

Context:
The owner answered the open list on 2026-10-18. F-04, F-30, F-29 and F-19
stay open, below. Investigating D1 showed the reinstatement race fixed
earlier that day was covered by the incidental lock, not only the explicit
one.

Consequences:
API additions: `category_is_core` on syllabus rows and assessment items; the
item's `notation` is now stored. The student list's `age_band` depends on
`eligible_for_session`. A race test pins the move/student-edit ordering.

### 2026-10-18 - Screens and contract follow the server's rules (F-25, F-26, F-16, F-33)

Status: Accepted

Decision:
- A list refuses a query parameter it does not declare with a 400 naming it
  (`kukgrade/filtering.py`). Ignoring it returned the unfiltered list.
  `page`, `page_size` and `format` are accepted on every list; actions that
  read their own parameters (the effective syllabus) are unaffected.
- Registering a student a session already holds - withdrawn or not - and
  moving a registration onto such a session answer "Student is already
  registered for this session." on every path, instead of the unique
  constraint's generic message the cohort builder did not recognise.
- The session screen offers "Delete session" from the served
  `can_be_deleted`, in any status, instead of re-deriving the rule. "View
  audit events" appears only with `can_read_audit_log`, always for this
  session, and the audit screen honours the link's `entity_id`. Cancelling a
  locked session asks for its reason as required.
- The assessment screen prepares a missing assessment in a draft or open
  session, the statuses generation accepts.

Context:
The 2026-10-04 audit found each screen restating a server rule and getting it
wrong, and tests pinning the restated rule.

Consequences:
Contract change: an undeclared list parameter is a 400. Two backend tests
that passed parameters no list declares were corrected.

### 2026-10-18 - Integrity guards from the 2026-10-04 audit (F-13, F-14, F-15)

Status: Accepted

Decision:
- `CandidateOutcomeQuerySet.delete()` refuses a finalised outcome, as
  `Model.delete()` already did, so a bulk delete cannot erase a Fail or
  Conditional. The three cleanup services that remove decisions on purpose
  (`delete_candidate_assessment`, `delete_grading_session`,
  `delete_student`) call `models.QuerySet.delete` directly, as they already
  did for promotions.
- The withdrawal-attribution check now also refuses a `WITHDRAWN`
  candidate with no reason, actor or time (`gradings/0012`), making the
  2026-09-26 rule a database guarantee. It is added `NOT VALID`, so rows
  withdrawn before that decision are left as they are, as that entry
  promised, and every new write is checked.
- Deleting an assessment registers its candidate again, as reopening does.
  In a draft or open session a new assessment can be prepared; after lock
  the candidate is resolved by an authorised withdrawal.

Context:
The 2026-10-04 audit reproduced each gap: a bulk delete removed a finalised
Fail; a queryset update produced a withdrawn candidate with no attribution;
deleting an assessment after lock left a COMPLETED candidate with no
assessment, which blocked completing the session.

Consequences:
Tests that wrote a withdrawn candidate directly now withdraw through the
service or write the attribution. Whether an assessment should be deletable
at all once its session is locked is left with the other open questions from
that audit.

### 2026-10-18 - A student is registered for one grading at a time

Status: Accepted

Decision:
Registering a student, or reinstating a withdrawn registration, is refused
while the student has another registration that has not reached its result
(`gradings.services.validate_no_unsettled_registration`, called from
`GradingCandidate.clean()`, so the API, bulk registration and Django admin
all hold). A registration is settled once it is withdrawn, its session is
cancelled, or its outcome is finalised as Fail or Conditional, or as a Pass
that has been promoted. `eligible_for_session` leaves such students out, so
the cohort builder does not offer them. A registration made in error is
corrected by an administrator, not by registering the student again. Moving
or removing a registration stays available to instructors where the session
and assessment rules already allow it (confirmed by the owner the same day:
"keep as is"). Registration and reinstatement both lock the student, the row
two sessions share, so two concurrent attempts cannot both succeed.

Context:
The owner, asked about F-12 of the 2026-10-04 audit: "the student should be
refused ... mistakes should be done through an administrator. To stop there
being multiple workflows it will be too much to keep track of." Until a
grading settles, the student's next rank is not known, so a second
registration would test them for a rank they may already hold.

Consequences:
A student who fails or is given a Conditional can be registered for the next
grading as soon as the Master records the decision; one who passes, once
promoted. Registering twice in one session keeps its own message. Data from
before this rule may still hold a double registration; the entry below keeps
it withdrawable.

### 2026-10-18 - A registration's testing rank is checked when it is chosen

Status: Accepted

Decision:
`validate_testing_for_rank` runs when a registration's rank is chosen: at
registration, and when the registration is moved to another session, has its
rank changed, or is reinstated after a withdrawal. It no longer runs on every
other save (`GradingCandidate.clean()`, `apply_candidate_update`). Promotion
still refuses a candidate whose testing rank is no longer the student's next
rank.

Context:
The 2026-10-04 audit (F-12) found a student registered in two sessions was
stranded in the second once promoted in the first: every save re-checked the
rank against the new current rank, so the second registration could not be
withdrawn before or after lock, nor moved, and could only be finalised into
an outcome that can never be promoted.

Consequences:
The stale registration can be withdrawn (a reason such as Other, "already
promoted") or removed while that is otherwise allowed. New double
registrations are refused by the entry above; this keeps any made before it
recoverable.

### 2026-09-30 - Fixes from the pre-push review of audit steps 1-6

Status: Accepted

Decision:
A review of everything ahead of `origin/dev` found seven defects, all fixed:

- Django admin deletes that a service refuses (a bulk delete that includes
  your own account, for one) are shown as an error message and delete nothing,
  not a server error (`ServiceDeleteMixin`).
- A password someone sets on their own account - through the admin form or the
  API - is owner-chosen: it does not force a second change and is recorded as
  "Password changed", not "Password reset". One rule in
  `accounts.services._password_set`.
- An item edit whose notes differ only by surrounding whitespace writes and
  records nothing, as the assessment-level edit already behaved.
- Session writes no longer compute the four progress counts for the row they
  load; only list and retrieve do.
- Overview's attention list has its own query key
  (`candidateAssessments/attention/<session>`); it shared the session's full
  list key while holding a four-row slice. The session detail screen's update
  invalidates every session list except its own detail.

Consequences:
None change the API schema.

### 2026-09-30 - The club's time zone is declared in the environment

Status: Accepted

Decision:
`DJANGO_TIME_ZONE` (an IANA name, default `Europe/London`; renamed `TZ` on
2026-10-21, below) sets Django's
`TIME_ZONE`. It is validated when settings load, so a typo stops startup with
a message naming the variable instead of failing inside a request.

- It decides the date "today" means: grading dates, student ages and the age
  bands all use `timezone.localdate()`. Stored timestamps stay UTC whatever it
  is.
- Django exports it as the process's `TZ`, so the container needs no separate
  `TZ` variable, and the `python:3.14-slim` image carries the zone data.
  PostgreSQL's own zone is irrelevant: Django talks to it in UTC and the age
  filter is handed the local date as a value.
- The frontend is unchanged: it shows times in the reader's browser zone and
  parses API dates as calendar dates.

Consequences:
Changing the variable changes which day a late-evening or early-morning
request falls on, so ages and session "today" can shift by a day at the
boundary. It is set once per deployment, in `.env.production`.

### 2026-10-21 - The screens show times in the club's time zone

Status: Accepted. Supersedes the "frontend is unchanged" line of
2026-09-30 and the reader's-own-zone rule of 2026-09-24 for timestamps.

Decision:
The club's zone, `TZ`, is served as `time_zone` by
`GET /api/site/`, and `frontend/src/dates.ts` uses it: timestamps are shown
as the club's clock reads, "today" (`todayIsoDate`, `currentYear`) and
"days ago" (`calendarDaysAgo`) are the club's calendar day, counted as
calendar days so a clock change does not move them. Date-only values
(`grading_date`, `date_of_birth`, `effective_date`) still take no zone at
all, so a day never moves whatever the browser or club zone. The zone is
applied as the site settings load; until then, or for a name the browser does
not know, the browser's zone is used (what the screens did before). No second
`TZ` variable was added.

- This also agrees the screens with the server: the audit date filter
  already ran in the club zone while times were shown in the browser's.
- CI still runs the suite in UTC and America/Los_Angeles; the club zone is
  tested across both by setting it to zones far from each.

Consequences:
A reader abroad sees the club's time, not their own. Times carry no zone
label.

Amended the same day (owner): the zone is set once, when the container is
set up, and is not edited in the application - so Settings has no Club tab
and there is no settings model, permission or audit event for it. The
zone is the one variable `TZ`, the name people already know from containers;
`DJANGO_TIME_ZONE` is gone, so there is only one way to set it. A typo stops
startup naming `TZ`. (An editable club name was dropped with it: it is
`KUKGRADE_CLUB_NAME`, set the same way.)

### 2026-09-30 - Read paths ask the server for what they show (KG-A20, A21)

Status: Accepted

Decision:
Screens ask for the rows they display instead of downloading a collection
and filtering it.

- Sessions carry a served `can_be_deleted`, decided by
  `gradings.services.session_deletion_blocker` - the same rule the delete
  endpoint enforces - from a `has_recorded_work` annotation counted in the
  list query. `GET /api/gradings/sessions/years/` returns the distinct years
  of every session's date. The sessions screen takes the current (open)
  session with `status=OPEN&page_size=1`; the Overview takes the open and
  next sessions with two one-to-two-row requests and the open session's
  attention list with `status=COMPLETED,IN_PROGRESS&page_size=4`; move
  targets ask for `status=DRAFT,OPEN`.
- `kukgrade.filtering` gains `choices_in` (comma-separated values, any
  unknown value gives an empty page) and `ordered_by` (a named ordering,
  unknown value gives an empty page). Session `status` and `ordering`,
  assessment `status` and student `status` use them.
- The cohort builder asks `GET /api/students/` for the eligible students
  with `eligible_for_session` (not Left, not already a candidate of that
  session), `age_band` (Postgres `age()` over the date of birth, which keeps
  `calculate_age_on`'s 29 February rule), `current_rank`, `status` and a
  debounced `search`. It no longer downloads the session's candidates to
  hide them. "Add all N matching" still means every match: the screen holds
  the full matching set, because the rank groups and their age mix are
  computed from it, and "Add all" is disabled while a typed filter is still
  settling so it cannot act on a stale list. The outcome drawer's
  retry-after-lost-response asks for one candidate's outcome
  (`outcomes/?candidate=`) instead of the session's.
- Session-scoped screens (session detail, adjudication, ledger) still fetch
  one session's candidates, assessments and outcomes: a session is tens of
  rows, the data those screens render.

Context:
Measured on 40 sessions and 300 students (response bytes, database
queries): years 51 bytes and 1 query; the open session 268 bytes and 2
queries, against 9,183 bytes for all sessions; the open session's attention
list 52 bytes and 1 query; the full roster 51,788 bytes against 17,146 for a
filtered one, both 2 queries. The sessions screen makes four requests
(user, years, current, page) however many sessions are visible; before the
KG-A15 served counts it made two more per visible session.

KG-A21's five read-path items were measured before changing anything.
The per-record history N+1 and the assessment summary's second retrieval did
not reproduce; growth tests now pin both. The other three were real and are
fixed, each with a growth test and the same responses: the users list
primed one permission query per row (102 queries for 100 users, now 4); the
assessment list loaded every item of every assessment to count results (3
queries with item rows, now 2 with none, counted in the database); the
import preview looked up each row's rank and existing student separately
(now constant in the row count).

Consequences:
A new list screen should add a declared filter rather than filter
client-side. The roster still downloads the matching students in full
(about 170 bytes each); if a school outgrows that, the rank groups need a
served count before the table can page.

### 2026-09-30 - gradings/services.py is split by domain (KG-A23)

Status: Accepted

Decision:
`gradings/services.py` keeps the session and candidate rules. Other domains
moved to sibling modules with no behaviour change: `age.py` (age-band
resolution), `read_models.py` (assessment summaries, rank timeline, grading
history), `outcome_services.py` (outcomes and promotion),
`assessment_services.py` (generation, scoring, reopening, deletion) and
`service_support.py` (the per-row bulk runner and the unique-violation
check). Importers name the module that owns the function; there is no
re-export. The concurrency tests pause at each module's own `record` call.

Consequences:
Patch or pause a write path at the module that owns it, not at
`gradings.services`.

### 2026-09-30 - Documentation states which layer enforces each rule

Status: Accepted

Decision:
Each claim the 2026-09-29 audit found overstated is now either made true
or corrected to name the layer that really enforces it (KG-A22).
- **Made true:**
  - An unknown `/api/` URL answers with the JSON error envelope
    (`handler404`, `kukgrade.exceptions.not_found`); other paths keep
    Django's page.
  - Student-import corrections and promotion notes use generated types,
    since the correction fields are now declared on the backend.
  - Several claims were already true after the earlier fixes: forced
    password change (A01), admin writes (A14), session counts (A15),
    no-op student updates, and bulk-row independence (A11).
- **Corrected:**
  - Model-level guards cover session status, deletion, finalised outcomes,
    promotions, audit events and imported source text. Assessment snapshot
    and completion rules are service invariants, enforced by services,
    serializers and admin but not against a raw ORM write.
  - The schema declares every request and success response; errors share
    one envelope that is not modelled per endpoint.
  - Readiness keeps its own `503` payload for its monitor.
  - `PaginatedResponse<T>` and `FieldErrors` are the only hand-written
    frontend types.

Context:
The audit's rule: a document saying something is done is not evidence that
it is. Model-level guards for assessments were not added here. That would be
a separate design choice about admin corrections and reopening.

Consequences:
Contract change: `StudentImportRequest.corrections` now names its six
fields.

### 2026-09-30 - Overview activity status comes from the action, not the prose

Status: Accepted

Decision:
The Overview's recent-activity status is the event's `action_display`, plus
the outcome from its metadata for a proposal or final decision (KG-A19).
- Green: a promotion, or a Pass finalised.
- Amber: Fail or Conditional finalised, or a withdrawal.
- In progress: a started assessment, or a proposal awaiting decision.
- Neutral: everything else, including actions the screen does not know.

The column that showed the actor under a "Student" heading is now "By".

Context:
The screen matched words such as "pass", "complete" and "promot" in the
summary, so a password reset and "finalised as FAIL, overriding PASS" both
read "Approved".

Consequences:
None beyond the Overview.

### 2026-09-30 - Scoring saves are sequenced per item, refetched once

Status: Accepted

Decision:
Mat-side scoring keeps several item saves in flight (KG-A18):
- Writes to one item go out in order, each after the previous one lands,
  so the server keeps the last choice. Different items still save in
  parallel.
- Each save confirms or rolls back only its own item, and only if nothing
  newer was written to it. It never restores a snapshot of the whole list.
- The item list, rollup and assessment are refetched once, when every save
  has landed. A refetch between saves would overwrite those still in flight.
- "Complete assessment" waits until no save is pending, counted across every
  save rather than only the latest.

Deleting an assessment removes its cached record, items, rollup and notes
draft, and refetches outcomes, promotions, students, candidates, session
counts and assessment lists, since the delete can remove an outcome and a
promotion and revert a rank. The overall-notes draft is keyed by assessment
rather than candidate. Completing or reopening an assessment also refetches
the session counts.

Context:
A failed save restored a snapshot of the whole list, erasing other saves
still showing on screen. Two quick edits to one item could land at the
server in either order. Every save triggered a refetch that could overwrite
pending ones. Completion looked only at the latest save.

Consequences:
None beyond the scoring screen; the API is unchanged.

### 2026-09-30 - Grading decisions wait for their evidence

Status: Accepted

Decision:
An outcome is proposed, decided or promoted only on data that loaded
(KG-A16).
- The proposal drawer's Submit and the board's single-candidate "Record
  decision" are disabled until the assessment's counts and items have
  loaded. A failure offers a retry.
- The promotion ledger shows no rows and offers no promotion unless
  candidates, outcomes and promotions all loaded.

A proposal recovers from a lost creation response (KG-A17): if creating the
outcome fails, the drawer looks for that candidate's outcome in the session
and proposes against it. Any other failure is still reported. Every way of
closing the drawer was already blocked while it saved.

Context:
A failed evidence request left the drawer's Submit active. A failed
promotions request made already-promoted students look eligible. If a
creation response was lost, a retry was refused because the outcome
already existed.

Consequences:
The board's bulk "Record staged decisions" still acts on the served list
counts it shows, which already block the whole board when they fail to
load.

### 2026-09-30 - Session progress is counted once, on the server

Status: Accepted

Decision:
Each grading session carries `candidate_count`,
`completed_assessment_count` and `awaiting_decision_count`, counted in the
database by `gradings.services.with_session_progress` (KG-A15). A withdrawn
candidate counts in none of them. An assessment counts as complete only
when it is `COMPLETED`. Awaiting a final decision means a completed
assessment whose outcome is not finalised. The sessions list and the
overview both read these counts, instead of counting a first page of
assessments themselves.

Context:
The sessions screen counted in-progress assessments as "complete", treated
every completed assessment as awaiting a decision, and counted only the
first 50 of each. It also made two list requests per table row to get its
numbers.

Consequences:
The session list's row counts no longer cost two requests per row (part of
KG-A20). Listing more sessions adds no queries, which a test pins.

### 2026-09-30 - Every write path is audited like the API's; candidate PATCH only moves

Status: Accepted

Decision:
From the 2026-09-29 audit, KG-A13 and KG-A14.

- **Candidate `PATCH` moves a registration to another session and does
  nothing else.** The app sends only `session`; student, testing-for rank,
  status and withdrawal fields are read-only there. Status changes go
  through `bulk-update-status`, and a locked-session withdrawal through
  `withdraw`, which is where the app already sent them. Candidate `notes`
  are no longer served or accepted by the API, since no screen reads or
  writes them. The column stays, and admin still edits it through
  `apply_candidate_update`. The outcome `PATCH` route the audit named had
  already been removed on 2026-09-28.
- **Django admin writes through the services for every action.**
  - Student and user deletes call `delete_student` and
    `delete_platform_user`, including for records with history, which
    Django's own collector would have refused.
  - Admin's password form finishes like an administrator reset: the owner
    must choose a new password, and the change is audited.
  - `is_staff` and `is_superuser` go through `set_admin_site_access`, which
    records `USER_UPDATED`.
  - Groups and per-user permissions are read-only in admin. Master
    authority is granted only through `set_user_authority`, which keeps its
    rule that an administrator never holds final-decision authority.
- **A password change and its audit event share one transaction**
  (`reset_password`, `change_own_password`).
- **Session details and assessment notes are audited.** `SESSION_UPDATED`
  and `ASSESSMENT_UPDATED` record the changed fields with both versions,
  as an item's notes already were. A resent unchanged value writes and
  records nothing.

Context:
The audit found admin deletes, authority edits and password changes that
skipped the domain services, so an admin change and the same change through
the API left different state and a different audit trail. It also found a
session edit and a notes-only assessment edit recording nothing.

Consequences:
Contract change: the candidate request and response shapes, and two new
audit actions (`audit/0007`). The schema, generated types, audit-screen
labels and `api_contract.md` are updated.

### 2026-09-30 - Import files, expiry, preview validity and spreadsheet limits

Status: Accepted

Decision:
The repairs to `data_imports` from the 2026-09-29 audit (KG-A07 to A10), and
the removals a review of that work found.

- **A source file is deleted only after its batch's transaction commits.**
  Commit, cancel and expiry clear the batch's reference to the file inside
  their transaction and delete the file from `transaction.on_commit`. A
  failed save, audit record or enclosing transaction therefore leaves the
  batch open with its file intact, and the batch can be retried. A delete
  that fails after the commit is logged, not reported as a failed import,
  because the import did succeed.
- **Expiry is a lifecycle service**, `expire_import_batch`. It takes the
  batch lock that commit and cancel take and rechecks status and age under
  it, so exactly one terminal transition wins. The command only selects
  candidates and runs each batch in its own transaction; it carries on past
  a failure and exits non-zero. `--hours` must be at least 1.
- **Orphaned files are swept.** The same command deletes stored files that
  no batch names once they are older than `--hours`. That covers a file
  saved for a batch whose creation rolled back, and a file whose
  post-commit delete failed.
- **Preview validates a row with `Student.full_clean()`**, the field and
  `clean()` rules `create_student` runs on save, so a row marked Ready can
  be committed. The checks that each cost a query and repeat one preview
  has already made (the rank's existence, the two check constraints) are
  skipped, keeping preview at its previous two queries a row. A refusal at
  commit can then only come from a concurrent change, and it is reported
  with the row number and reason. The batch stays all-or-nothing.
- **Every upload is bounded while it is read.** The upload's declared size
  is checked first, and the read is capped at the limit. An `.xlsx` archive
  may expand to at most 50 MiB and hold at most 2,000 parts, judged from the
  sizes it declares; Python's zip reader never reads past a declared size.
  A roster reads at most 5,000 rows after the header, blank rows included,
  and 50 columns. A legacy workbook reads at most 500 sheets, 50 columns and
  50,000 rows across all its sheets, unknown sheets included. A workbook is
  always closed. Rows are counted as they are read: in read-only mode a
  4.8 KB workbook with one cell at row 1,048,576 reads as a million rows,
  and is now refused after 5,000.
- **A roster's blank rows are skipped**, and each remaining row keeps its
  own row number in the sheet, so corrections still line up.
- **A legacy workbook is fully parsed at upload.** One that cannot be read,
  or that yields no records, is refused before anything is stored. The
  refusal carries the adapter's warnings.
- **Batch statuses are the ones the lifecycle uses**: `UPLOADED`, then
  `COMMITTED`, `CANCELLED` or `EXPIRED`. `NEEDS_REVIEW`, `READY`, `PARTIAL`
  and `FAILED` were never assigned and are removed (`data_imports/0003`),
  superseding deviation 4's "kept in the enum for forward compatibility" in
  the 2026-09-21 entry: a partial commit would be designed afresh.
- **Batch responses carry what the app reads**: commit returns `id` and
  `summary_json`, creation returns `id` and its one-shot extras. `kind`,
  `status` and `status_display`, and the always-empty `summary_json` on
  creation, are no longer served.
- **The historical import screen shows the duplicate-file warning** the
  roster screen already showed. Importing the same workbook twice creates a
  second copy of every record, and historical records are voided, never
  deleted.
- **Tablib is replaced by reading with openpyxl and `csv` directly.**
  Tablib always loads a whole file before any limit can be checked. openpyxl
  was already installed through `tablib[xlsx]` and imported directly by the
  workbook adapter; it is now a declared dependency, and `tablib` is
  removed. This supersedes deviation 1 of the 2026-09-21 "Student roster
  bulk import" entry.

Measured with `tracemalloc`, which slows the runs, on synthetic fixtures:

- A 5,000-row, 6-column roster parses in 0.7 s with a 4 MB peak.
- A roster at both limits (5,000 rows by 50 columns) takes 5 s with a 23 MB
  peak.
- A 200-sheet history workbook takes 2 s with a 9 MB peak.
- A workbook at the 50,000-row budget takes 6.6 s with a 28 MB peak.

Context:
The audit found the following:

- A file was deleted before the database write it belonged to, so a
  failure left an open batch with nothing to read.
- Expiry ran without the batch lock, so it could overwrite a commit.
- Preview checked a subset of the student rules, so a 33-character WKSA ID
  was marked Ready and then failed at commit.
- Spreadsheet limits were checked only after a whole file was loaded.

Consequences:

- Tests that assert a file is gone run the captured on-commit callbacks.
- Tests upload to a throwaway temporary directory, not the development
  server's `var/import_uploads`.
- The request body itself is not bounded by the application. Django writes
  a large upload to a temporary file before the view can refuse it, so the
  production proxy should cap the request body size.

### 2026-09-29 - Every grading assesses the cumulative syllabus

Status: Accepted

Decision:
A grading assesses everything examinable through the rank being tested for,
for the candidate's age band - not only the material that rank introduces.
The owner's words: "we test everything every grading... they have to
demonstrate knowledge cumulatively." One resolver,
`syllabus.services.effective_syllabus_requirements`, serves the syllabus
screen and is what assessment generation snapshots, so the two cannot
disagree. It covers every category - the six core areas, Techniques, Forms
and Weapons - in syllabus order: the chart's category order, then the order
items were introduced. Where a later rank extends an item, its latest range
applies. Every item stays required: each is marked Met or Not met before the
assessment can be completed, and a session still locks only when every
assessment is complete.

A rank with no requirement of its own for an age band has no recorded
syllabus. The resolver returns nothing for it and generation refuses, naming
the rank, rather than presenting everything through the rank below as its
curriculum. Today that is White, and KSN upwards.

Assessment items gain `position`, their place in the assessment in syllabus
order; items are listed and numbered by it. The copied `requirement_sequence`
stays on the snapshot as trace data but no longer orders it - it is only an
item's place among its own rank's requirements - and is no longer served.

Jo Kyo Nim, settled the same day: adults do all seven black-belt technique
sets, the five the chart marks for 13-17 plus Mohk Joh Leu Ki and Bahng Too
Ki (`syllabus/0003`). The weapons are Sword Techs 1-5 and Bohng Dol-li-ki
(staff spinning) 1-15, or 1-10 for 12 and under as the Junior chart says.
Weapon forms and staff sparring follow JKN, with the 2nd Dahn syllabus, which
is not recorded yet.

`GET /api/syllabus/items/` is removed: the syllabus screen reads the core
areas from the effective view with everything else. Supersedes the endpoint
list in the 2026-06-23 "Syllabus catalogue foundation" entry: the syllabus is
read only through `GET /api/syllabus/requirements/effective/` and the age
bands, and no plain item or requirement list remains.

Context:
The 2026-09-29 independent audit (KG-A05) found generation used only the
testing rank's own rows while the syllabus screen showed the cumulative view:
an adult testing for Blue Stripe was assessed on Sohn Mohk Soo and Cho Geup
Hyung but not Sohn Ppae Ki, Ki Bohn Soo or Ki Cho Hyung. The screen showed no
weapons, and for KSN and above showed everything through JKN as if it were
their curriculum. KG-A06, the student list's age-band filter, no longer
applies: the filter was removed as unused earlier the same day (03a45df).
Every age band is computed by `resolve_age_band`.

Consequences:
Assessments are larger and all required: 22-29 items at JKN against 11-14
before, 9-11 at Blue Stripe. Assessments generated before this change keep
the content they were generated with - snapshots are never regenerated.
Their items are numbered in the order they were already listed in, and
nothing else on them changes. Recording the 2nd Dahn syllabus and above, in
its own chart version, is future content work.

### 2026-09-29 - One grading lock protocol: session, then students

Status: Accepted

Decision:
Every grading write takes its row locks in one order (`gradings/locking.py`):
the grading session first, then the session's own rows and any students,
students in ascending id. A session's lock coordinates everything inside it.
Validation runs only against rows re-read under the locks, and services apply
the requested fields to the locked row instead of saving the instance they
were handed. Bulk operations take every lock before their first row's
savepoint. Locks are taken by join-free queries.

Context:
The 2026-09-29 independent audit (KG-A03, KG-A04, KG-A11, KG-A12) found that
row locks on individual rows could not make cross-row rules atomic, and each
schedule it described was reproduced on PostgreSQL before the fix: an item
cleared while its assessment completed, a reopen or registration landing in a
session that had just locked, a withdrawal deleting a decision finalised
moments before, cleanup rolling a rank back over a newer promotion, bulk
promotion and session cleanup deadlocking, and stale full-row saves undoing a
cancellation, a status change, a note or a password change. A role change and
a Master grant could both succeed. Separately, a lock query that joined the
student's rank dropped a student whose rank had just moved, a 500 in
`promote_candidate`.

This does not reverse KG-021 (2026-09-13), which removed session and student
locks picked up *incidentally* through `select_related`, in no order - the
contention and deadlock surface it warned about came from that. These locks
are deliberate, explicit and ordered.

Consequences:
Writes inside one session run one at a time. Each is a single-row edit that
takes milliseconds, so live grading by several instructors is unaffected at
this club's scale; revisit if a session ever holds long-running work.
`delete_student` locks the student's sessions before the student, and asks
for a retry in the rare case they register elsewhere in between. Hard-deleting
a user still reassigns attribution rows without session locks; it touches
attribution columns only, and PostgreSQL would resolve any deadlock by
refusing one side.

### 2026-09-29 - Opening a grading session is confirmed

Status: Accepted

Decision:
"Open session" opens the same confirmation dialog as Lock, Complete, Cancel
and Delete. It states how many non-withdrawn candidates are registered, that
an open session cannot go back to draft (`DRAFT -> OPEN` is one-way in
`ALLOWED_SESSION_TRANSITIONS`), and that a candidate who already has an
assessment can no longer be moved or removed. Nothing changes in the API or
the transition rules.

Context:
Agreed with the user 2026-09-29 after the PR #8 review finding: the roster is
meant to be registered and checked in `DRAFT`, and `OPEN` should mean it is
confirmed. Opening was the only lifecycle transition made with one click.

### 2026-09-29 - The server says whether a registration can be moved or removed

Status: Accepted

Decision:
Every candidate carries `can_be_moved` and `can_be_removed`, computed by
`candidate_can_change_session` and `candidate_can_be_deleted` from the same
validators the `PATCH` and `DELETE` use. The session screen shows "Move…" and
"Remove" only when they are true, and the Remove dialog no longer claims it
removes recorded assessment work. The write rules themselves are unchanged: a
candidate with an assessment cannot change session, and can be removed only
while the session is `DRAFT` and the assessment is `NOT_STARTED`.

Context:
Code review of PR #8 found that the roster offered Remove in every `OPEN`
session, but assessments are normally generated at registration, so the
common case ended in a 400. Move had the same fault. Gating on session status
in React would have restated a grading rule the backend owns.

Consequences:
A registration made in error in an `OPEN` session that already has an
assessment cannot be removed from the roster; the administrator-only
assessment delete is the way out. Relaxing the rule to allow removing an
unstarted assessment in an `OPEN` session is a separate decision.

### 2026-09-29 - Cancellation reason is write-only; the redesign handoff is retired

Status: Accepted

Decision:
`GradingSession.cancellation_reason` is accepted when a session is cancelled
but is never served: no screen reads it, so it is `write_only` in the
serializer and absent from `schema.yml`. The database column and the audit
event keep the reason. The final-decision board shows a failure with a retry
control, not an empty cohort, when any of its four requests fails. The
unused `percent` and `remainingRequiredCount` helpers and the `--color-ink`
token were deleted. `docs/assessment-grading-redesign-handoff.md` was
deleted: every decision it carried is recorded here and in the design
register.

Context:
Completes the "API serves what the app uses" rule for the last field the
app never read, and removes a stale planning document that had begun to
disagree with the code.

### 2026-09-29 - Assessment list serves overall counts; measured contrast tokens

Status: Accepted

Decision:
Each `CandidateAssessment` in the API carries `overall`, the counts block
`candidate_assessment_summary` already produces, and the list prefetches
items so its query count is constant. The board reads it instead of one
summary request per candidate. Status colours were adjusted until text meets
4.5:1 on its own surface in both themes, filled status colours gained
`--color-on-success` / `--color-on-danger`, and focus outlines use the solid
`--color-accent-strong`.

Context:
Slice 8. A 40-candidate cohort made 40 summary requests on opening the
board. The browser measurement found warning text at 3.1:1 in light, white
on the dark success fill at 3.3:1, and a translucent focus outline near
1.3:1 against white.

Consequences:
The counts have one implementation (the service) and one schema shape. The
token changes apply everywhere those tokens are used, not only on the four
grading surfaces.

### 2026-09-29 - The API serves what the app uses

Status: Accepted

Decision:
Every list filter and every response field is kept only while a screen reads
it. Unused filters, duplicated fields (a code alongside its name, a display
label the client can derive, a denormalised id), attribution ids, and preview
rows the UI never renders were removed from the serializers, the views and
`schema.yml`. A field is added back, with a test, when a screen needs it.
Database columns that hold audit or business data are not removed with the
response field: attribution, cancellation and withdrawal reasons and the
import provenance stay, and attribution is read from the database and the
audit log. `ImportBatch.error_summary`, which nothing wrote or read, was
dropped by migration.

Context:
Unused API surface is untested behaviour that still has to be kept correct,
reviewed and secured, and duplicated fields can disagree. The frontend's types
are generated from the schema, so `tsc -b` shows exactly which removed field a
screen still reads.

Consequences:
Removing a field is a contract change: regenerate `schema.yml` and the
frontend types, and update `docs/api_contract.md`. Health and readiness
responses are kept as they are because monitors read them.

### 2026-09-28 - HSTS without preload

Status: Accepted

Decision:
Production sends HSTS for one year including subdomains, without the
preload token. `DJANGO_SECURE_HSTS_PRELOAD=true` opts in; the `check
--deploy` warning for a missing preload (`security.W021`) is silenced only
while preload is off.

Context:
Preloading puts kukgrade.co.uk and every subdomain into browsers as
HTTPS-only, which takes months to undo, and the token alone lets anyone
submit the domain. The only gain is protecting a first-ever visit, which
Cloudflare's HTTPS redirect already covers. Agreed with the user 2026-09-28.

### 2026-09-28 - Two-hour idle sign-out; two trusted proxies

Status: Accepted

Decision:
A session ends after two hours with no request; each request restarts the
two hours. Production trusts two proxy hops, Cloudflare then Traefik.

Context:
Confirmed by the user 2026-09-28: "if the session is idle for 2 hours ...
it's logged out", and the site will sit behind Cloudflare and Traefik.

Consequences:
The frontend signs the viewer out as soon as any request reports the session
has ended and drops everything it had cached. The proxy count is only correct if Traefik trusts Cloudflare's
ranges and the host takes web traffic only from Cloudflare - see
`deployment.md`.

### 2026-09-28 - Three withdrawal reasons and Other, served

Status: Accepted

Decision:
Withdrawal reasons are Injured during grading, Withdrew voluntarily, Did not
attend, and Other, which requires a note (model check and database
constraint). `GET /api/gradings/withdrawal-reasons/` serves them with
`note_required`; the locked-withdrawal dialog lists them as radio buttons.

Context:
The user asked for three reasons and an Other, easy to pick, read from the
server. "Registered in error" is covered by Remove registration before lock;
after lock it is Other with a note. Existing `ADMIN_ERROR` rows are migrated
to `OTHER` with "Registered in error." kept in the note.

Consequences:
Audit events written before the change keep the old reason code in their
metadata; they are immutable.

### 2026-09-28 - Each rank carries its belt colours

Status: Accepted

Decision:
`Rank` has `belt_colour` and `stripe_colour`, seeded by migration and served
on `/api/ranks/`. One frontend `BeltSwatch` draws every rank from them.

Context:
Two belt icons guessed colours from rank names and disagreed with each other
and with the belts. A stripe rank is the belt below with a stripe of the
colour it is working towards: Yellow stripe is white with yellow, Blue stripe
is yellow with blue, through Black stripe, brown with black. Confirmed by the
user 2026-09-28.

Consequences:
`RankVisual` and the syllabus screen's own swatch are deleted, with their
per-screen CSS. A `stripe_count` carries Dahn Bo: a brown belt with two black
stripes (the user, same day; it can be more, and two is the symbol). PSBN and
above wear a thicker belt; until the black-belt titles' appearance is decided
they are served as plain black.

### 2026-09-28 - Age bands and their programmes are served

Status: Accepted

Decision:
`GET /api/syllabus/age-bands/` lists the four age bands with their label,
description and programme (`JUNIOR` or `ADULT`). The syllabus and
cohort-builder screens read it; neither restates the bands.

Context:
The syllabus screen held its own table of bands, labels, descriptions and a
junior/adult "track"; the cohort builder repeated the labels and split
"Kids"/"Adults" by listing band codes. That is syllabus data held in React,
twice, in two vocabularies. The programme and description now sit beside
`AgeBand` in `syllabus/models.py`, with a test that every band has both.

Consequences:
The cohort builder's age mix reads "Junior & Little Dragon n | Adult & Youth
n" rather than "Kids n | Adults n", and the syllabus labels use the
backend's "9-12" rather than "9 – 12".

### 2026-09-28 - The API serves what the application uses

Status: Accepted

Decision:
Removed `GET /api/gradings/outcomes/{id}/summary/`, the `PATCH` stub on
`/api/gradings/outcomes/{id}/`, `PUT` on grading sessions and candidates, and
the assessment serializer's `item_counts`. `can_be_graded` moved from the
student detail to the student list, and the cohort builder filters on it.
Confirmed the same day: every single-record `GET` the application never
calls is removed too (audit event, import batch list and detail, assessment,
assessment item, outcome, promotion, legacy record, rank, syllabus item),
along with the syllabus requirement list and detail - requirements are read
only through `/effective/`. Candidates are registered only through
`bulk-register`; the single `POST /api/gradings/candidates/` is gone.
Candidate `PATCH` and `DELETE` stay, and the session screen now offers them
as "Move to session" and "Remove registration".

Context:
After slice 6 nothing called the outcome summary: it returned the same
payload as the assessment summary, which every screen now reads.
`item_counts` had no reader and lacked the required-split the screens need.
The outcome `PATCH` stub existed only to answer 405, but it made the schema
advertise a write that does not exist. `PUT` duplicated `PATCH` on the two
viewsets that had not already excluded it. The cohort builder re-derived
grading eligibility from `status !== "LEFT"` while the server already served
the rule on a representation the builder did not read.

Consequences:
Contract, schema and generated types updated. `/api/students/{id}/` no
longer carries `can_be_graded`; the list does.

### 2026-09-28 - The frontend derives no authority and no rank progression

Status: Accepted

Decision:
`/api/auth/me/` reports each administrator capability from the permission
its action checks, and `can_read_audit_log` from the backend rule itself;
routes and controls read those flags and never `role`. Each rank carries
`next_rank` from the one next-rank rule the grading services use. Audited
entity types are declared (`AuditEntity`) and published as an enum.

Context:
The UI mirrored backend rules in the browser - role checks for
administrator actions after the backend had moved to permissions, a copy
of the audit-log rule, the next rank computed three different ways, and a
hand-kept entity list - each of which could drift from the server, and one
already had (a dead `"Candidate"` comparison).

Consequences:
`permissions.ts` is removed. `role` is read in the UI only where the rule is
about the role (whether a managed user is an administrator).

### 2026-09-26 - List filters are declared once and published in the schema

Status: Accepted

Decision:
Each list view declares its query filters in `query_filters`
(`kukgrade/filtering.py`); a default filter backend applies them and
supplies them to the OpenAPI schema. Boolean filters accept only
`true`/`false`.

Context:
Filters were parsed by hand in each `get_queryset`, and none reached the
schema, so the frontend hand-wrote every list-parameter type against the
"never hand-write an API type" rule. The boolean filters also disagreed:
`required` accepted `1`/`yes`, and `linked`/`voided` ignored an invalid value
where every other filter returned an empty page.

Consequences:
No new dependency (django-filter was not needed for this). `required=yes` and
similar now return an empty page. A test checks every declared filter appears
in the schema.

### 2026-09-26 - A session locks only when grading is complete; completed assessments reopen until then

Status: Accepted

Decision:
`OPEN -> LOCKED` requires every non-withdrawn candidate's assessment to be
`COMPLETED`. Item results and completion are only accepted while the session
is `OPEN`. While it is open, a completed assessment can be reopened
(`POST /api/gradings/assessments/{id}/reopen/`, audited
`ASSESSMENT_REOPENED`), keeping every result and its attribution. A
registration always starts `REGISTERED`.

Context:
Confirmed 2026-09-25: the session stays open until the instructors are happy
with every record, and locking marks the end of grading. Previously a session
could lock with assessments still in progress and scoring continued after
lock, so "locked" did not mean the record was final, and a completed
assessment could not be corrected at all. Supersedes the "locked sessions can
finish work already in progress" behaviour in the 2026-06-23 assessment
snapshot foundation entry.

Consequences:
A locked withdrawal now applies to a graded but undecided candidate. The
correction workflow after lock (for a finalised outcome) is still open and
will be tuned in beta with the instructors.

### 2026-09-26 - Every withdrawal has a reason; a registration's student is fixed

Status: Accepted

Decision:
Withdrawing a candidate before the session locks requires a reason from the
same list as a locked withdrawal and records who and when; reinstating clears
it. The bulk no-show action sends `ABSENT`. A registration's `student` can no
longer be changed; moving a registration to another session is still allowed.

Context:
Confirmed 2026-09-25: a withdrawal before lock previously recorded nothing,
while one after lock required a reason - so the record could not say why most
candidates had not graded. Swapping the student rewrote what a registration
meant; remove and re-register instead. Moving session stays, pending a
possible "deferred" concept.

Consequences:
Enforced in `update_candidate` for withdrawals and in the model's `clean()`
for the student, so the API, bulk endpoint and Django admin all hold. Existing
withdrawn rows without a reason are left as they are.

### 2026-09-26 - Audit events keep the actor's identity through user deletion

Status: Accepted

Decision:
`AuditEvent` copies `actor_email` and `actor_name` when written. Deleting a
user still re-points `actor` to the deleted-user placeholder, but the copies
are never changed. The placeholder can never be active.

Context:
Deleting a user rewrote `actor` on every event they had caused, and nothing
else on the event named them - so the audit trail forgot who made the final
decisions, promotions and edits it exists to prove. Confirmed requirement:
"we should definitely know who was deleted and by who... instead of a full
erasure otherwise it's not auditable."

Consequences:
Migration `audit.0006` adds the fields and backfills them from each event's
current actor; events already re-pointed before it keep the placeholder's
identity. Refines the 2026-09-21 hard-delete entry, which still stands for
every other attribution field.

### 2026-09-26 - Audit-log access and any-status session delete follow the permission, not the role

Status: Accepted

Decision:
Both checks read `User.role` directly, against the documented rule that
role is a label for group membership and is never consulted when
authorising a request (see `docs/permissions.md`). The Administrator group
now carries `audit.view_auditevent` and a new
`gradings.delete_any_gradingsession`; the checks ask for those permissions
instead.

Context:
`accounts.permissions.can_view_audit_log` and
`validate_session_can_be_deleted` (2026-09-16 and 2026-09-20 entries) both
special-cased `user.role == User.Role.ADMINISTRATOR`, so an instructor
granted equivalent authority directly - which the four sensitive
permissions exist precisely to allow - still could not do either. Found
during the pre-merge audit of the `fix/audit-step1-defects` branch.

Consequences:
Migration `gradings.0009_candidate_from_rank_and_delete_any_permission`
adds the permission (folded into an already-pending migration on this
branch rather than issued as its own number). Tests grant each permission
to a plain instructor and prove access follows it rather than role.
Supersedes the role check in the 2026-09-16 "Audit log is
administrator-or-Master" and 2026-09-20/2026-09-22 cancelled/any-status
session delete entries; their access rules are otherwise unchanged.

### 2026-09-25 - A candidate records the rank held at registration

Status: Accepted

Decision:
`GradingCandidate.from_rank` snapshots the student's current rank when the
candidate is created. It is read-only through the API and admin and never
changes (a registration's student is fixed - see the 2026-09-26 entry).

Context:
The completion proof and the promotion ledger showed the student's live
`current_rank` as the starting rank. After promotion that is the rank the
candidate was testing for, so a sealed record read "Yellow -> Yellow". The
ledger also looked the rank up by student id in a rank-id map, and the
assessment screens found the student by a WKSA-ID substring search. A record
that changes after the fact is not reproducible, which the grading rules
require.

Consequences:
Migration `gradings.0009` adds the field and backfills it: a promoted
candidate's own `Promotion.from_rank`; otherwise the rank reached by the
student's latest promotion before the session date; otherwise where their
first later promotion started; otherwise their current rank.

### 2026-09-25 - Multiple Masters are permitted; no cap is enforced

Status: Accepted

Decision:
`can_make_final_grading_decision` may be granted to more than one
instructor at once. Nothing in the API or admin limits how many users
hold it.

Context:
The 2026-09-16 "Master authority is administrator-exclusive" entry's
Context paragraph paraphrased the stated reasoning as "exactly one
designated Master should make final decisions", and
`docs/current-system.md` and `docs/permissions.md` then repeated that as
confirmed policy. Asked directly: "no, the grant can be given to
authorised masters as needed to make the final decisions, if the school
acquires another master level authority then they will be granted the
rank of master" - a second Master is a normal outcome, not an exception.
The 2026-09-16 rule itself is unaffected: an administrator can still
never hold this permission.

Consequences:
No code change - nothing ever enforced a cap, so this corrects the
documents rather than the system. `docs/current-system.md` and
`docs/permissions.md` are updated to state that multiple Masters are
expected, not exactly one.

### 2026-09-24 - One document per job; every API shape declared in the schema

Status: Accepted

Decision:
Retire the documents that had become history rather than guidance - the
completed `backend-completion-spec.md`, the `frontend-next-steps-handoff.md`
agent handoff, the `HANDOFF.md` tombstone, the superseded
`audits/remediation-status.md` register, and the legacy planning inputs
`data_model.md`, `grading_app_planning.md`, `domain-model.md` and
`syllabus-model.md`. Fold the still-valid parts of `testing-strategy.md` into
`development-workflow.md`, which now holds the one canonical list of
verification commands. Give each remaining document one job (see
`docs/README.md`), and keep `api_contract.md` to implemented endpoints only.
Summarise the external import specification's sixteen locked decisions in
`data-import-and-legacy-migration.md` so code comments citing "import
Decision N" resolve inside the repository.

Declare every custom API action's real request and response with
`@extend_schema`, serialize the bulk, summary, and import responses through
those declared serializers, alias every frontend API type to the generated
schema, and have CI regenerate `backend/schema.yml` and fail if it is stale.

Context:
A repository-wide review (`audits/2026-09-24-coherence-audit.md`) found the
same facts stated in three or four documents that had drifted apart - three
different mypy app lists, `PATCH` versus `POST` for the same endpoint - and
code citing sections of a specification nobody could open. It also found
that the 2026-09-14 "generate, never hand-write" decision had quietly
lapsed: seventeen actions were undeclared, so the published schema described
the wrong bodies, the frontend hand-wrote their types, and one of those types
drifted far enough to report a partly failed bulk promotion as a complete
success. Nothing checked that the committed schema matched the code.

Consequences:
Deleted documents remain in Git history. The KG-numbered dated audits stay,
since code and this log cite their findings. An API shape change now updates
the serializer, the regenerated schema and types, and `api_contract.md`
together, or CI fails. Supersedes the 2026-06-25 "Documentation truth and
audit remediation tracker" entry.

### 2026-09-24 - Parse API dates through one shared module, and run the frontend suite in a second timezone

Status: Accepted

Decision:
All API dates are parsed through `frontend/src/dates.ts`, which detects
date-only values and splits them into local year/month/day, and keeps normal
parsing for timestamps. CI runs the frontend suite twice: once as it did, and
once with `TZ=America/Los_Angeles`.

Context:
The API returns two shapes. Date-only values (`grading_date`,
`Promotion.effective_date`, `Student.date_of_birth`,
`GradingHistoryItem.date`) are read by `new Date()` as UTC midnight, so west of
UTC they render as the previous day. Timestamps (`created_at`, `promoted_at`,
`generated_at`, `completed_at`) carry an offset and must keep rendering in the
reader's own timezone.

The same formatter had been written six times across the app with three
different parsing strategies. Two were wrong: `PromotionLedgerScreen` showed
the day before the grading for `grading_date` and `effective_date`, and
`StudentDetailScreen` did the same for `date_of_birth` and promotion dates.
`calculateAge` shared the defect, which matters beyond display: age decides the
age band, and the age band decides which syllabus a candidate is assessed
against.

The shape is detected from the value rather than chosen by the caller, because
several formatters receive both kinds - `StudentDetailScreen` formats
`date_of_birth` and `created_at` through the same function.

The CI change is part of the fix rather than an extra. The runner is UTC, and
this class of bug is invisible there: with the defect reintroduced, the UTC run
passes 187/187 while the `America/Los_Angeles` run fails 5. Tests asserting
these fields gave no protection at all before.

Two tests asserted timestamps in UTC-specific form (`UsersScreen` on
`last_login`, student detail on `created_at`). Those were test defects, not
product bugs - a timestamp *should* render differently by timezone - so the
expected values are now derived from the same formatter rather than hard-coded.

Consequences:
The suite passes in UTC, America/Los_Angeles, Pacific/Auckland, Asia/Kolkata,
Pacific/Kiritimati and America/Sao_Paulo. New date formatting goes through
`dates.ts`; the remaining correct-but-duplicated formatters in
`GradingSessionsScreen`, `GradingSessionDetailScreen` and `OverviewScreen`
were left alone at the time rather than churn working code - consolidated
2026-09-26, along with `AuditScreen`, `UsersScreen` and
`CreateGradingSessionScreen`, which had the same duplication.
`BuildGradingCohortScreen` never had its own date formatter.

### 2026-09-23 - Expose the assessment summary on the assessment resource

Status: Accepted

Decision:
Add `GET /api/gradings/assessments/{id}/summary/` returning
`candidate_assessment_summary(assessment)` - the same service and response
shape `GET /api/gradings/outcomes/{id}/summary/` already returns.

Context:
FDR-046 said assessment counts must be served rather than recomputed in React.
Checking the serializers showed that is not currently possible while an
assessment is being scored. `CandidateAssessmentSerializer.get_item_counts`
returns only `total`, `required`, `met`, `not_met` and `not_assessed`, with no
required-split, so it cannot drive the completion gate: optional items may be
left unassessed, so `not_assessed > 0` does not mean incomplete. It also
generates as `{ [key: string]: number }`, so it carries no type safety. The
full split, and the per-category breakdown, exist only behind
`/outcomes/{id}/summary/`, which needs a `CandidateOutcome`; that needs session
`LOCKED` and assessment `COMPLETED`, so it is unreachable during scoring and at
completion review. The client-side derivation in
`CandidateAssessmentScreen.tsx` therefore exists because the server does not
serve what the screen needs, not by oversight.

`candidate_assessment_summary` already takes a `CandidateAssessment` rather
than an outcome, and `CandidateOutcomeViewSet.summary` (`gradings/views.py`)
is a two-line wrapper over it, so the addition is a viewset action, contract
documentation and permission tests. No model, migration or service change.

Consequences:
Accepted and implemented on 2026-09-23. Slice 2 of the assessment redesign
gained a backend half.

Implementing it surfaced a second defect: neither `summary` action serializes a
model, so drf-spectacular had been declaring each viewset's own
`serializer_class` as the response. The outcome endpoint has documented
`CandidateOutcome` since it was added, which is why the frontend hand-wrote
`CandidateAssessmentSummary` against `docs/current-system.md`'s
generated-types rule. Both actions now declare
`CandidateAssessmentSummarySerializer`, and the frontend types are generated. `/outcomes/{id}/summary/` becomes a thin convenience over the same
service rather than the only route to the data. Changes
`docs/api_contract.md`, and requires the OpenAPI schema and frontend types to
be regenerated.

### 2026-09-23 - Assessment grading screen directions

Status: Accepted

Decision:
Rebuild mat-side scoring as 1A Single Column Run, completion review as 2B
Certificate Proof, and the Authorised Master final decision as 3C Cohort
Adjudication Board. Selected from nine proposed directions, three per screen.

Context:
The three screens shipped in a single fast pass on 2026-09-16 and had drifted
from the accepted visual direction - notably FDR-008, which prefers divider-led
lists over repeated cards, while every requirement rendered as a card. The
completion review also showed a per-category percentage, implying partial
credit that `CandidateAssessmentItem.Result` does not have.

Consequences:
Recorded as FDR-042 to FDR-047 and SCR-026 to SCR-028. Supersedes FDR-032,
FDR-033, FDR-036 and FDR-038, and retires SCR-019, SCR-020 and SCR-022.
FDR-037's instructor proposal drawer is retained, not superseded: the selected
Master surface is a cohort board and does not carry the proposal step, so the
drawer is restyled to the board's evidence presentation under FDR-047.
Both 2B and 3C are routes rather than in-page modes, so each adds a route and
`GradingSessionDetailScreen.tsx` gains new entry points.
`MasterFinalDecisionDrawer.tsx` is deleted rather than refactored;
`OutcomeProposalDrawer.tsx` survives.
Selecting 1A also settles the clearing treatment as an inline confirmation
(FDR-045), and none of the three selected directions needs a bulk item-scoring
affordance, so that decision is deferred rather than blocking.

### 2026-09-23 - Positive observations recorded in assessor_notes

Status: Accepted

Decision:
Amend `AGENTS.md` rather than add a field. `CandidateAssessmentItem.assessor_notes`
is the single per-item free-text field and records both shortfalls and positive
observations; `CandidateAssessment.notes` carries the overall observation. No
separate praise field is added.

Context:
`AGENTS.md` previously required assessment data to support "positive
observations" as a distinct concern. No such field has ever existed in
`backend/gradings`, so the rule described an intent rather than the schema. The
gap surfaced during the 2026-09-23 design pass, which deliberately did not mock
a field that does not exist. Two free-text fields already exist and are
unconstrained in what they record. A second per-item textarea would also sit on
every one of roughly 24 rows in the selected 1A mat-side layout, on a screen
used during a live grading, where it would realistically go unfilled.

Consequences:
`AGENTS.md`'s domain rule now states the actual shape: computed category
results, stored item results, one per-item note field, one per-assessment note
field. No migration, service or serializer change. Slice 4 of the assessment
redesign is unblocked. If per-technique praise is wanted later it is a new
decision with a migration, not an unmet existing requirement.

### 2026-09-23 - Clearing an item result is destructive

Status: Accepted

Decision:
`Clear` opens an inline confirmation naming the assessor and time it will
erase. Applies on every surface that can return a scored item to
`NOT_ASSESSED`.

Context:
The `candidate_item_assessor_matches_result` constraint requires `assessor` and
`assessed_at` to be null when `result` is `NOT_ASSESSED`, so clearing a scored
item erases who marked it and when, irreversibly. The superseded UI presented
`NOT_ASSESSED` as a peer of `MET` and `NOT_MET` in a segmented control and gave
no warning at all.

Consequences:
Recorded as FDR-045. `NOT_ASSESSED` is no longer a verdict target; it is
reached only through the confirmed `Clear` action.

### 2026-09-23 - Bulk item scoring

Status: Accepted

Decision:
Do not add a "mark remaining met" affordance or a `bulk-update-items` endpoint
in this redesign. Revisit if instructors ask for it once 1A is in use.

Context:
`/api/gradings/assessment-items/` supports `GET` and `PATCH` on a single item
only, so any multi-item action is N sequential requests. None of the three
directions selected on 2026-09-23 includes the affordance, so nothing in the
redesign depends on resolving it.

Consequences:
If it is revisited, the client-side option needs no backend work but must never
imply atomic success, per FDR-028. The endpoint option needs a service, view,
serializer, contract documentation and permission tests, and changes
`docs/api_contract.md`.

### 2026-09-23 - One production app service on existing Traefik and PostgreSQL

Status: Accepted

Decision:
Build the React frontend and Django API into one production image. Use a
single-service `compose.prod.yml` connected to the host's existing Traefik
and production PostgreSQL containers through separate external networks.
Serve hashed static assets through WhiteNoise and the React SPA through
Django. Apply migrations at app container start, then `exec` a single
threaded Gunicorn worker. Keep `compose.yaml` as the local PostgreSQL-only
development setup.

Context:
The owner asked for an OpenWebUI-like deployment: one configurable app
container and one Compose/env pair, with optional infrastructure add-ons
later, served to instructors at `www.kukgrade.co.uk`. A separate migration
service would complicate that one-service interface. The accepted 2026-09-15
login-throttle decision also rules out multiple Django processes until they
share a cache.

Consequences:
The image contains no production secret or PostgreSQL data. Traefik uses the
owner's `apps_net`/`websecure`/`cloudflare` convention; the external PostgreSQL
network name and database alias are set in `.env.production`. One app restart may
run an already-applied migration again; Django treats that as a no-op. Before
an image update, take a database backup because a schema migration can make
an old image incompatible. Host backup/restore operations and actual Traefik
integration still need verification before live use. See `docs/deployment.md`.

### 2026-09-23 - Fix Django admin parity gap for any-status grading session delete

Status: Accepted

Decision:
`gradings.admin.StateGatedDeleteMixin.has_delete_permission`/`_is_deletable`
now thread the logged-in admin user into the deletion validator, and
`GradingSessionAdmin` routes its actual delete (`delete_model`/
`delete_queryset`) through `gradings.services.delete_grading_session()`
rather than a bare `obj.delete()`/`queryset.delete()`.

Context:
Found while documenting the 2026-09-22 any-status session delete: Django
admin is one of this app's two first-class operational surfaces (see
`docs/audits/2026-09-15-post-completion-audit.md`'s KG-036 finding), and
this capability had no parity there at all. `has_delete_permission` called
`validate_session_can_be_deleted(obj)` with no actor, so the
`actor.role == ADMINISTRATOR` branch could never engage - Delete stayed
hidden for `LOCKED`/`COMPLETED` sessions in Django admin even for a real
administrator, though the identical action worked through the API.
Confirmed directly: `test_admin_hides_delete_for_a_session_that_cannot_be_deleted`
already asserted this false-negative using a superuser. Even with
visibility fixed, the default `delete_model`/`delete_queryset` would have
called `obj.delete()`/`queryset.delete()` directly, which does not strip
`Promotion`/`CandidateOutcome` rows first, so deleting a session with
finalised data through admin would have hit `ProtectedError` instead of
cascading.

Consequences:
`validate_candidate_can_be_deleted` gained an unused `actor` parameter
purely for calling-convention uniformity with `validate_session_can_be_deleted`
inside the shared mixin; `GradingCandidateAdmin` (candidates have no
administrator override) is otherwise unaffected. Two existing admin tests
that asserted the old (buggy) behavior using a superuser were corrected to
use a non-administrator, which is what they actually meant to test; three
new tests cover an administrator seeing Delete for every status, bulk
deleting a mixed-status selection, and `delete_model` on a `LOCKED` session
with a finalised outcome and promotion cascading correctly with the rank
reverted and `SESSION_DELETED` recorded. 617 backend tests pass.

### 2026-09-22 - Administrator-only hard delete for students and any-status grading sessions

Status: Accepted

Decision:
Two capabilities, both administrator-only, both routine (not just rare
erasure requests): `DELETE /api/students/{id}/` hard-deletes a student,
cascading through every grading-session registration, assessment, outcome
and promotion involving them (a linked `LegacyGradingRecord` is unlinked,
not deleted); and `validate_session_can_be_deleted`/`delete_grading_session`
now let an administrator delete a grading session in any status, not just
`DRAFT`/`CANCELLED`, cascading through finalised outcomes and promotions the
same way. Deleting a single completed grading (one candidate at a time) via
`DELETE /api/gradings/assessments/{id}/` already worked for any status and
needed no change.

Context:
The 2026-09-14 "Data erasure handled manually" decision assumed real
erasure requests would be rare enough to handle by hand outside the
application - `Student`'s PROTECT relationships made deletion impossible
through the app at all. Raised directly: the owner wants full, routine
admin control to delete a student or a whole completed grading, not just
occasional manual cleanup. Every relationship to `Student`
(`GradingCandidate.student`, `Promotion.student`) is `PROTECT` with no
automatic cascade; `Promotion.outcome`/`CandidateOutcome.assessment` are
also `PROTECT`, so a `Promotion` must be deleted before its
`CandidateOutcome`, which must be deleted before the cascade below it can
proceed. For session deletion, this reuses and extends the 2026-09-20
mechanism (an `actor.role == ADMINISTRATOR` runtime check already inside
`validate_session_can_be_deleted`) rather than adding a new permission -
`gradings.delete_gradingsession` is already granted to both roles for the
ordinary draft/cancelled case, so the extra power has to come from the role
check the same way the cancelled-with-recorded-work override already does.

Consequences:
`students.services.delete_student` bulk-bypass-deletes `Promotion` and
`GradingCandidate` rows (`models.QuerySet.delete`, the real unbound base
implementation, the same sanctioned bypass as `delete_candidate_assessment`
and `delete_platform_user`), plain-deletes `CandidateOutcome` rows, unlinks
each `LegacyGradingRecord` via the existing
`gradings.legacy_services.unlink_legacy_record_from_student`, and records
one `STUDENT_DELETED` audit event with cascade counts before the row goes.
No "is this still the student's most recent promotion" check applies here,
unlike a single assessment's cascade - every promotion the student has is
removed together, so none can supersede another. `delete_grading_session`
gained an admin-only block that pre-flight validates every candidate's
promotion with the existing `validate_assessment_deletion_promotion`
*before mutating anything* (all-or-nothing: a promotion a later, different
session has already superseded refuses the whole deletion, leaving
everything in place) and records `reverted_student_ranks` in the
`SESSION_DELETED` event's metadata. `students.delete_student` (Django's
auto-generated permission, previously granted to neither role) joins
`accounts.groups._DATA_CLEANUP_PERMISSIONS` alongside the existing
`delete_candidateassessment`/`delete_candidateoutcome`/`delete_promotion`.
New `AuditAction.STUDENT_DELETED`. Frontend: an admin-gated "Delete
student" action on the student detail screen, and a "Delete session" menu
item added to the `LOCKED`/`COMPLETED` dropdowns on the grading-session
detail screen, both reusing existing confirm-dialog machinery.

### 2026-09-22 - Fix deterministic CI regression in transactional test teardown (auth_group double-insert)

Status: Accepted

Decision:
`accounts/apps.py`'s `_apply_role_group` (a `post_save` receiver on `User`)
now returns early when Django passes `raw=True`, the flag reserved for
fixture/deserializer saves that place a row verbatim rather than represent a
real create/update.

Context:
CI had been failing deterministically on every push since
`c25ee29`/2026-09-21 (`accounts/migrations/0005_seed_deleted_user_placeholder.py`,
which seeds a real `User` row via every `migrate`). Root cause, confirmed by
direct instrumentation against a live PostgreSQL 17 database: `pytest-django`'s
`serialized_rollback=True` (used by the 8 `transaction=True` tests -
`gradings/test_concurrency.py`, and the "migrate from zero" tests in
`syllabus/tests.py` and `gradings/tests.py` - to restore seed data after a
transactional test's `flush()`) replays its snapshot with `obj.save()`,
which dispatches `post_save` with `raw=True` but does not suppress it.
Before this fix, `_apply_role_group` ran anyway on the replayed `User` row,
calling `Group.objects.get_or_create(...)` mid-replay. Because `accounts`
precedes `django.contrib.auth` in `INSTALLED_APPS`, the snapshot lists the
`User` row before the `Group` rows, so on the second and later transactional
test in a session (the first test's own `flush()` had already emptied the
table with no sequence reset) the receiver's `get_or_create` inserted a
`Group` row on a fresh auto-increment pk, and the snapshot's own `Group`
record - now with a pk nothing matches - fell through to an explicit-pk
`INSERT` and hit `auth_group_name_key`. Previously misdiagnosed and recorded
in `docs/current-system.md` as harmless pre-existing test-order flakiness;
it was neither pre-existing (traced to the 2026-09-21 migration) nor
order-independent flaky (100% reproducible, same 8 tests, every run).

Consequences:
`raw: bool = False` was added to `_apply_role_group`'s signature with an
early return - the idiom Django's own docs recommend for exactly this
class of receiver. A regression test (`accounts/tests.py::test_raw_save_does_not_trigger_group_assignment`)
sends `post_save` with `raw=True` directly and asserts no group membership
change. Full suite: 602 passed, 0 errors, reproduced across two consecutive
runs. No change needed to the seed migration, `accounts/groups.py`, or the
`serialized_rollback` usage on the 8 tests, which is correct and necessary.

### 2026-09-22 - Historical KSW Colchester grading-workbook migration (Phase B of the data-import spec)

Status: Accepted

Decision:
The remainder of the data-import spec - historical workbook parsing,
`LegacyGradingRecord`, rank review, identity reconciliation, void/correction,
and a unified grading-history read model - is implemented on top of the
Phase A `ImportBatch` foundation (`ImportBatch.Kind.LEGACY_GRADINGS`).
`LegacyGradingRecord` (`gradings/models.py`) is a deliberately weaker,
distinct evidence model from the native grading workflow: source text
(name, rank text, outcome text, comments, cycle info) is immutable after
import - `clean()` diffs the persisted row and rejects any change to it,
derived as "every field except the mutable set" rather than a second
hand-maintained list - and physical deletion is blocked at every layer
(`Model.delete()`, `QuerySet.delete()`, `QuerySet.update()`); void is the
only removal path and is itself one-shot (a second void is refused). The
only mutation path is five service functions
(`gradings/legacy_services.py`): `create_legacy_grading_record` (since
2026-10-20 `create_legacy_grading_records`, every record in one write; called
once per parsed row from the commit service, no audit event of its own -
one `IMPORT_BATCH_COMMITTED` event covers the whole batch, matching the
roster importer) and four explicit corrections -
`link_legacy_record_to_student`/`unlink_legacy_record_from_student`/
`resolve_legacy_current_rank`/`resolve_legacy_testing_for_rank`/
`void_legacy_record` - each auditing itself individually. A rank mapping
is reviewed once per distinct source-text value across a batch, not per
row, with an exact-match-only suggestion (never fuzzy, never
auto-applied; since 2026-10-20 also the workbook's fixed spellings, "White
Belt" and "DBN", still never a near miss); leaving it unresolved never blocks a row from being
committed, unlike the roster importer's required `Student.current_rank` -
it is correctable at any time afterwards via the reconciliation API.
Reading an imported record (`GET /api/gradings/legacy-records/`) matches
native grading visibility (both roles); the five reconciliation actions
are Administrator-only (`gradings.can_reconcile_imported_history`). A new
`GET /api/students/{id}/grading-history/` combines finalised native
outcomes with linked, non-voided legacy records into one source-labelled,
newest-first list with an honest date precision (`DAY`/`MONTH`) per item -
deliberately separate from `/rank-history/`, which is untouched and
remains `Promotion`-only.

A genuine, previously-unknown finding surfaced during implementation:
Excel forbids `/` in a worksheet title (openpyxl raises `ValueError` on
it), so despite the spec's own prose consistently writing cycle sheet
names as `"06/2025"`, the real workbook cannot literally be titled that.
The adapter's sheet-name pattern accepts `-` or `.` as the separator too,
and preserves whatever the real title turns out to be rather than
normalising it - this is a correction to the spec's own example, not a
deviation from its intent.

Context:
Continuation of the 2026-09-21 "Student roster bulk import" entry, which
deliberately deferred this half past the school's Friday 2026-09-25
grading session - nothing about it blocks that session, unlike the
roster importer. Built and merged the following day once the roster half
was live. The same five spec-vs-implementation deviations recorded in
that entry (Tablib over `django-import-export`, no background worker,
local filesystem storage, all-or-nothing commit) apply here too; the
roster importer's sixth deviation (exact-match-only rank resolution) does
not apply in the same way here, since this half's rank review is
explicitly a distinct-value, admin-confirmed workflow by design (Decision
4 of the source spec), not a simplification of it.

Consequences:
Every synthetic test fixture (the adapter's own tests, and every workbook
built for the commit/reconciliation/grading-history tests) is invented
data - the real KSW Colchester workbook has never been read by this
implementation and must never enter this repository. The spec's own
hardening/rehearsal step (section 46) - running the adapter against a
sanitised copy of the real workbook in a non-production environment,
comparing per-sheet record counts, and confirming zero native
`Promotion`/`CandidateOutcome`/current-rank changes resulted - remains
outstanding before any real production import, and the adapter's
sheet-structure assumptions (header detection, auxiliary section names)
should be expected to need adjustment once tested against the real file.

### 2026-09-21 - Student roster bulk import (Phase A of the data-import spec)

Status: Accepted

Superseded in part: deviation 1 (Tablib) and deviation 4's reserved `PARTIAL`
status, by 2026-09-30 "Import files, expiry, preview validity and
spreadsheet limits".

Decision:
A new `data_imports` app provides administrator-only bulk student-roster
import from `.xlsx`/`.csv`, ahead of the originally-recommended v1.0.0
production baseline, so real students can be in the system before a live
grading session. `ImportBatch` tracks upload -> preview -> commit/cancel
provenance (safe summary counts only, never raw row content); the source
file lives in private local `FileSystemStorage` (`STORAGES["import_uploads"]`,
never a public `MEDIA_URL`) and is deleted on commit/cancel/expiry. Every
created `Student` goes through the existing `students.services.create_student`
service unchanged, so full model validation and the normal `STUDENT_CREATED`
audit event happen identically to a hand-created student - the importer
never bulk-writes directly. An existing WKSA ID is always skipped, never
silently updated. Import authority (`data_imports.add_importbatch`,
`.view_importbatch`, `.change_importbatch`, and a custom `.can_commit_import`)
is Administrator-group-only, mirroring `_DATA_CLEANUP_PERMISSIONS`.

Five deliberate deviations from the reference spec (`KukGrade_Data_Import_
Legacy_Migration_Definitive_Implementation_Spec.md`), each with concrete
evidence/reasoning:

1. **Tablib directly, not `django-import-export`.** PyPI/changelog evidence
   at decision time: Tablib 3.10.0 explicitly supports Python 3.14 (and even
   3.15); `django-import-export` 4.4.1 (latest stable) only classified
   through 3.13, with no 3.14 support even in its unreleased 5.0 branch -
   not confirmed compatible with this project's `requires-python = ">=3.14"`
   pin. The spec's own section 6.2 pre-authorises exactly this fallback.
   `django-import-export`'s only real value-add, its ORM-write layer, is
   also the one thing the spec already forbids relying on (section 21).
2. **No background worker for batch expiry.** No queue infrastructure
   exists or is being added (correctly out of scope per the spec). A
   `manage.py expire_stale_import_batches` command run manually/via cron
   replaces it.
3. **Private temp storage is local filesystem**, not S3. The anticipated
   deployment (containerised, Hetzner VPS or similar, persistent storage)
   is exactly what `FileSystemStorage` needs, provided `IMPORT_UPLOAD_ROOT`
   is mounted as a persistent volume - the same requirement the database's
   data directory already has.
4. **Commit is all-or-nothing in one transaction**, not the spec's
   `PARTIAL`-status partial-commit bookkeeping (`ImportBatch.Status.PARTIAL`
   is kept in the enum for forward compatibility but never produced).
   Simpler to reason about correctly for a school-roster-sized import, and
   commit already re-validates everything preview checked immediately
   beforehand.
5. **Rank resolution is exact-match only** (`Rank.code`/`Rank.name`,
   case-insensitive), not the historical importer's messier suggestion-and-
   approval workflow - reserved for the historical-workbook import, where
   source rank text is actually unreliable.

Context:
Raised directly: "So for a v1 how far or close are we to that reality
today" led into a large legacy-import/migration spec being handed over for
review, with the explicit instruction to implement the student-roster piece
now (ignoring the spec's own "after v1.0.0" framing) because the school has
a real grading session on 2026-09-25 and getting the real roster into
KukGrade beforehand makes the app actually useful for it. The historical
KSW Colchester grading-workbook migration (`LegacyGradingRecord`, rank
review, reconciliation, unified grading history) from the same spec is
deliberately deferred to a later, unhurried pass - it concerns past
records, not anything Friday's live session depends on.

Consequences:
A second, larger implementation phase (the historical workbook importer)
remains to be built against the same `ImportBatch`/`data_imports`
foundation; `ImportBatch.Kind.LEGACY_GRADINGS` and the `.xlsx`-only
extension rule for it already exist in the model for that phase to use.
`ImportBatch.Status.PARTIAL` is unused until/unless a real need for partial
commits appears.

### 2026-09-21 - Administrator hard-delete for users and completed assessments, via placeholder reassignment

Status: Accepted

Decision:
`UserViewSet` and `CandidateAssessmentViewSet` each gain a real `destroy()`,
gated to Administrator-only permissions (`accounts.delete_user`; a new
`_DATA_CLEANUP_PERMISSIONS` tuple for `delete_candidateassessment`/
`delete_candidateoutcome`/`delete_promotion`). Deleting a user reassigns
every PROTECT attribution foreign key that referenced them (grading
sessions created, candidates withdrawn, assessments generated, outcomes
proposed/decided, items assessed, promotions recorded, audit events) to a
seeded "Deleted User" placeholder account (`accounts/migrations/0005_seed_
deleted_user_placeholder.py`) rather than nulling or cascading it away.
Deleting a completed assessment cascades through its outcome and promotion
if either exists, reverting the student's rank, and refuses when a later
promotion has already superseded it. Both self-deletion and deleting the
placeholder itself are refused.

Context:
Raised directly, alongside three related asks (a grantable audit-log
permission, scoped audit visibility, and the syllabus redesign - see the
plan file and the following two decisions/FDR-041): "i would like to be
able to delete users as an admin," framed explicitly as recovery from
corruption or bad test data, not routine offboarding (`is_active` already
covers that). Every attribution foreign key in this codebase is `PROTECT`
specifically so deleting a user could never erase who did something (see
the existing comments on `audit.AuditEvent.actor` and
`gradings.CandidateAssessmentItem.assessor`); a true hard-delete needed to
keep that promise rather than override it. Reassignment to a placeholder,
not nulling, was chosen after the first round of answers ("yes, hard
delete") conflicted with that PROTECT-everywhere philosophy - nulling would
have erased attribution exactly as the PROTECT choice was written to
prevent.

Consequences:
Three rows - `Promotion`, a finalised `CandidateOutcome`, and `AuditEvent` -
refuse ordinary `QuerySet.update()`/`delete()` as well as `save()`/
`delete()`, by design, to keep them append-only/immutable against ordinary
code paths. `delete_platform_user` and `delete_candidate_assessment` call
`models.QuerySet.update`/`delete` directly - the real, unbound base
implementations - bypassing those instance-level overrides on purpose at
one documented call site each. This is the one sanctioned way those guards
are bypassed in the codebase; any future caller doing the same outside
these two functions should be treated as a bug, not a precedent. The
placeholder account is excluded from `UserViewSet`'s queryset entirely, so
it can never itself be listed, edited or deleted through the API.

### 2026-09-21 - Fourth sensitive permission: grantable grading-audit-log visibility

Status: Accepted

Decision:
Add `gradings.can_view_grading_audit_log` as a fourth per-user sensitive
permission, identical in mechanism to the existing three
(`can_make_final_grading_decision`, `can_promote_student`,
`can_override_locked_session`): granted via
`PATCH /api/users/{id}/authority/`, in no group. `CanViewAuditLog` gains a
third OR-branch for it. No new filtering logic: the existing
`accounts.view_user` exclusion in `AuditEventViewSet.get_queryset()` already
scopes a holder to grading/syllabus events and away from user-management
ones (`USER_CREATED`, `USER_UPDATED`, `USER_AUTHORITY_CHANGED`,
`USER_DELETED`), since a holder of only this permission won't have
`accounts.view_user` either.

Context:
Raised directly, alongside the admin-deletion asks above: "the audit view
should be an admin only thing for all events, but for events regarding the
school specifically about gradings etc that should be grantable to the
instructors." Confirmed via the "does that make sense" follow-up that this
should reuse the exact boundary already drawn for Masters (everything
except `USER_MANAGEMENT_ACTIONS`), not a narrower cut - retrospective
accountability for grading/syllabus/assessment decisions during post-grading
review, not user-lifecycle visibility.

Consequences:
A fourth boolean travels everywhere the other three already do:
`UserSerializer`, `UserManagementSerializer`, `UserAuthoritySerializer`, the
`AuthorityForm` options list and `ProfileMenu` capability badges on the
frontend. `RequireAuditAccess` and the nav-rail Audit item check it
alongside `can_make_final_grading_decision`. Named for the eventual
"grading groups" workflow this was raised in service of (instructor
sub-groups rotating through syllabus categories of a cohort, reviewing each
other's audit trail) - that workflow itself remains unbuilt; only the
visibility primitive it will depend on exists now.

### 2026-09-20 - Administrators can delete a cancelled session with recorded assessment work

Status: Accepted

Decision:
`validate_session_can_be_deleted` still refuses to delete a cancelled
session that holds recorded assessment work (any candidate past
`NOT_STARTED`) for an instructor, but an administrator can now delete it
deliberately. The DRAFT/CANCELLED status requirement is unchanged for
everyone - no other status becomes deletable.

Context:
Raised directly: "as an admin i should be able to have delete gradings
authority even on sessions that are cancelled." The existing guard blocked
this for every role, added so a cancelled session's assessment work
couldn't be cascaded away with no audit trail to reconstruct it from.
Clarified that the intended change is role-based and automatic for the
Administrator role, not a new per-user grant in `SENSITIVE_PERMISSIONS` -
this is a broader authority than the existing three sensitive permissions,
in keeping with administrators already holding every grading capability
instructors do, plus user administration.

Consequences:
`validate_session_can_be_deleted`, `GradingSession.delete()`, and
`delete_grading_session()` take an optional `actor`; when the actor's role
is Administrator, the assessment-work guard is skipped and the
`SESSION_DELETED` audit event (which already records status and cascaded
candidate IDs) is the trail. `GradingSessionQuerySet.delete()` (bulk/ORM
delete with no request context) keeps the guard unconditionally - the
override only applies where an acting user is known. The frontend delete
menu item on a cancelled session now also shows for an administrator even
when assessment work exists.

### 2026-09-16 - No self-service account creation: Google SSO rejected, no registration page

Status: Accepted

Decision:
KukGrade will not offer Google SSO, nor any other form of self-service
account registration. Every account is created by an administrator through
the existing Users API (`POST /api/users/`) or Django admin - there is no
path for a person to create their own account, with or without a
third-party identity provider.

Context:
Raised while planning self-service account settings: "can we have a Google
SSO as part of the app as well." Research confirmed the two answers that
would have shaped it combine into a serious hole: staff use personal Gmail
addresses (no controlled Workspace domain), and the desired behaviour was
auto-create-on-first-sign-in. Together, anyone holding any Gmail account
could self-provision real access to student and grading records with no
administrator involved. KukGrade holds data on minors; that is unacceptable
regardless of how convenient it would be for staff onboarding. The same
reasoning rules out an open self-registration page, asked about separately
on 2026-09-17: it is the identical failure shape (an outsider grants
themselves access) behind a different login screen.

Consequences:
No SSO provider integration, no registration route, no "sign up" link
anywhere in the frontend. An administrator remains the only path to a new
account. Do not silently reconsider either without re-surfacing this exact
reasoning - if a future request revisits Google SSO or self-registration,
re-read this entry first and re-confirm the Workspace-domain and
auto-create-on-sign-in answers have actually changed, not just that asking
again feels convenient.

### 2026-09-16 - Audit log is administrator-or-Master, not every instructor

Status: Accepted

Superseded in part: the Administrator group carries `audit.view_auditevent`
again and the check follows that permission, not the role (2026-09-26); a
per-user grant also reads the log (2026-09-21 "Fourth sensitive permission").

Decision:
The audit log (`/api/audit-events/` and Django admin's `AuditEventAdmin`) is
readable only by administrators and holders of Master (final-decision)
authority. A plain instructor holding neither is refused entirely, not just
filtered - a stricter cut than the 2026-09-15 user-management-only exclusion,
which still applies on top of this for the same reason (a Master who is not
an administrator still cannot see `USER_*` events).

Context:
Raised directly while reviewing the new bulk-operations endpoints: "the only
people that can see the audit log ... should be master and admin." No group
carries `audit.view_auditevent` any more; access is decided by
`accounts.permissions.CanViewAuditLog` (administrator role, or
`gradings.can_make_final_grading_decision`), mirrored in
`AuditEventAdmin.has_view_permission`/`has_module_permission` so Django
admin enforces the same rule as the API.

Consequences:
`accounts/groups.py` no longer grants `audit.view_auditevent` to either role
group. `audit/views.py` gates `list`/`retrieve` with
`[HasRequiredPermissions, CanViewAuditLog]` rather than a Django permission
in `permission_map`.

### 2026-09-16 - Master authority is administrator-exclusive

Status: Accepted

Superseded in part: "exactly one designated Master" in the context below -
any number of instructors may hold it (2026-09-25 "Multiple Masters are
permitted"). The rule itself stands: an administrator never holds
final-decision authority (the title means exclusive of administrators).

Decision:
`gradings.can_make_final_grading_decision` can never be held by a user whose
role is Administrator. Granting it to an administrator
(`PATCH /api/users/{id}/authority/`) is refused, and promoting a user who
already holds it to administrator (`PATCH /api/users/{id}/`, `role`) is
refused too. Administrators keep the other two sensitive permissions
(`can_promote_student`, `can_override_locked_session`) and every other
capability unchanged - only final-decision authority is carved out.

Context:
Raised directly: "I want to run by admins not having the final locked
decision permission and only the master having that but admins having
everything else." The stated reasoning is operational - exactly one
designated Master should make final decisions, while administrators remain a
deliberate safety valve ("if for any reason something doesn't work it can be
dealt with as per SOP") for everything short of that one decision.

Consequences:
Enforced in `accounts/services.py`: `validate_authority_change` refuses the
grant, and `update_platform_user` refuses the role change, both with a
plain `ValidationError` surfaced through the normal error envelope. Note
that a Django superuser bypasses every permission check regardless of what
is explicitly granted, so this guarantee holds for ordinary administrator
accounts but not for whoever holds `is_superuser` (normally only the
bootstrap account, since `is_staff`/`is_superuser` are not API-writable).

### 2026-09-16 - Rank-hierarchy decision overrides will not be built

Status: Rejected

Decision:
No instructor-rank hierarchy (JKN < KSN < PSBN < SBN < PKJN, mirroring the
student belt ladder) will govern who can override a provisional outcome
proposal before an outcome is finalised. `propose_candidate_outcome` keeps
its current shape: any caller with `gradings.change_candidateoutcome` can
revise a DRAFT/PROPOSED outcome, and the audit log already records what a
revision overwrote (2026-09-15's `test_revising_a_proposal_records_what_it_said_before`
case). Only the existing Master-authority finalisation gate governs the
final decision.

Context:
Proposed as: a JKN's provisional decision could not be changed except by a
PSBN-or-higher instructor or the Master, mirroring Kuk Sool grade seniority.
Explored at length and walked back for two concrete reasons once discussed:
first, the school's own instructor grades do not track cleanly onto the
existing student `Rank` catalogue - a JKN-ranked instructor holds more
authority than a JKN-ranked student, so the ladder would need a wholly
separate staff-seniority concept, not a reuse of `Rank`. Second, the two
people expected to use the override most (both KSN) explicitly did not want
same-rank mutual override to be true going forward, which undermined the
premise before a design was even settled. Decided not to add the complexity
now; revisit only if a concrete, reconciled ranking scheme is proposed later.

Consequences:
None - no code changed. Recorded so the idea is not silently re-explored
without this context, and so `CandidateOutcome` is not mistaken for missing
an intended feature.

### 2026-09-15 - User-management audit events are administrator-only

Status: Accepted

Superseded in part: other events are no longer readable by every signed-in
user (2026-09-16 "Audit log is administrator-or-Master"), and there is no
single-event route to answer 404 (2026-09-28 "The API serves what the
application uses").

Decision:
`USER_CREATED`, `USER_UPDATED` and `USER_AUTHORITY_CHANGED` audit events are
readable only by callers holding `accounts.view_user` (administrators). Every
other action stays readable by any signed-in user, unchanged.

Context:
Found during the post-completion audit (KG-048): `/api/users/` is
administrator-only, but the audit log was readable by any signed-in user,
so an instructor could read who was created, edited, or granted Master
authority through the log even though the Users API itself was closed to
them. Asked directly: logistics - actual running of the app, not Kuk Sool -
is an administrator and Master concern; instructors do not need it and it
should come out of their permissions. This is the same boundary the
capability map already drew on 2026-09-13, applied to a channel that had
been missed.

Consequences:
`AuditEventViewSet.get_queryset()` excludes the three user-management
actions unless the caller holds `accounts.view_user`. A direct retrieve of
an excluded event's id answers 404. `audit.models.USER_MANAGEMENT_ACTIONS`
names the affected actions in one place, so a new user-management action
added later is filtered by construction if it is added to that tuple.

### 2026-09-15 - Login throttle stays process-local; Redis if that changes

Status: Accepted

Decision:
No shared cache is being added for the login throttle now. Confirmed the
deployment is single-process for the foreseeable future, so `LocMemCache`
already gives the intended 10/min bound with no gap. If that ever changes -
multiple gunicorn workers, multiple container replicas - the throttle
should move to Redis, not the database cache, at that point.

Context:
Found during the post-completion audit (KG-039): `ScopedRateThrottle`
stores its counters in Django's cache framework, which defaults to a
per-process in-memory dict with no `CACHES` setting configured. Under
multiple processes each would count independently, loosening the bound to
roughly `10/min x process count` and resetting on every restart. Asked
directly: the deployment is single-process today, which makes this a
non-issue rather than a bug to fix now - and nothing in this repository
currently even defines a multi-process deployment (`compose.yaml` has no
`web` service, no Dockerfile, no process manager). Redis was the stated
preference for if that ever changes, over the zero-new-infrastructure
alternative (a Postgres-backed database cache), so that preference is
recorded here rather than left to be re-litigated later.

Consequences:
No code change. Revisit if the deployment ever becomes multi-process:
add a `CACHES` entry pointing at Redis and confirm the throttle picks it up
before shipping that topology, rather than discovering the gap in
production.

### 2026-09-14 - Remove the inert final-decision boolean from User

Status: Accepted

Decision:
`User.can_make_final_grading_decision` is removed. Nothing ever consulted
it; authority was always the Django permission of the same name. Migration
`accounts.0003_remove_inert_final_decision_boolean` drops the column with
no data migration, since it carried no authority to preserve.

Context:
The 2026-06-25 "Final decision authority source" entry treated the field as
legacy and deferred a decision on removing it (tracked as audit finding
M-01), because ticking it in admin - under a "KukGrade access" fieldset -
looked like it granted final-decision authority when it granted nothing.
Privilege confusion rather than privilege escalation, but the confusion was
the danger, so the column is removed rather than left to be rediscovered.

Consequences:
Supersedes the 2026-06-25 entry's deferred remediation. Anyone who should
hold final-decision authority is granted the permission directly; there is
no field left to tick by mistake.

### 2026-09-14 - Frontend stack and generated API types

Status: Accepted

Decision:
React Router for navigation and TanStack Query for server state. API response
types are generated from a `drf-spectacular` OpenAPI schema rather than
hand-maintained, so the frontend's description of server data cannot silently
drift from the serializers.

Context:
Phase 3 is the critical path at 4-6 weeks and could not start without this. The
2026-09-13 error-envelope decision deferred `drf-spectacular`, leaving types
hand-written; that deferral is now reversed. The existing error envelope stays
as built - it already matches the shape the industry converged on, and
`drf-standardized-errors` would only have earned its place by generating the
schema, which `drf-spectacular` now does directly.

No hand-written API types anywhere. This includes the existing ones in
`frontend/src/api.ts` - `AuthUser`, `HealthResponse` and the error-envelope
types are replaced by generated equivalents rather than left as exceptions.

Consequences:
Three dependencies, each justified. Type generation costs roughly half a day to
wire and removes a class of failure that otherwise surfaces mid-grading rather
than at build time. The generated schema must be regenerated whenever a
serializer changes; CI should check it is current, so a serializer change that
nobody mirrors fails the build rather than a screen.

### 2026-09-14 - Syllabus versioning deferred, not cancelled

Status: Accepted

Decision:
Do not build `SyllabusVersion`, the spreadsheet import, or a syllabus upload
screen now. Syllabus content is maintained directly by the project owner when
an update is needed. Revisit when a second real edition exists.

Context:
The 2026-09-13 syllabus versioning decision assumed instructors would author
versions in the app. The owner will handle updates personally instead. The
capability map already gives instructors view-only syllabus access and no
Django admin, so the syllabus is effectively immutable to everyone using the
application, which was the property "set in stone" was protecting. Assessment
snapshots independently protect historical gradings from any later change.

Consequences:
Saves the 3-4 day Phase 2b slice. KG-014 returns to its original P3 rating:
the outstanding gap is provenance - "which edition was this graded against" is
unanswerable - not correctness. Replacing syllabus rows in place will leave
existing snapshots intact but unlinked to their source, which is the cost of
deferring.

### 2026-09-14 - Data erasure handled manually

Status: Accepted

Decision:
Build no anonymisation or erasure mechanism. Erasure requests are handled
manually if one arises. `KG-NEXT-019` is dropped from the backlog.

Context:
The recommendation was anonymise-in-place: strip name and date of birth, keep
the grading record so a rank retains its provenance. The owner accepts handling
this by hand instead.

Consequences:
PROTECT foreign keys mean a student with grading history cannot be deleted
through the application at all, so a manual request needs direct database work.
Recorded here so the position is deliberate rather than an oversight. Revisit if
the club grows or a request actually arrives.

### 2026-09-14 - Student status semantics

Status: Accepted

Decision:
`Student` gains `ACTIVE`, `INACTIVE`, and `LEFT`, replacing the binary
`is_active` flag. `INACTIVE` means a temporary break - injury, exams, travel -
and blocks nothing. `LEFT` blocks registration as a grading candidate. Both are
reversible, and grading history is retained in every case.

Context:
AGENTS.md lists the three values as a confirmed requirement (audit KG-025) but
never defined their behaviour. It also states that missing a grading must never
automatically mean a student left, so status is only ever changed deliberately
by a person.

Consequences:
Migration maps `is_active=True` to `ACTIVE` and `False` to `INACTIVE`, the
conservative reading: an existing inactive student is on a break, not gone.
Candidate registration gains a status check.

### 2026-09-13 - Syllabus versioning and immutability

Status: Superseded by 2026-09-14 - Syllabus versioning deferred, not cancelled

Decision:
The syllabus is versioned and set in stone. Introduce `SyllabusVersion` with a
`DRAFT -> PUBLISHED -> SUPERSEDED` lifecycle:

- A version is authored by uploading a structured spreadsheet (CSV/Excel), one
  row per requirement: rank, age band, item code, item name, Korean name,
  category, sequence, start/end number, required flag, notes. The import is
  validated as a whole and rejected entirely if malformed.
- While `DRAFT` a version is editable, so typos can be fixed before release.
- Publishing freezes the version permanently. Published items and requirements
  can never be edited or deleted.
- Publishing a new version supersedes the current one. Superseded versions stay
  readable forever so historical gradings remain reconstructable; nothing is
  ever deleted. "Removing" a syllabus means retiring it from use.
- `SyllabusRequirement`'s unique constraint becomes
  `unique(version, rank, age_band, item)` so versions can coexist.
- Assessment generation resolves the current published version and records it on
  the assessment, alongside the existing per-item display snapshots.

This resolves open question Q6 and re-scopes audit finding KG-014.

Context:
The current model has no version concept: 32 items and 373 requirements are
mutable rows with `active` flags, seeded by a data migration. The 2026-09-13
audit rated KG-014 as P3 on the grounds that per-item snapshots already protect
historical meaning, so an explicit version was provenance rather than
correctness. That reasoning holds for reading history but misses how the
syllabus is authored: immutability is the core maintenance rule, not a reporting
feature. KG-014 is re-rated P2 accordingly.

Consequences:
The unique-constraint change is a migration against seeded production-shaped
data; existing items and requirements are migrated into a `WKSA 2014` published
version. Per-item display snapshots are retained as well as the version link -
belt and braces, and the snapshots already have test coverage. The instructor
syllabus capability from the capability-map decision cannot be granted until
this lands, so syllabus versioning is sequenced immediately after the
permissions, integrity and audit work and before frontend integration.
Estimated 3-4 days. A syllabus upload screen is deferred; the first import path
may be a management command.

### 2026-09-13 - Capability map and role definitions

Status: Accepted

Superseded in part: instructors authoring and publishing syllabus versions
was deferred by 2026-09-14 "Syllabus versioning deferred, not cancelled".

Decision:
Instructors own everything related to Kuk Sool; logistics beyond that is left to
administrators and the Master in charge.

Groups and their Django permissions:

- Instructor: full add/change/view on students, grading sessions, and grading
  candidates; full assessment and outcome-proposal workflow; authoring and
  publishing of new syllabus versions. No user or role management.
- Administrator: everything an instructor has, plus user and role management.
- Master: not a group. The three sensitive permissions
  (`can_make_final_grading_decision`, `can_promote_student`, and
  `can_override_locked_session`) are grantable to any user independently of
  their group, so authority survives a specific person being unavailable.

`User.Role` drops `manager`, leaving `instructor` and `administrator`.

Context:
The 2026-09-13 authority-primitive decision settled the mechanism but not the
policy, which blocked KG-NEXT-008. The confirmed policy is that an instructor
can run a grading end to end - schedule it, register candidates, maintain
student records, edit the syllabus, assess, and propose an outcome - but cannot
make the final decision, promote a student, or withdraw a candidate from a
locked session. No code or documentation uses the `manager` role.

Consequences:
A new `can_withdraw_locked_candidate` permission is added for KG-008 rather than
reusing final-decision authority. Instructors are not granted `is_staff`, so
Django admin stays closed to them.

Amended later the same day: this entry originally granted instructors `is_staff`
so that syllabus editing worked through Django admin. That was wrong. The
syllabus is immutable once published, and Django admin's whole affordance is
editing rows in place. The instructor syllabus capability is delivered by the
syllabus versioning decision below instead, and cannot be granted until that
work lands.

### 2026-09-13 - Outcome revision is logged, not gated

Status: Accepted

Decision:
Instructors may freely revise a proposed outcome until the Master finalises it.
No reason field is required, no approval step is added, and no proposal-history
model is introduced. Instead, every proposal, revision, final decision,
promotion, and syllabus change is recorded as an append-only audit event.
Disagreements are discussed in person, not captured as structured data.

Context:
The audit found (KG-029) that `propose_candidate_outcome` overwrites the
previous proposal in place, so if one instructor changes another's proposed
outcome the change is invisible - including to the Master who must adjudicate
it. Requiring a reason, keeping an append-only proposal model, and a two-stage
sign-off were all considered and rejected as more process than the setting
warrants. "Locked by the Master" is already enforced: finalised outcomes cannot
be re-proposed.

Consequences:
No domain logic changes. The audit log becomes load-bearing rather than
supporting scenery, so a minimal `AuditEvent` model moves from Phase 4 into
Phase 2 alongside the permissions work, estimated 1-2 days. Landed:
`OUTCOME_PROPOSED` and `OUTCOME_FINALISED` events record a revision's
previous proposal (`gradings/services.py`, `audit/tests.py`
`test_revising_a_proposal_records_what_it_said_before`); the specific
`services.py:235`/`services.py:447` stub line numbers this entry originally
pointed at no longer correspond to anything after the file's later growth
and reorganisation.

### 2026-09-13 - Authority primitive is Django permissions

Status: Accepted

Decision:
Django permissions are the single authority primitive for KukGrade. `User.role`
becomes a convenience label that assigns a Group, not an enforcement mechanism.
Delete the unused `IsInstructorOrAbove`, `IsManagerOrAdministrator`,
`IsAdministrator`, and `IsAuthenticatedUser` role classes; keep small custom
permission classes only for the six custom actions (`generate-assessment`,
`create-outcome`, `propose`, `finalise`, `summary`, `promote`). Remove the
inert `User.can_make_final_grading_decision` boolean. "Authorised Master" is a
permission, consistently with everything else.

Context:
The 2026-09-13 independent audit found three competing authority mechanisms in
one codebase: role classes wired to zero views (KG-001), Django permissions
that are the only thing actually enforcing anything, and an inert boolean
(KG-003). These are not three problems but one: the authority primitive had
never been chosen. This completes the 2026-06-25 final-decision-authority
decision rather than superseding it.

Consequences:
Closes KG-001, KG-003, and open question Q2 in one change. Authority becomes
adjustable through admin Groups without a deploy. Every endpoint needs an
explicit permission class and a role-by-operation matrix test, which is the
highest-value test addition currently missing. Estimated 1.5-2 days.

### 2026-09-13 - Locked grading session exit paths

Status: Accepted

Decision:
Add two exits from `LOCKED`. First, authorised post-lock candidate withdrawal:
gated by final-decision authority, requiring a recorded reason plus
`withdrawn_by` and `withdrawn_at`, blocked once the candidate's outcome is
`FINALISED`. Second, `LOCKED -> CANCELLED` for a genuinely abandoned grading.
The assessment snapshot is retained unchanged on withdrawal; partial results
stay as they were recorded.

Context:
The audit found (KG-008) that a locked session had no safe exit for a candidate
who could not finish. Withdrawal and deletion both require a draft or open
session, `LOCKED` transitions only to `COMPLETED`, and completion requires every
non-withdrawn candidate to hold a finalised outcome. The only in-app escape was
to mark unassessed items `NOT_MET` and finalise a false `FAIL`, writing
fabricated results into a record the system then correctly refuses to change.
`LOCKED -> CANCELLED` alone was rejected as the primary remedy because
`PROMOTION_SESSION_STATUSES` requires a locked or completed session, so
cancelling would strip promotion from every other candidate in the session.
Exam-board practice (absent and incomplete coded separately from any grade) and
clinical data capture (never impute a value for "not done"; always record a
reason) both support recording the true event rather than reusing a
nearby-looking one.

Amended on implementation: the permission is `can_override_locked_session`,
not `can_withdraw_locked_candidate`. This decision has two exceptional
post-lock actions - withdrawing a candidate and cancelling the session - and
gating only the first would have left any instructor able to destroy a locked
grading. They are the same kind of intervention, so they share one permission
rather than proliferating two.

Consequences:
`validate_candidate_can_be_changed` and `validate_candidate_assessment_changes`
each need a narrow carve-out reachable only through the authorised service path.
Withdrawn candidates are already excluded from lock and completion checks, so no
new exclusion logic is required. A separate `DID_NOT_FINISH` outcome was
considered and deferred; revisit only if grading paperwork distinguishes "did
not finish" from "withdrew". Estimated half a day plus one hour.

### 2026-09-13 - API error envelope and list pagination

Status: Accepted

Decision:
Extend the existing `custom_exception_handler` envelope with a `fields` member
so validation errors reach clients as structured per-field messages alongside
the existing `code` and `message`. Return 405 rather than 400 for unsupported
outcome mutation. Apply DRF `PageNumberPagination` uniformly to every list
endpoint with no exemptions, including small reference collections.

Context:
The audit found (KG-015) that the frontend discards all field-level validation
errors because it reads only `error.message` or `detail`, while DRF sends
`{"field": ["msg"]}`; every 400 degrades to a generic message, blocking every
form in the application. Three error envelopes currently coexist (KG-017), and
no list endpoint is paginated (KG-004). Stripe, GitHub, Google, and RFC 9457 all
converged on machine code plus human message plus a separate structured
field-error member; the existing handler already has the first two.
`drf-standardized-errors` was considered and deferred because its main advantage
is OpenAPI schema generation, which only pays for itself alongside
`drf-spectacular`.

Consequences:
Both are response-shape changes and must land before frontend screens are built,
or the screens get rebuilt. Pagination is uniform so the client needs exactly one
unwrap helper and no special cases. Moving to cursor pagination later would only
remove `count`, a far smaller break than adding an envelope after the fact.
TypeScript types remain hand-maintained for now; the type-synchronisation half of
open question Q4 is still unresolved.

### 2026-06-25 - Documentation truth and audit remediation tracker

Status: Superseded by 2026-09-24 - One document per job; every API shape declared in the schema

Decision:
Create `docs/current-system.md` as the current implementation source of truth,
create `docs/audits/remediation-status.md` as the audit remediation tracker,
and mark older broad planning documents as legacy or mixed target/current
inputs. Treat `docs/api_contract.md`, `docs/data_model.md`, and
`docs/grading_app_planning.md` as planning context unless reconciled with the
current-system document and accepted decisions.

Context:
The repository audit found that current-state documentation, target planning,
and legacy planning language were mixed together. This caused stale claims such
as the project being only in planning, grading foundations being deferred, and
some unimplemented target endpoints looking current.

Consequences:
Future implementation must check `docs/current-system.md` and the remediation
tracker before acting on older planning files. Audit remediation should proceed
by stage, with documentation, tests, and review evidence recorded in the
tracker.

### 2026-06-25 - Final decision authority source

Status: Superseded by 2026-09-14 - Remove the inert final-decision boolean from User

Decision:
Treat the Django permission `gradings.can_make_final_grading_decision` as the
current runtime authority for final grading decisions. The older
`User.can_make_final_grading_decision` boolean is a legacy field and must not
be presented as granting final-decision authority. Removing or replacing that
boolean is tracked as audit finding M-01.

Context:
The 2026-06-21 identity decision described a separate boolean capability, but
the later candidate outcome implementation uses a Django permission and tests
prove the boolean alone does not grant finalisation authority.

Consequences:
Documentation and UI must not imply that ticking the legacy boolean grants
final-decision authority. A future remediation stage should migrate/remove the
field or deliberately redefine it with tests and documentation.

### 2026-06-23 - Promotion and rank-history foundation

Status: Accepted

Decision:
Create `Promotion` as the immutable rank-history record for successful grading
progression. Promotion is explicit, PASS-only, and separate from final outcome
recording. A candidate can be promoted only from a `FINALISED` `PASS` outcome
when the candidate and assessment are `COMPLETED`, the candidate is not
withdrawn, the session is `LOCKED` or `COMPLETED`, the candidate
testing-for rank is still the next active rank after the student's current
rank, and no promotion already exists for the outcome or grading candidate.
Promotion requires the separate `gradings.can_promote_student` Django
permission. `gradings.can_make_final_grading_decision` does not imply promotion
authority.

Context:
Final Master decisions and assessment snapshots already preserve grading
evidence, but they deliberately did not change student rank. Rank progression
needs an auditable administrative action that can happen after finalisation,
without forcing all candidates to be promoted before session completion and
without promoting `FAIL` or `CONDITIONAL` outcomes.

Consequences:
The canonical `promote_candidate()` service runs in one transaction: it locks
the outcome, candidate, assessment, and student rows, creates `Promotion`, and
updates only `Student.current_rank`. Both the history record and rank update
succeed or neither is persisted. `Promotion` stores protected references to the
student, outcome, grading candidate, from-rank, to-rank, and promoter, plus
server-controlled `promoted_at`, grading-date `effective_date`, and optional
notes. Records are immutable after creation and cannot be deleted through
normal model, API, or admin paths. The API derives actor and effective date
server-side and rejects client-supplied actor/date fields. Once a student has
promotion history, ordinary student saves cannot directly change
`current_rank`; initial rank assignment and pre-history corrections remain
possible. Rank history begins with KukGrade-managed promotions and may not
include rank changes that predate application adoption. Reversing migration
`gradings.0004_promotion` is a schema rollback only; it deletes promotion rows
and the custom permission but does not implement business promotion reversal or
automatic student-rank rollback. Backdating, postdating, demotion, reversal,
promotion correction, conditional follow-up, certificate generation,
notifications, payment handling, frontend screens, and broader audit-event
infrastructure remain deferred.

Note added 2026-09-15 while recovering this entry from an unmerged worktree:
immutability was later strengthened beyond what this entry describes -
`QuerySet.update()` and `QuerySet.delete()` on `Promotion` now refuse as well,
so the rule holds from the shell too (KG-044). Row locking was also narrowed to
`of=("self",)` so a promotion no longer incidentally locks the joined session,
student and rank rows (NEXT-014).

### 2026-06-23 - Candidate outcome and Master decision foundation

Status: Accepted

Decision:
Create `CandidateOutcome` as the one-to-one outcome record for a completed
`GradingCandidate` and its completed `CandidateAssessment`. Outcomes start as
`DRAFT`, may be revised as `PROPOSED`, and become immutable once `FINALISED`.
Outcome values are `PASS`, `FAIL`, and `CONDITIONAL`; older defer/reassess
wording is not used for implemented outcomes. Outcome creation is an explicit
candidate action after assessment completion, not an automatic side effect of
assessment completion. Final decisions can be made only while the parent session
is `LOCKED` and only by a user with the
`gradings.can_make_final_grading_decision` Django permission.

Context:
Assessment item counts are useful evidence, but the domain requires the final
grading decision to remain an explicit human decision by an authorised
Master-level user. The accepted account model already includes a narrow final
grading decision capability; this slice implements that boundary as a Django
permission instead of adding a broader production role architecture or
hard-coded rank/title checks.

Consequences:
`CandidateOutcome.assessment` uses `PROTECT` so historical final decisions keep
their assessment evidence. `proposed_by` and `decided_by` also use `PROTECT`,
matching the existing policy for key grading attribution such as session
creator and assessment generator; display-name snapshots are therefore not
duplicated in this slice. `CONDITIONAL` final decisions require meaningful
conditional requirements, while `PASS` and `FAIL` reject stale conditional text.
On-demand category summaries use copied `CandidateAssessmentItem.category`
snapshot values, include optional items in overall counts, distinguish required
from optional evidence, and do not infer a pass/fail/conditional result.
Session completion now requires every non-withdrawn candidate to have both a
completed assessment and finalised outcome. Finalised outcomes block ordinary
edits, deletes, candidate withdrawal, candidate deletion, and assessment
deletion; `QuerySet.update()` remains an unsupported low-level maintenance
escape hatch. This slice deliberately does not update `Student.current_rank`,
create promotion history, create certificates, send notifications, add frontend
screens, or implement correction/reopening after finalisation.

### 2026-06-23 - Candidate assessment snapshot foundation

Status: Accepted

Superseded in part: a session now locks only when every assessment is
completed, and no result is recorded after lock (2026-09-26 "A session locks
only when grading is complete").

Decision:
Create `CandidateAssessment` as a one-to-one assessment package for a
`GradingCandidate`, and `CandidateAssessmentItem` as immutable
per-requirement snapshot rows with `NOT_ASSESSED`, `MET`, and `NOT_MET`
results. Assessment generation is service-only and transactional. It copies the
candidate's active applicable syllabus requirements at generation time,
including age band, item code, item name, Korean name, category, sequence,
required flag, numbered range, and requirement notes. Source requirement, item,
and rank relationships are nullable trace links only; historical display must
use the copied fields.

Context:
Historical grading records must remain reproducible if syllabus item names,
requirement ranges, notes, active flags, rank mappings, or catalogue versions
change later. This slice intentionally captures assessment evidence without
implementing final grading outcomes.

Consequences:
Assessments can be generated only while sessions are `DRAFT` or `OPEN`.
Assessment start is an explicit `NOT_STARTED -> IN_PROGRESS` transition allowed
only while the session is `OPEN`. Result entry is allowed only for
`IN_PROGRESS` assessments while sessions are `OPEN` or `LOCKED`; locked
sessions can finish work already in progress but cannot start new assessments.
Lifecycle is `NOT_STARTED -> IN_PROGRESS -> COMPLETED`; direct completion from
not started is rejected. Completion requires every required item to be assessed,
while optional items may remain `NOT_ASSESSED`. Completing an assessment
atomically marks the candidate `COMPLETED`, but does not calculate
pass/fail/conditional outcomes, does not create a Master final decision, does
not promote the student, and does not update `Student.current_rank`. Session
status changes must use the canonical `transition_grading_session()` service;
ordinary model saves reject direct status changes. Session locking requires
every non-withdrawn candidate to have an `IN_PROGRESS` or `COMPLETED`
assessment; generation alone is insufficient because assessment start must occur
while the session is `OPEN`. Session completion requires every non-withdrawn
candidate to have a completed assessment. `LOCKED -> OPEN` is rejected now that
assessment records exist. New sessions start in `DRAFT`, and normal API/admin
workflows cannot create sessions directly in later statuses. Withdrawn
candidates do not block locking or completion. Generated snapshots prevent
candidate student,
testing-for-rank, and session changes. Deletion is limited to draft,
not-started snapshots. `generated_by` uses `PROTECT`, matching the existing
session creator audit-attribution policy. `assessor` uses `SET_NULL` so item
results survive account removal. `source_rank` uses `SET_NULL` because it is a
trace-only link and the copied item snapshot, not the live rank relationship, is
the historical record. Correction workflows, stronger audit events, category
summaries, final decisions, promotion history, certificates, notifications, and
frontend assessment screens remain deferred.

### 2026-06-23 - Grading session and candidate foundation

Status: Accepted

Decision:
Create a dedicated `gradings` Django app for `GradingSession` and
`GradingCandidate`. Expose authenticated CRUD endpoints at
`/api/gradings/sessions/` and `/api/gradings/candidates/`. Store candidate
`age_band` as a historical snapshot derived from `Student.date_of_birth` and the
session grading date. Validate candidate `testing_for_rank` as the next active
rank after `Student.current_rank`. The later candidate assessment snapshot
foundation supersedes the live-query-only syllabus boundary for historical
assessment display.

Context:
This slice establishes the session-to-candidate foundation needed before
assessment records. It deliberately excludes per-item assessment results,
pass/fail/conditional outcomes, scoring, promotion decisions, attendance outside
grading participation, frontend screens, notifications, certificates, and
payment handling.

Consequences:
This pre-assessment slice allowed `LOCKED -> OPEN` only while no assessment
records existed. That correction path is superseded by the candidate assessment
snapshot foundation, which rejects `LOCKED -> OPEN`. `CANCELLED` and
`COMPLETED` are terminal. Session deletion is allowed only for draft or
cancelled sessions; candidate deletion is now further constrained once
assessment snapshots exist. Candidate fields can be edited only while the parent
session is draft or open and only before generated snapshots make them
historical. Session grading dates cannot be changed after candidates are added,
preserving stored age-band snapshots without adding bulk recalculation logic.
Leap-day birthdays age on 1 March in non-leap years. `created_by`, candidate
`student`, and candidate `testing_for_rank` use protected foreign keys to
preserve historical and reference relationships. `Student.current_rank` is not
changed by this feature; promotion history, audit logging, and role-specific
production permissions remain deferred.

### 2026-06-23 - Syllabus catalogue foundation

Status: Accepted

Decision:
Create a dedicated `syllabus` Django app for the WKSA Version 2014 syllabus
catalogue. Store stable assessable items in `SyllabusItem` and map them to
rank-and-age-band testing requirements in `SyllabusRequirement`. Expose
authenticated read-only DRF endpoints at `/api/syllabus/items/` and
`/api/syllabus/requirements/`.

Context:
The official Junior and Adult/Youth testing charts distinguish age 8 and under,
age 9-12, age 13-17, and adults age 18 and over. These are testing-rule bands,
not permanent student attributes. The same item can have different numbered
ranges by rank and age band, so ranges belong on the requirement mapping rather
than the item.

Consequences:
`SyllabusItem.code` is globally unique and stable. `SyllabusItem.name` is not
globally unique so official repeated names remain possible. Numbered technique
and weapon ranges use `start_number` and `end_number`; form parts such as
`(1/2)` and `(pt.1)` remain concise notes. Hangul labels from the charts are
preserved where present. Optional Adult/Youth black-belt material marked "May be
taught, if time allows" is kept as catalogue items where named, but is not
mapped as an age-band requirement until its scope is confirmed. Age-band
resolution from date of birth and grading date, syllabus version workflows,
grading sessions, assessment results, scoring, attendance, and promotion
decisions remain deferred.

### 2026-06-21 - Rank catalogue foundation

Status: Accepted

Decision:
Create a dedicated `ranks` Django app for ordered rank reference data. Seed the
catalogue from migrations, expose a narrow authenticated read-only ranks API,
and represent `Student.current_rank` as a required protected foreign key to
`Rank`.

Context:
Ranks are shared reference data for student records, future syllabus mapping,
grading sessions, and historical promotion records. The catalogue must not
duplicate records by age band because age-specific requirements belong to the
future syllabus model.

Consequences:
Rank progression uses the explicit `Rank.order` field. Existing student rows are
backfilled to White during migration before `current_rank` becomes non-null.
Promotion history, grading sessions, syllabus mapping, age-band requirements,
and ranks above PKJN remain deferred.

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
Frontend implementation should be scaffolded around these tools. Styling, routing, and server-state choices remain open until they are needed - routing (React Router) and server-state (TanStack Query) were decided in the 2026-09-14 "Frontend stack and generated API types" entry; React, TypeScript and Vite themselves are unchanged.

### 2026-06-21 - Local development foundation

Status: Accepted

Decision:
Use native backend and frontend development servers with Docker Compose providing local PostgreSQL.

Context:
The initial foundation needs a runnable backend, frontend, and local database without committing production Docker image decisions.

Consequences:
`compose.yaml` starts PostgreSQL only. Production image layout and CI, both
unresolved at the time, are covered by the 2026-09-23 "One production app
service on existing Traefik and PostgreSQL" entry and `.github/workflows/ci.yml`
respectively; this entry's own decision - native dev servers, Compose for
local PostgreSQL only - is still the current setup.

## Open decisions

Every decision arising from the 2026-09-23 assessment grading redesign is
recorded above. See
`../frontend/Frontend-Design-Register/2026-09-23-assessment-overhaul/README.md`
for the nine proposed directions.

Left open by the 2026-10-04 audit (`audit/kukgrade-audit.md`). The owner's
answers to the rest are under "2026-10-18 - Owner answers on the audit's open
decisions" above.

1. **WKSA ID case and uniqueness (F-30)** - settled by "2026-10-20 - The
   WKSA ID scheme" above: the two forms are enforced on every path, and the
   school owner confirmed a number is never reused, so every ID is unique
   for good.
2. **Roster import (F-19)** - done 2026-10-20 by the import overhaul (A3):
   a bulk commit, and a 1,000-row limit; see the overhaul entry above.
3. **Housekeeping** - done 2026-10-20: the logo's source artwork moved to
   `frontend/Frontend-Design-Register/brand/`, beside FDR-048, out of the
   app's code; the 5,949 orphaned dev upload files were removed with
   `expire_stale_import_batches`. Tests write to a temporary folder, so they
   do not return (F-11).

Raised by the owner, to come back to and elaborate:

4. **A Settings page (2026-10-19; designed and begun 2026-10-21 - see FDR-056 to
   FDR-058; no Club tab: the time zone and club name are set when the container is
   set up).** Move most of what the account menu
   holds today - editing your name, changing your password, the Master
   capability summary, appearance - onto a dedicated Settings page, so
   people make these edits on a full page rather than in the small menu
   panel that covers the screen. What moves, what stays in the menu, and
   what else the page should hold are to be worked out. Until then the menu
   keeps them, including "Change password" (credential-lifecycle slice 1).
