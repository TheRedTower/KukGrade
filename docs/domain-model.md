# Domain Model

## Confirmed Concepts

- Organisation and branches represent the operating structure.
- Users are staff accounts, not student accounts.
- Supported roles are Instructor, Manager, Administrator, and authorised Master.
- Students have statuses: active, inactive, and left.
- Ranks follow the Kuk Sool Won rank list in `docs/product-requirements.md`.
- Age bands are 8 and under, 9-12, 13-17, and 18+.
- Grading outcomes are Pass, Fail, and Conditional.
- Assessment data must support categories, item-level met/not-met results, comments, and positive observations.
- Final grading decisions are made by an authorised Master.
- Historical grading records must remain reproducible.

## Proposed Entities

- User: authenticated staff account.
- RoleAssignment: grants a role, possibly scoped by organisation or branch.
- Organisation: top-level operating body.
- Branch: school or location.
- Student: personal and membership profile.
- Rank: ordered rank reference data.
- SyllabusVersion: immutable published syllabus snapshot.
- SyllabusCategory: grouped syllabus section within a version.
- SyllabusItem: assessable requirement within a category, age band, rank, and syllabus version.
- GradingSession: scheduled grading event.
- GradingCandidate: student entered for a target rank in a session, with the selected syllabus version retained for historical reproducibility.
- ExaminerAssignment: staff member allowed to assess candidates in a session.
- Assessment: examiner draft or submitted assessment for a candidate.
- AssessmentItemResult: met/not-met result for a syllabus item, with comments or positive observations where the confirmed assessment design requires them.
- CategoryResult: category-level assessment summary where required.
- FinalDecision: authorised final outcome for a candidate.
- PromotionRecord: rank change created from a successful final decision.
- AuditEvent: append-only record of sensitive actions.

Entity names are proposals. Field-level schema should be confirmed before implementation.

## Proposed Grading Lifecycle

1. A grading session is created.
2. Candidates are added with a target rank.
3. The candidate is associated with the applicable immutable syllabus version before assessment item results are recorded.
4. Examiners create and edit draft assessments.
5. Assessments may be submitted for review.
6. An authorised Master reviews assessment data and records the final decision.
7. Any resulting rank change is recorded according to the confirmed promotion process.
8. Conditional and Fail outcomes remain in grading history with rationale and follow-up details as defined later.
9. Sensitive actions are written to the audit log.

## Historical Reproducibility Rules

- A grading must store or reference the exact syllabus version used at the time.
- Assessment item results must continue to identify the syllabus items that were presented at the time of grading.
- Published syllabus versions must not be edited in a way that changes historical meaning.
- Corrections to published syllabus data require a new version unless an explicitly approved and audited correction process is defined.
- Final decisions must retain the decision maker, timestamp, outcome, rationale when required, and any override indicator.

## Sensitive Changes Requiring Audit

- Syllabus changes.
- Permission or role changes.
- Final decisions.
- Overrides.
- Rank changes.
- Student status changes.
- Changes to submitted or finalised grading records.

## Unresolved Decisions

- Whether organisation support is single-organisation only in V1 or modeled for future multi-organisation use from the start.
- Exact student identity fields and whether membership number is required.
- Exact assessment category structure for each rank and age band.
- Whether multiple examiners can assess the same candidate in V1.
- Whether submitted assessments can be reopened, and by whom.
- How Conditional outcomes affect promotion, follow-up work, and any later assessment.
- Whether promotion records are created automatically on Pass or require a separate confirmation step.
