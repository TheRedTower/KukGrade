# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

1. **Finish the assessment grading redesign**: slice 8 of
   `assessment-grading-redesign-handoff.md` (the dark/responsive/accessibility
   pass).
2. **Go live.** Connect the production image to the real Traefik and
   PostgreSQL host, then verify backup, restore, and monitoring before
   describing it as live (`deployment.md`).
3. **Rehearse the historical import** against a sanitised copy of the real
   KSW Colchester workbook. Every adapter fixture is synthetic, so expect
   adjustments (`data-import-and-legacy-migration.md`).
4. **Finish the accessibility pass**: measure per-element contrast in light
   and dark themes (it has only been checked visually), and confirm every
   `outline: none` has a visible focus replacement.
5. **Split `frontend/src/App.test.tsx`** (about 5,000 lines) into per-screen
   test files - a mechanical move that keeps every test name and assertion.

## Needs a decision first

- Whether offline grading is required, and its conflict policy, before any
  PWA, IndexedDB, or outbox work.
- Reports and exports, from an accepted reporting specification.
- Explicit syllabus version publication (deferred by decision; immutable
  assessment snapshots already make history reproducible).
- Backup ownership and retention.

## Deferred until there is a real need

Certificates, notifications, payments, student or parent self-service, and
any background worker.
