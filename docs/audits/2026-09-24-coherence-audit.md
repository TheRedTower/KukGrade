# Coherence Audit - 2026-09-24

A repository-wide review for stale, redundant, and duplicated code and
documentation, followed by the cleanup it called for. Every backend and
frontend source file, test, migration outline, CI step, and document was read;
dead symbols and unused CSS selectors were found by scripted cross-reference
rather than by eye, and each defect fix below was proven with a test that
fails against the code before the fix.

Numbering continues the `KG-nnn` register (`KG-001`..`KG-054` are in the
2026-09-13 and 2026-09-15 audits). This is a dated snapshot:
`../current-system.md` remains the authority for what exists now.

Baseline before the cleanup: 624 backend and 173 frontend tests passing; Ruff,
format, strict mypy, Django checks, and migration drift clean.

## Defects found and fixed

| ID | Finding | Fix |
| --- | --- | --- |
| KG-055 | A partly failed bulk promotion told the Master every candidate had been promoted. The backend returns `errors` as a map; the Promotion Ledger read it as an array (`.length` of an object), and its test mocked the wrong shape. | Screen counts map keys; test uses the real contract. |
| KG-056 | The published OpenAPI schema described the wrong bodies for 17 custom actions (bulk endpoints, outcome summary, propose/finalise/promote, legacy reconciliation, and every import action), so the frontend hand-wrote those types - which is how KG-055 drifted. Nothing checked `schema.yml` against the code. | Every action declares its request and response; the bulk, summary, and import responses serialize through the declared serializers; all frontend API types alias the generated schema; CI regenerates `schema.yml` and fails on drift. |
| KG-057 | The Master's final-decision drawer showed raw category codes (`TECHNIQUE_SET`) in its category table; tests fed it display labels the API never sends. | Summary categories carry `category_display` from the backend; fixtures use the real shape. |
| KG-058 | The historical-workbook preview always returned `warnings: []`, silently discarding the adapter's "unknown sheet" and "no header row" warnings the UI was built to show. | Preview returns the adapter's warnings. |
| KG-059 | Django admin's audit-log rule had drifted from the API's: it refused holders of `can_view_grading_audit_log`, and showed a Master user-management events the API hides. | One predicate (`can_view_audit_log`) and one queryset rule (`visible_to`) shared by both. |
| KG-060 | The attendance and withdrawal dialogs re-ran their focus effect on every parent re-render (inline `onClose`), throwing the user's focus back to the first field mid-task; they, the audit detail dialog, and the user-management dialogs could also be closed while their request was in flight. | All four moved onto `useDialogFocus` with `canClose` bound to the pending state. |
| KG-061 | Three copies of the rank-colour component had drifted: Jo Kyo Nim, Kyo Sa Nim, Sa Buhm nim, and Pyung Kwahn Jung Nim rendered grey on every screen, and White and Pu Sa buhm Nim differed by screen. | One `RankVisual` with the syllabus screen's classification. |
| KG-062 | A not-started assessment's status pill rendered unstyled: the class was built from the API value (`not_started`) but the rule was spelled `not-started`. | Rule and fallback use the API value. |
| KG-063 | `KUKGRADE_UPLOAD_MAX_BYTES` changed Django's request limits but not the actual 5 MiB spreadsheet limit, which was hard-coded separately; the settings comment claimed otherwise. | One `IMPORT_UPLOAD_MAX_BYTES` setting drives the import limit and Django's limits. |
| KG-064 | A student-detail test depended on today's date (a fixed birth date banded client-side against the real clock). | The screen shows the API's `age_band_display`; the test is deterministic. |

## Dead code removed

- Backend: `validate_candidate_outcome_can_be_deleted` (never called); the
  unreachable `WITHDRAWN` branch in `validate_outcome_assessment_state`
  (logged as KG-012 in September, never removed); an unreachable status
  branch and an unused `result` parameter in
  `validate_assessment_item_can_be_changed`; a dead `# noqa: ARG001`;
  redundant inverted-date-range checks; duplicate deletion validation in two
  `destroy` actions (the services already validate inside their transaction);
  ten no-op `create()` stubs; a duplicate `PAGE_SIZE` setting; two
  hand-written managers replaced by `as_manager()`; `has_numbered_range`.
- Frontend: six unused API client functions (`getHealth`,
  `getCandidateAssessment`, `getCandidateOutcome`, `getSyllabusRequirements`,
  `getAllLegacyGradingRecords`, `updateGradingCandidate`) and their unused
  types; six unused CSS rules; two dead age-filter branches matching values
  the select never emits; a client-side age-band calculation duplicating the
  backend rule the API already answers; exports and `eslint-disable` comments
  for helpers nothing imported; a type loosening that let fixtures omit
  fields the API always sends.

## Duplication consolidated

