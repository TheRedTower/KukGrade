# Roadmap

This is the single list of what is still to come and what is deliberately not built.
If it is not here, it is either already in [features.md](features.md) or not planned.
The first stable release is 0.2.0; 1.0 follows once the items below are done. Items are
listed in rough order, without dates.

Want something here, or something that is missing? Open an
[issue](https://github.com/TheRedTower/KukGrade/issues/new/choose) first.

## Next: getting to 1.0

- [ ] **Bare-metal Linux release**: a tarball with its own Python, the built frontend and a
      systemd unit (amd64 and arm64), plus documented build-from-source, for people who do not
      use Docker.
- [ ] **Go live and prove it**: run a real deployment end to end, including a tested backup and
      restore and a request-size cap at the proxy, before calling a release production-ready.
      Proven on a test install (2026-11-21): updating in place from release candidate 14 to
      17 on the same data folder, as [Updating](installation.md#updating) says (seven
      migrations, every record kept and grouped into people), and restoring the backup taken
      before it into a new install of 17 with the commands in [Backups](installation.md#backups)
      (the same counts as the updated install, the missing migrations run on restart), then
      on through each candidate to 22 with every count the same. Still
      to do: the same on a real deployment, behind a proxy with its request-size cap.
- [ ] **Project page live**: the page is in `site/`, checked by CI, and live at kukgrade.co.uk
      on Cloudflare (`site/wrangler.jsonc`), built from `dev` until the first release reaches
      `prod`. Still to do: build it from `prod` with each release, retake its screenshots on
      release, and add link, accessibility and HTML checks.
- [ ] **Release assurance**: a repeatable pre-release checklist covering the install paths.
- [ ] **Phone and tablet layouts**: every screen now fits at every width in the automated check
      (`frontend/src/layout.css`, Playwright width check).
      Done when the owner has checked the demo site on a real phone and tablet.
- [ ] **Past gradings, people first**: saved records are grouped into people, and each person
      can be decided about through the API (link, not a current student, later, reopen, split,
      merge, confirm many), and what to check before saving is one list of exceptions, each
      decided through the API. The shared parts the phone screens are built from are in place
      (`ActionBar`, `DetailPage`, `QueueList`, `Progress`), and the import itself is phone-first
      from the upload to the save (sheets, things to check one at a time, every record, save).
      Sorting the people is phone-first too (the queues, a page for each person, split,
      merge or move records, choosing a student with a rank that does not fit flagged; on a
      laptop the list stands beside the person), and so are the Imports page, the finished
      import and the historical records (each record on a page of its own, its ranks
      corrected from the belts, its outcome read as a recommendation beside the workbook's
      key). The student import is on the same screens (its file, its columns and each row to
      fix as things to check, every row, save). All of it is in 0.2.0. Done
      when the owner has checked it on a real phone and tablet, with the item above.
- [ ] **Measure the audit log's record history** on a real session: the history behind a
      grading or a student filters events by `session_id` and `student_id` in their details,
      which no index serves yet. Add one if it is slow once real data exists.
- [ ] **Other schools' spreadsheets**: the historical-workbook adapter was written for the first
      school's layout. Document how to adapt it for another.

## Planned

- [ ] **Optional email** (via [Resend](https://resend.com)): welcome, password-reset and
      password-changed messages, and forgotten-password recovery. KukGrade works fully without
      email and always will; this is an enhancement. The design is settled: email is
      notification only, never authoritative account state, and a failed send never blocks an
      account or password action. Planned after 1.0.
- [ ] **Instructor groups** (a fallback, not the next step): assign each candidate to an
      instructor's group so each marks their own at the mat. It is introduced later, and only
      if the current marking procedure (any instructor may mark any item, every change after
      the first with a reason, comments from everyone) proves not to be enough on grading day.
      The design (who assigns, what a group sees) would be decided with the owner then.
- [ ] **Search refinements** (deferred, to be done alongside instructor groups, if at all). The
      search every list uses ([features.md](features.md#search)) already matches every word in any
      order, ignores accents and capitals, finds part of a word, forgives a slip in a longer word of
      letters and ranks the best match first, as you type. Not yet done:

  - _Sound-alike matching_ for names ("Smyth" for Smith, "Catherine" for Katherine) with
    PostgreSQL's built-in `fuzzystrmatch` (double metaphone); to be tried on real data first
    so it does not add noise.
  - _Short words and some spellings_: words under four letters get no typo tolerance, and
    "Ayesha" for Aisha is not found.
  - _Nicknames_ ("Bob" for Robert): a small, administrator-editable list, which is a policy
    choice to make with the owner.
  - _Highlighting_ which part of a result matched, and a _"did you mean…?"_ when nothing is
    found.

  A separate search engine (Meilisearch, Typesense) or a BM25 extension (ParadeDB `pg_search`,
  Timescale `pg_textsearch`) was considered and set aside: each adds a second service or an
  extension to install on a school's own PostgreSQL, for little gain on short names and titles.

## Needs a decision first

- **Black belt syllabus.** The app holds the syllabus up to Jo Kyo Nim. The charts for the
  ranks above it (Kyo Sa Nim and up) are not included; a school that needs them can enter them
  as syllabus data. Until then those ranks are kept out of the syllabus screen and the
  grading flow, and appear again by themselves once their syllabus is recorded. To decide: whether a black belt grading assesses its own chart on top of the
  cumulative lower ranks, as every grading does today.
- **Black belt testing.** Black belt candidates register and pay the national association, then
  must sit a minimum number of gradings (six for Jo Kyo Nim, more above) before a final national
  testing. What KukGrade should model of this (registration, the count, national testings as
  sessions or as outside events) is not yet decided.
- **Offline use.** Whether grading must work without a connection, and how conflicts are
  resolved when it reconnects, before any PWA or local-storage work.
- **Explicit syllabus versions.** Copying requirement text into every assessment already keeps
  history reproducible, so publishing named syllabus versions is deferred until there is a need.
- **Erasing a former student's personal details on request.** Deleting a student who has
  been in a grading keeps their record whole, so their history shows who it was
  (2026-11-07). To decide: whether an erasure request should blank their name and date of
  birth on that kept record while the gradings stay.
- **Backup ownership and retention** guidance for schools that host it themselves.
- **How long audit events are kept.** The log is permanent today and the retention period is
  not set; the erasure procedure in [Privacy](privacy.md) works whatever it turns out to be.

## Deferred until there is a real need

Certificates, notifications, payments, student or parent self-service, a background worker,
and running more than one application worker (the rate limits need a shared cache first).

## Known limitations

- The container serves HTTPS with a self-signed certificate by default, so browsers warn. Use one of
  the [proxy recipes](installation.md#choose-how-people-reach-it) or your own certificate for real use.
- Backups are documented but not scheduled for you.
- Abandoned import uploads are cleared by the next upload or the next start of the container, not on a
  timer: a server that is never restarted and receives no uploads keeps one until then. For a firm
  limit, run `expire_stale_import_batches` from a scheduler ([installation](installation.md#maintenance)).
- Data erasure on request: the audit log holds no names, dates of birth or typed text, so there is nothing to erase from it; the student's record and the copies outside the app (backups, PDFs) remain manual ([Privacy](privacy.md)).
- The emergency Django admin is view-only for grading and student data, and for the role
  groups. A record that needs correcting is corrected in KukGrade, or by calling the
  service from a shell; a role group's permissions change only in code, by a migration.
- The Cloudflare Tunnel and Pangolin Compose recipes follow the providers' documentation but have not
  been tried against the real services.
