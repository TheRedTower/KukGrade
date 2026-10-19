# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

1. **Finish the 2026-09-29 audit remediation**
   (`audits/2026-09-29-independent-codebase-audit.md`). Done: KG-A01 to A05
   and A07 to A23; KG-A06 no longer applies (the filter it
   describes was removed). Remaining, in the audit's order:
   - KG-A24: release assurance.
2. **Credential lifecycle, email-free part** (`email-and-credential-lifecycle.md`,
   slices 1-4): signed-in password change for everyone, the server-declared
   16-64 password policy, generated temporary credentials with expiry, and
   the Django admin site closed while a change is required. Slices 5-10
   (email) follow the packet's readiness condition.
3. **Go live.** Before it: map what the Administrator role - not superuser -
   can and cannot do, and build the first-deployment prompt that sets up the
   first administrator (a superuser; no default password exists). Then
   connect the production image to the real Traefik and PostgreSQL host, cap
   the request body at Traefik, and verify backup, restore, and monitoring
   before describing it as live (`deployment.md`).
4. **Rehearse the historical import** against a sanitised copy of the real
   KSW Colchester workbook. Every adapter fixture is synthetic, so expect
   adjustments (`data-import-and-legacy-migration.md`).
5. **Extend the accessibility pass to the other screens**: the four grading
   surfaces were measured in slice 8; the rest of the app has only been
   checked visually. Known: the session screen's breadcrumb, banner button,
   search and filter are under 44px.

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

## Needs a decision first

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
