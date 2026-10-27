# Action Plan

What remains, in order. What is already built is in `current-system.md`;
every slice starts with a clear acceptance check, and a slice that needs a
structural choice records it in `decision_log.md` first.

## Next

The deployment overhaul the owner set out on 2026-10-26 (decision log, the
2026-10-26 and 2026-10-27 entries) is part done: the admin closed to
the network, port 6942 and the proxy count, the stripped image, dependency
updates by pull request, one container with its own PostgreSQL and the
`deploy/` Compose files, and a CI job that starts the image both ways it is
deployed and signs in are built (`deployment.md`). In order, what is left:

1. **Bare-metal Linux release.** A release tarball with its own Python, the
   built frontend and an installer with a systemd unit (amd64 and arm64), and a
   documented build from source; a CI job that builds and smoke-tests it.
2. **Email-ready deployment, switched off.** Variables, the DNS checklist (SPF,
   DKIM, DMARC; the domain verified in Resend), an outbound HTTPS check and
   `email_enabled` on `/api/site/`, as `email-and-credential-lifecycle.md`
   specifies. No sending code.
3. **Publish the image** to `ghcr.io/theredtower/kukgrade` (the `deploy/` files
   name it; until then it is built locally).
4. **Go live** on the owner's host: connect `compose.prod.yml` to the real
   Traefik and PostgreSQL, cap the request body at Traefik, and verify backup,
   restore and monitoring before describing it as live (`deployment.md`).

The import overhaul (decision log 2026-10-20) is done, including the
2026-10-21 audit fixes (pull request #12; `audits/2026-10-21-dev-audit-fixes.md`).
Later, when the owner asks: release assurance (KG-A24), and rehearsing the
historical import against a sanitised copy of the real KSW Colchester workbook
(`data-import-and-legacy-migration.md`).

## Known defects

See `audits/2026-10-21-dev-audit-fixes.md` for the audit disposition and
any remaining limitations. Dated audit findings are snapshots, not a claim
that an unresolved defect still exists.

## Waiting on a release

- **Email** (`email-and-credential-lifecycle.md`, slices 5-10): optional
  Resend email for welcome, reset and password-changed messages, and
  forgotten-password recovery. Waits for the packet's readiness condition
  (v1.0.0). The email-free slices 1-4 are built (`current-system.md`).

## Needs a decision first

- **Previous WKSA IDs**: built 2026-10-20, with a deleted student's IDs
  retired too (decision log, "The WKSA ID scheme"); a mistyped ID is
  corrected through the student edit, never kept or retired.

- **Black belt testing**: how it works is recorded (decision log, 2026-10-27,
  "How black belt testing works"); what KukGrade should model of it (the
  registration, the count of gradings, the national testing) is still to
  decide with the owner.
- Whether offline grading is required, and its conflict policy, before any
  PWA, IndexedDB, or outbox work.
- Reports and exports, from an accepted reporting specification.
- Explicit syllabus version publication (deferred by decision; immutable
  assessment snapshots already make history reproducible).
- The syllabus for KSN (2nd Dahn) and above. Nothing is recorded past JKN, so
  no candidate can be assessed for those ranks yet. The owner has sheets for
  KSN (adult and youth), PSBN and SBN, kept outside the repository; none is
  needed for PKJN (the owner teaches at that grade). Their charts are separate
  versions (2-1, 3-1, 4-1) with weapon forms, staff sparring and sections the
  current categories do not name; the owner confirms content and grouping.
- Backup ownership and retention.

## Deferred until there is a real need

Certificates, notifications, payments, student or parent self-service, and
any background worker.
