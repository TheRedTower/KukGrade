# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

In the owner's order (2026-10-20): 1, 2, 3, 4, then 5. Release assurance
(KG-A24, 2026-09-29 audit) waits until the owner asks for it.

1. **Go live.** Done before it (2026-10-20): what the Administrator role -
   not superuser - can and cannot do (`permissions.md`, "What an
   Administrator can do to other accounts"), and the server side of setting
   up the first administrator (`/api/setup/` with a one-time code from the
   log, `deployment.md`) and the setup page the site shows until then
   (`SetupPage.tsx`). Then connect the production image to the real Traefik and PostgreSQL host, cap the request
   body at Traefik, and verify backup, restore, and monitoring before
   describing it as live (`deployment.md`).
2. **The syllabus row-divider defect** (fixed 2026-10-20: the first cell
   stays a table cell, `Syllabus.css`).
3. **Extend the accessibility pass to the other screens** (done 2026-10-20:
   `current-system.md`, "Accessibility pass over the rest of the app").
4. **Plain-language sweep of every screen's wording** (done 2026-10-20:
   `current-system.md`, "Plain wording").
5. **Housekeeping**, revisited (decision log, Open decisions 3).

Later, when the owner asks: release assurance (KG-A24); rehearsing the
historical import against a sanitised copy of the real KSW Colchester
workbook (`data-import-and-legacy-migration.md`).

## Known defects

None recorded.

## Waiting on a release

- **Email** (`email-and-credential-lifecycle.md`, slices 5-10): optional
  Resend email for welcome, reset and password-changed messages, and
  forgotten-password recovery. Waits for the packet's readiness condition
  (v1.0.0). The email-free slices 1-4 are built (`current-system.md`).

## Needs a decision first

- **Previous WKSA IDs** (decision log 2026-10-20): keeping the student ID a
  black belt ID replaced as a previous ID, and finding a student by either.
  The two forms, the black belt rank rule and the one change are built; the
  replaced ID is in that change's audit event meanwhile. Whether a leaver's
  student number can be given to someone new decides whether previous IDs
  stay unique; the school owner is to answer.

- **Black belt testing** (owner, 2026-10-20): the owner is to explain how
  black belt gradings work - the national grading, where the black belt ID
  is handed out - before KukGrade models them beyond the ID rule.
- Whether offline grading is required, and its conflict policy, before any
  PWA, IndexedDB, or outbox work.
- Reports and exports, from an accepted reporting specification.
- Explicit syllabus version publication (deferred by decision; immutable
  assessment snapshots already make history reproducible).
- The syllabus for KSN (2nd Dahn) and above. Nothing is recorded past JKN, so
  no candidate can be assessed for those ranks yet. Their charts are separate
  versions (2-1, 3-1, 4-1) with weapon forms, staff sparring and sections the
  current categories do not name; the owner confirms content and grouping.
- Backup ownership and retention.

## Deferred until there is a real need

Certificates, notifications, payments, student or parent self-service, and
any background worker.
