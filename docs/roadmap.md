# Roadmap

This is the single list of what is still to come and what is deliberately not built.
If it is not here, it is either already in [features.md](features.md) or not planned.
KukGrade has not had a 1.0 release yet; items are listed in rough order, without dates.

Want something here, or something that is missing? Open an
[issue](https://github.com/TheRedTower/KukGrade/issues/new/choose) first.

## Next: getting to 1.0

- [ ] **First published image**: the release workflow is in place, but `latest` appears
      only when the first stable tag is cut on `prod`, after the first `dev` to `prod` merge
      and once the repository and the package are public. A release candidate publishes only
      its own tag.
- [ ] **Bare-metal Linux release**: a tarball with its own Python, the built frontend and a
      systemd unit (amd64 and arm64), plus documented build-from-source, for people who do not
      use Docker.
- [ ] **Go live and prove it**: run a real deployment end to end, including a tested backup and
      restore and a request-size cap at the proxy, before calling a release production-ready.
- [ ] **Release assurance**: a repeatable pre-release checklist covering the install paths.
- [ ] **Branch protection and a demo site**: once the repository is public, require green CI
      and a pull request on `dev` and `prod` (only merge commits into `prod`), and protect
      the `v*` tags. Run a demo site that
      follows `latest` (the newest stable release, cut from `prod`) with only made-up data.
- [ ] **Rehearse the historical import** against a sanitised copy of a real school's
      workbook. The importer has so far only been tried on synthetic workbooks.
- [ ] **Other schools' spreadsheets**: the historical-workbook adapter was written for the first
      school's layout. Document how to adapt it for another.

## Planned

- [ ] **Optional email** (via [Resend](https://resend.com)): welcome, password-reset and
      password-changed messages, and forgotten-password recovery. KukGrade works fully without
      email and always will; this is an enhancement. The design is settled: email is
      notification only, never authoritative account state, and a failed send never blocks an
      account or password action. Planned after 1.0.
- [ ] **Corrections after a session locks.** Today a completed assessment can be reopened only
      until the session locks; a post-lock correction workflow does not exist.
- [ ] **Reports and exports**, from an agreed reporting specification (for example a session
      summary or a student's grading history as a document).

## Needs a decision first

- **Black belt syllabus.** The WKSA black belt charts are recorded exactly as printed for Kyo Sa Nim
  (adult, and the Youth chart for 13-17), Pu Sa buhm Nim and Sa Buhm nim (adults only); Pyung Kwahn
  Jung Nim has no chart. To confirm: whether a black belt grading assesses its chart on top of the
  cumulative lower ranks, as every grading does today, and how the charts' section names (kept in
  each line's notes) should appear on screen.
- **Black belt testing.** Black belt candidates register and pay the national association, then
  must sit a minimum number of gradings (six for Jo Kyo Nim, more above) before a final national
  testing. What KukGrade should model of this (registration, the count, national testings as
  sessions or as outside events) is not yet decided.
- **Offline use.** Whether grading must work without a connection, and how conflicts are
  resolved when it reconnects, before any PWA or local-storage work.
- **Explicit syllabus versions.** Copying requirement text into every assessment already keeps
  history reproducible, so publishing named syllabus versions is deferred until there is a need.
- **Backup ownership and retention** guidance for schools that host it themselves.

## Deferred until there is a real need

Certificates, notifications, payments, student or parent self-service, a background worker,
and running more than one application worker (the sign-in throttle needs a shared cache first).

## Known limitations

- The container serves HTTPS with a self-signed certificate by default, so browsers warn. Use one of
  the [proxy recipes](installation.md#choose-how-people-reach-it) or your own certificate for real use.
- Backups are documented but not scheduled for you.
- Data erasure (for example on request) is handled manually.
- The Cloudflare Tunnel and Pangolin Compose recipes follow the providers' documentation but have not
  been tried against the real services.
