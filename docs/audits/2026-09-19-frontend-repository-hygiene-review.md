# Frontend and Repository Hygiene Review

Date: 2026-09-19  
Scope: current `dev` working tree, frontend delivery, repository hygiene, and
documentation drift.

This is a dated evidence snapshot. `../current-system.md` remains the authority
for current implementation state.

## Outcome

The application is well beyond frontend scaffolding. The main instructor path
is implemented from student/session setup through marking, decisions, and
promotion. The most important functional correctness issues found in this pass
were repaired: instructor session creation, missing-assessment preparation,
server-side grading search/filtering, complete pagination for workflow data,
and the explicit bulk prepare/start flow.

The frontend is not complete. Audit and Users are access-controlled
placeholders, the locked-session withdrawal and dedicated no-show UI are not
exposed, and offline/PWA behaviour does not exist.

## Completed in this pass

- Restored a clean strict-mypy run by removing obsolete suppressions.
- Aligned grading-session creation UI with backend instructor permissions.
- Added the missing single-candidate assessment-generation call and state.
- Added bulk `Prepare all` and explicit `Start all prepared` controls.
- Applied grading status/year/search filters at the API, not to one browser
  page.
- Added all-page collection for complete cohort, outcome, promotion, student,
  and assessment-item workflow views.
- Replaced invalid `limit`/`offset` query use with the configured
  `page`/`page_size` contract.
- Updated root and repository documentation that still described the frontend,
  audit, promotion, student UI, CI, or permissions as unimplemented.
- Retired the stale agent handoff narrative and replaced it with stable source
  pointers.
- Updated vulnerable frontend development/build dependencies through the lock
  file; `npm audit` now reports zero vulnerabilities.

## Frontend completion map

Implemented:

- authentication, protected shell, profile/password controls, and themes;
- operational overview;
- student list, creation, detail, edit, and status handling;
- syllabus catalogue;
- grading list, creation, detail, lifecycle, cohort registration, and
  assessment preparation;
- assessment marking and completion review;
- instructor proposal and Master final decision;
- individual and cohort promotion.

Incomplete or absent:

- Audit event list/detail and filters;
- administrator Users list/detail, authority, and password reset;
- locked-session withdrawal UI and dedicated no-show/attendance selection;
- installed/offline PWA shell, local persistence, reconnection, and sync;
- full accessibility verification and complete light/dark/mobile parity.

## Hygiene findings

No tracked secrets, `.env` files, local PostgreSQL data, dependency folders,
build output, coverage output, Playwright scratch data, or OS metadata were
found. The ignore rules cover those local artifacts. Existing `.DS_Store` and
tool output files are ignored and not repository content.

The primary maintainability hotspots are size and coupling:

- `frontend/src/App.css`: about 10,000 lines;
- `backend/gradings/tests.py`: about 4,700 lines;
- `frontend/src/App.test.tsx`: about 4,600 lines;
- `backend/gradings/services.py`: about 1,800 lines;
- cohort/session/assessment screen components: roughly 1,000-1,300 lines each.

These are not immediate correctness defects, but they make ownership, review,
and targeted testing harder. Split by stable feature boundaries without
changing behaviour; do not combine that work with new product features.

The frontend production bundle is currently approximately 483 kB JavaScript
and 153 kB CSS before gzip (about 130 kB and 23 kB gzipped respectively). This
is acceptable for the current internal online-first application, but route
level lazy loading should be considered as Audit and Users are added.

## Recommended next sequence

1. Build the Audit browser against the existing paginated API, including
   permission-aware visibility, filters, empty/error/loading states, and tests.
2. Build administrator Users list/detail, role/authority changes, and password
   reset with explicit confirmation and permission tests.
3. Add no-show selection for draft/open sessions and the authorised
   locked-session withdrawal flow, preserving the backend's recorded reason.
4. Run a focused accessibility pass: keyboard order, focus restoration for
   dialogs/drawers, visible focus, labels, contrast, reduced motion, and zoom.
5. Split `App.css` and the two monolithic test modules by feature; extract
   repeated query invalidation, feedback, and table-state helpers only where
   behaviour is already duplicated.
6. Define deployment, backup/restore, monitoring, readiness, and rollback.
7. Decide whether offline grading is a real requirement before designing PWA
   persistence or synchronisation.

Do not start reports, certificates, notifications, or worker infrastructure
until their product scope is accepted.
