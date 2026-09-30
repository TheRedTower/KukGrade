# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

1. **Finish the 2026-09-29 audit remediation**
   (`audits/2026-09-29-independent-codebase-audit.md`). Done: KG-A01 to A05
   and A07 to A19 and A22; KG-A06 no longer applies (the filter it
   describes was removed). Remaining, in the audit's order:
   - KG-A20, A21 and A23: avoidable requests and queries (the session
     rows' per-session counts are already served - KG-A15; still open
     include the roster preview's per-row rank and existing-student
     lookups), bounded cleanup. The sessions table still decides whether to
     offer Delete from the completed count; serve a per-session
     `can_be_deleted` from `validate_session_can_be_deleted`, as the roster
     does for Move and Remove.
   - KG-A24: release assurance.
2. **Go live.** Connect the production image to the real Traefik and
   PostgreSQL host, cap the request body at Traefik, then verify backup,
   restore, and monitoring before describing it as live (`deployment.md`).
3. **Rehearse the historical import** against a sanitised copy of the real
   KSW Colchester workbook. Every adapter fixture is synthetic, so expect
   adjustments (`data-import-and-legacy-migration.md`).
4. **Extend the accessibility pass to the other screens**: the four grading
   surfaces were measured in slice 8; the rest of the app has only been
   checked visually. Known: the session screen's breadcrumb, banner button,
   search and filter are under 44px.
5. **Split `frontend/src/App.test.tsx`** (about 6,000 lines) into per-screen
   test files - a mechanical move that keeps every test name and assertion.

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
