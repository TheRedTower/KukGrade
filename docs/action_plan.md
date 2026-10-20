# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

In the owner's order (2026-10-20): 1, 2, 3, 4, then 5. Release assurance
(KG-A24, 2026-09-29 audit) waits until the owner asks for it.

1. **Go live.** Before it: map what the Administrator role - not superuser -
   can and cannot do (done 2026-10-20: `permissions.md`, "What an
   Administrator can do to other accounts"), and build the first-deployment
   prompt that sets up the first
   administrator (a superuser; no default password exists). Then connect the
   production image to the real Traefik and PostgreSQL host, cap the request
   body at Traefik, and verify backup, restore, and monitoring before
   describing it as live (`deployment.md`).
2. **The syllabus row-divider defect** under "Known defects" below.
3. **Extend the accessibility pass to the other screens**: the four grading
   surfaces were measured in slice 8; the rest of the app has only been
   checked visually. Known: the session screen's breadcrumb, banner button,
   search and filter are under 44px.
4. **Plain-language sweep of every screen's wording** (owner, 2026-10-19):
   no technical terms or internal detail a user does not need, for
   administrators too; reword or drop each one.
5. **Housekeeping**, revisited (decision log, Open decisions 3).

Later, when the owner asks: release assurance (KG-A24); rehearsing the
historical import against a sanitised copy of the real KSW Colchester
workbook (`data-import-and-legacy-migration.md`).

## Known defects

Recorded, not yet fixed.

- **Syllabus ledger rows show broken divider lines (2026-10-19).** In each
  ledger table on the syllabus screen (Techniques, Forms, Weapons), the line
  under a row's first column sits higher than the line under the other three
  wherever that row is shorter than its neighbours - for example a row with
  no Korean name, such as Sohn Ppae Ki. Cause:
  `frontend/src/Syllabus.css` gives `.syl-cell-curriculum` - the `<td>`
  itself - `display: flex`. That takes the cell out of table layout, so it no
  longer stretches to the row's height and its `border-bottom` is drawn at
  its own content height. Fix: keep the `<td>` a table cell and move the flex
  column onto an inner wrapper; check light, dark and narrow widths.

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
