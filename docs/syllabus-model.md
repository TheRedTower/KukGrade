# Syllabus Model

## Confirmed Requirements

- The syllabus must be data-driven and versioned.
- The applicable syllabus depends on rank, age band, and syllabus version.
- Each grading must retain the exact syllabus version used at the time before assessment results are recorded.
- Updating a syllabus must not change historical grading records.
- Syllabus and grading rules must live in backend/domain data and APIs.
- React components must not hard-code syllabus rules.

## Proposed Model

- SyllabusVersion
  - version code or name.
  - effective dates if the business process needs date-based selection.
  - publication status.
  - immutable after publication except through an audited correction policy.
- SyllabusCategory
  - belongs to one syllabus version.
  - display order.
  - category name.
- SyllabusItem
  - belongs to one syllabus version and category.
  - applies to a target rank.
  - applies to one or more age bands.
  - item title and optional description.
  - display order.
- AssessmentItemResult
  - references the syllabus item used.
  - records met/not-met.
  - supports comments and positive observations at the confirmed level of detail.

This model is intentionally minimal until real syllabus detail is confirmed.

## Versioning Rules

- Draft syllabus versions may be edited before publication.
- Published syllabus versions must be treated as immutable.
- A new syllabus release should create a new SyllabusVersion.
- Grading candidates must be attached to the selected SyllabusVersion before assessment item results are recorded.
- Historical assessment results should continue to resolve the original version, categories, and items.
- If a published version must be corrected, the correction path must be explicitly approved and audited before implementation.

## Syllabus Selection

The backend should choose or validate the applicable syllabus using:

- candidate target rank.
- candidate age band according to the confirmed age-band date rule.
- selected published syllabus version.

Exact selection behavior is unresolved. Do not infer edge-case rules, transition rules, or date rules until confirmed.

## Confirmed Reference Inputs

Age bands and ranks are listed in `docs/product-requirements.md`.

## Unresolved Decisions

- Exact syllabus content for each rank and age band.
- Whether age band is determined at grading date, session date, registration date, or another date.
- Whether a syllabus version can overlap another version for transition periods.
- Whether syllabus items support optional, mandatory, or weighted requirements in V1.
- Whether category-level results are computed from item results or entered manually.
- Whether positive observations are item-level, category-level, assessment-level, or all three.
- How to handle corrections to an already published syllabus version.