| Where | Before | After |
| --- | --- | --- |
| View query filters | ~30 hand-written four-line idioms across seven viewsets | `kukgrade/filtering.py` helpers |
| Bulk services | Five copies of the savepoint-per-row loop | `_each_independently` |
| Age bands | Thresholds in `resolve_age_band` and again as date arithmetic in the students view | One table, read both ways, with a property test that the two never disagree |
| Authority permissions | Constants, `SENSITIVE_PERMISSIONS`, and `AUTHORITY_PERMISSIONS` in three modules | `accounts.permissions.AUTHORITY_PERMISSIONS` |
| User serializers | Eight identical permission getters, three password-validation blocks | `AuthorityFields` / `HasPermission`, `_validated_password` |
| Data-import services | Lock/commit/file-read/rank-resolver blocks written twice | Shared private helpers |
| Legacy rank resolution | Two copy-paste service functions | One implementation, two thin entry points |
| Number ranges | Validation and formatting duplicated in two models | `numbered_range_errors`, `format_numbered_range` |
| Shared error helper | Imported by four apps from `gradings.serializers` | `kukgrade.exceptions` |
| Test fixtures | Workbook builders twice, legacy-record factories four times, tests importing other apps' `tests.py` | `data_imports/testing.py`, `audit/testing.py` |
| Frontend | `formatSessionDate` x4, `errorMessage` x2, `RankVisual` x3, four hand-rolled focus traps, jest-dom import x13 | `dates.ts`, `api.ts`, `RankVisual.tsx`, `useDialogFocus`, `test-setup.ts` |

## Stale references and documentation

- About 40 code comments and API docstrings cited sections of an external
  specification not in the repository; its 16 locked decisions are now
  summarised in `data-import-and-legacy-migration.md` and cited as "import
  Decision N". Comments narrating history ("previously", "found while",
  "Phase 2b", a renamed "V1" class) were rewritten to state current fact.
- AGENTS.md said the audit log was "readable by any signed-in user" (untrue
  since KG-048) and that production images were not implemented.
- Retired: `backend-completion-spec.md` (complete, yet AGENTS.md called it
  "the remaining backend work"), `frontend-next-steps-handoff.md`,
  `HANDOFF.md`, `audits/remediation-status.md`, `data_model.md`,
  `grading_app_planning.md`, `domain-model.md` (still listed a Manager role),
  `syllabus-model.md`, and `testing-strategy.md` (merged). Verification
  commands had been written out four times with three different mypy app
  lists; `development-workflow.md` now holds the one list.
- `api_contract.md` kept only implemented endpoints and was corrected
  (`/auth/me/` lists four authority flags; filters `age_band` and `search`;
  the syllabus note no longer calls assessment and promotion "deferred").
  `current-system.md` had `POST` where the code has `PATCH`.
- CI's `npm audit` gate was held at `critical` "until KG-020 is cleared";
  it had cleared (0 advisories), so the gate is now `high`.

## Found but deliberately not changed

Each needs a product or schema decision rather than a cleanup:

- `ImportBatch.Status.PARTIAL` and `FAILED`, and `ImportBatch.error_summary`,
  are never produced or written. `PARTIAL` is documented as reserved for a
  future partial-commit design. Removing them is a migration and an API
  change.
- Migrations: `audit` 0002-0005 only re-list the action choices. The app is
  not deployed yet, so squashing is possible, but it touches every existing
  database.
- `LegacyOutcome` duplicates `CandidateOutcome.Outcome`'s values; kept
  separate on purpose so imported evidence stays decoupled from native
  grading.
- `student_display_name` means "First Last" on candidates but "First Last
  (WKSA-ID)" on outcomes and rank history - an API contract change to align.
- Boolean list filters disagree: `required` accepts `1`/`yes`, `is_active`
  only `true`/`false`, and `linked`/`voided` ignore an invalid value where
  every other filter returns an empty page.
- `frontend/Frontend-Design-Register/` holds 29 MB of design PNGs; removing
  them from the tree would not shrink Git history.
- The four rank visuals (dot, two stripe glyphs, the syllabus swatch) and
  about ten date formats are intentionally different per screen; unifying
  them is a design decision.
- `frontend/src/App.test.tsx` (about 5,000 lines) should be split per
  screen - listed in `../action_plan.md`.

## Verification after the cleanup

630 backend tests (6 new) and 180 frontend tests (7 new) pass; Ruff, format,
strict mypy, Django checks, deploy checks, migration drift, OpenAPI schema
regeneration (byte-identical), generated-type regeneration, ESLint,
TypeScript, the production build, and `npm audit --audit-level=high` are
clean. The running development servers were smoke-tested: the app boots to
sign-in, `/api/health/` and `/api/ready/` answer 200, and protected endpoints
return the standard error envelope.
