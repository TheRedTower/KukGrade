# Product Requirements

## Purpose

KukGrade is an internal web application for managing Kuk Sool Won grading operations. It should help authorised staff manage students, syllabus lookup, grading sessions, draft assessments, final decisions, audit history, and historical rank-change records without relying on spreadsheets as the source of truth.

## Confirmed Requirements

- Users are instructors and administrators; one designated instructor holds
  authorised Master authority. There is no separate grading-manager role.
- Students do not directly access the application.
- An authorised Master makes the final grading decision.
- Supported final outcomes are Pass, Fail, and Conditional.
- The grading workflow must support draft assessments before the authorised final decision.
- Assessment data must support category-level results, item-level met/not-met results, comments, and positive observations.
- Historical grading records must remain reproducible.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Each grading must retain the exact syllabus it was assessed against.
- Updating a syllabus must not change historical grading records.
- Student status must support active, inactive, and left.
- Missing a grading must not automatically mean that a student left.
- Student details, attendance, grading comments, and outcomes are personal data.
- Sensitive changes must be auditable.
- Development and testing must use anonymised or synthetic data.

## Confirmed Reference Data

Age bands:

- 8 and under
- 9-12
- 13-17
- 18+

Ranks:

- White
- Yellow stripe
- Yellow
- Blue stripe
- Blue
- Red stripe
- Red
- Brown stripe
- Brown
- Black stripe
- Dahn Bo Nim
- Jo Kyo Nim
- Kyo Sa Nim
- Pu Sa buhm Nim
- Sa Buhm nim
- Pyung Kwahn Jung Nim

## Scope

Delivered: staff authentication with role and per-user authority
permissions; student records; rank- and age-band-aware syllabus lookup;
grading sessions and candidates; item-level assessment with comments;
outcome proposal and the authorised Master's final decision; promotion and
rank history; bulk student-roster import and historical grading-workbook
migration; and an append-only audit log. `current-system.md` has the detail.

Not yet built, each needing an accepted specification first: eligibility
calculations, reports and exports, certificates, notifications, and offline
use. See `action_plan.md`.

## Settled questions

Questions this document once left open, now answered in `decision_log.md`:
Master authority is three per-user permissions rather than a role; a Pass is
promoted by a separate, explicit promotion step; attendance is recorded as
grading participation (withdrawn/no-show), not managed separately;
Conditional carries mandatory written conditional requirements.

## Open questions

- Whether cohort-level comments are needed.
- Whether reports and exports belong in the next release.
