# Product Requirements

## Purpose

KukGrade is an internal web application for managing Kuk Sool Won grading operations. It should help authorised staff manage students, syllabus lookup, grading sessions, draft assessments, final decisions, audit history, and historical rank-change records without relying on spreadsheets as the source of truth.

## Confirmed Requirements

- Users are instructors, grading managers, administrators, and authorised Masters.
- Students do not directly access the application.
- An authorised Master makes the final grading decision.
- Supported final outcomes are Pass, Fail, and Conditional.
- The grading workflow must support draft assessments before the authorised final decision.
- Assessment data must support category-level results, item-level met/not-met results, comments, and positive observations.
- Historical grading records must remain reproducible.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Each grading must retain the exact syllabus version used at the time before assessment results are recorded.
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

## Proposed V1 Scope

- Staff authentication and role-based access.
- Student profile management.
- Rank and age-band-aware syllabus lookup.
- Grading session creation and candidate management.
- Examiner draft assessments with item-level met/not-met results.
- Comments, positive observations, and category-level summaries.
- Authorised Master final decision capture.
- Historical grading records and rank-change history.
- Audit logging for sensitive changes.

## Proposed Later Scope

- Eligibility calculations based on confirmed rules.
- Recommendation workflow.
- Attendance import or attendance management.
- Certificate generation.
- Reports and exports.
- Notifications and asynchronous jobs.
- Limited external integrations if needed.

## Unresolved Decisions

- Whether V1 includes eligibility calculations or only records eligibility-related data for later use.
- Whether attendance is managed inside KukGrade, imported, or deferred.
- Exact definition of Conditional and how follow-up actions are recorded.
- Whether an authorised Master is represented as a separate role, a permission, or a role plus explicit authorisation.
- Exact fields required on student profiles beyond the confirmed personal data and grading data.
- Whether a Pass automatically creates a promotion record and rank change, or whether a separate confirmation step is required.
- Whether cohort-level comments are required in V1.
- Whether reports are required in V1 or deferred.
