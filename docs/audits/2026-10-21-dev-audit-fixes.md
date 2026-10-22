# Dev audit fixes — 2026-10-21

This is the implementation trail for the independent dev review dated
2026-10-21. Its detailed finding report is kept outside this repository.
The work began at `dev` commit `3a11fcc` and was done in the separate
`fix/dev-audit-2026-10-21` checkout. The original `dev` worktree was not edited.
The branch has not been pushed, merged or deployed.

| Finding | Disposition | Commit |
| --- | --- | --- |
| A12 dependency advisory | Vite pinned to patched 7.3.7 | `639897e` |
| A09 club time zone on collapsed reload | Site settings load before signed-in screens | `40c2e7c` |
| A11 upload-limit duplication | Backend serves the effective limit and the browser uses it | `bd89377` |
| A01/A03 group identity and unlinked queue | Backend supplies a stable group key and groups only selected linked state | `95bda5e` |
| A02/A04 partial links and queue pagination | Browser reads every record in the server group, keeps remaining records visible, and pages names and imports | `eb3bd28` |
| A05 historical correction and recovery | Durable record-detail route supports existing link, unlink, rank and void actions | `68fe959` |
| A06 mapping-save durability | Review waits for acknowledged mapping and cell saves; failure has an explicit retry | `76d8c68` |
| A07 correct valid rows beyond preview | Shared roster row editor is available in review views and on later pages | `9acfb79` |
| A08 invalid opening sheet | Multi-sheet roster upload permits explicit recovery through the existing sheet action | `3fc078c` |
| A10 promotion eligibility duplication | Per-session backend answer uses command-time policy and a bounded query count | `5d639a8` |
| A13 pre-pagination scoring | Group ordering precedes pagination; suggestions are scored only for the requested page | `e42dff7` |
| A14 stale current-state text | Current-system/action-plan and code comments reconciled | this document's commit |

Each functional commit was checked with focused tests before moving to the
next finding. The historical queue's 51st name and import, partial linking,
rank/link recovery after direct load, mapping failures, row seven and later
pages, alternate workbook sheets, and promotion blockers have specific
regressions.

For A13, a synthetic in-process comparison used 2,000 distinct name groups
and 500 students, repeating each run three times. Grouping plus scoring all
2,000 groups took 5.799–6.576 seconds; grouping the same records and scoring
the requested 50 groups took 0.149–0.166 seconds. The benchmark excludes
database I/O and is evidence about suggestion CPU work, not a production
latency claim. The endpoint still scans the selected historical records to
form and order groups.

The backend still caps one bulk-link request at 500 records. An unusually
large single name group needs selection in batches; the server rejects a
larger atomic request without changing any links. A06 serializes saves in
one browser session; a server revision protocol for simultaneous editors
remains a separate design choice. The large import/service files and the
roughly 501 kB main JavaScript bundle were measured but not split without
evidence of a concrete benefit. These are recorded limitations, not new
vulnerabilities or a reason to alter unrelated subsystems in this branch.

The final browser pass found two small follow-ups outside A01–A14. After a
successful historical import, `ImportReview` invalidates every `imports`
query before leaving the review screen. Its still-mounted legacy preview
therefore refetches a committed batch, which the server correctly rejects
with HTTP 400. The import and results page succeed. A focused follow-up
should stop that preview query when commit succeeds, then test that no
post-commit preview request is made. The import heading also says `1 rows`
for a one-row roster; use the existing count helper for singular wording.

## Verification

- Full frontend suite: 345 passed in UTC and 345 passed with
  `TZ=America/Los_Angeles`.
- Full backend suite: 1,200 passed against an isolated PostgreSQL instance.
- Backend Ruff, formatting and mypy: passed (212 formatted files, 211 typed
  source files checked).
- Focused backend tests for the changed historical, import and promotion
  areas: passed.
- Frontend lint, TypeScript check and production build: passed. `npm audit`
  reported zero vulnerabilities.
- Django system and deployment checks, migration drift, OpenAPI schema drift
  and generated API type check: passed.
- Production Docker image built. A container using the isolated database
  returned HTTP 200 for `/`, `/imports/history/101`, its built JavaScript,
  `/api/ready/` and `/api/site/`; the site payload carried the effective
  5 MiB upload limit. A nonexistent static JavaScript asset returned 404.
  This is a local serving smoke test, not a deployment or an authenticated
  end-to-end workflow test.
- A separate local same-origin Gunicorn/WhiteNoise browser run completed
  first-administrator setup and authenticated navigation. A synthetic CSV
  roster was uploaded, matched, corrected, reloaded and committed; the result
  showed the corrected student. A synthetic two-sheet historical workbook
  was uploaded, its ranks matched and both records committed. Linking one
  left the other in the queue across a reload; both were then linked. The
  persistent record-detail URL showed the linked state, allowed unlinking,
  retained the unlinked state across a reload, and allowed relinking. Local
  HTTP testing disabled secure-cookie and redirect settings; it did not test
  the public proxy. A second Docker rebuild for this extra browser pass hit a
  Docker Hub manifest timeout, so the browser used local production-built
  assets and Gunicorn; the earlier production image build and container smoke
  had already passed.
- Final diff whitespace check and frontend lint found no new dead or unused
  code. The original `dev` worktree remained clean at `3a11fcc`.
