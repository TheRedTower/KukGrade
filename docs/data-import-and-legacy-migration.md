# Data import and legacy grading migration

Source spec: `KukGrade_Data_Import_Legacy_Migration_Definitive_Implementation_Spec.md`
(handed over in full; its sixteen locked product/domain decisions are
authoritative for this feature unless superseded by a dated entry in
`decision_log.md`). This document tracks what is actually implemented today
and defers to the spec for anything not yet built.

## Status

**Implemented: student roster import (2026-09-21) and historical
KSW Colchester grading-workbook migration (2026-09-22)**, including rank
review, identity reconciliation, void/correction workflows, and the unified
grading-history read model. See `decision_log.md`'s "Student roster bulk
import (Phase A of the data-import spec)" entry for the five deviations
from the spec's literal recommendations that apply to both halves (Tablib
instead of `django-import-export`, no background worker, local filesystem
storage, all-or-nothing commit) and the exact-match-only rank resolution
decision specific to the roster importer, and its "Historical KSW
Colchester grading-workbook migration" entry for the historical half's own
choices. Not yet done: a rehearsal against a real (sanitised) copy of the
actual workbook - every fixture used to build and test the adapter is
synthetic, and the real file must never enter this repository (spec
sections 38/40).

## Student roster import

### Who can use it

Administrator only - `data_imports.add_importbatch` to upload,
`data_imports.view_importbatch` to preview, `data_imports.can_commit_import`
to commit, `data_imports.change_importbatch` to cancel. No group grants any
of these to an Instructor. See `permissions.md`.

### Accepted formats

`.xlsx` and `.csv`, up to 5 MiB, up to 5,000 rows and 50 columns. Anything
else - wrong extension, a file that isn't actually a valid workbook/CSV,
`.xlsm` - is rejected before it is ever written to disk.

### Standard column headers

```
WKSA ID | First Name | Last Name | Date of Birth | Current Rank | Status
```

Dates: `YYYY-MM-DD` or `DD/MM/YYYY`. `Current Rank` must match a `Rank.code`
or `Rank.name` exactly (case-insensitive) - see "Rank resolution" below.
`Status` defaults to `ACTIVE` if left blank.

A custom column mapping (source header -> target field) is also supported
for a non-standard spreadsheet; `data_imports.mappings.suggest_column_mapping`
pre-fills a best-effort guess from common aliases (`Member No`, `Forename`,
`Belt`, ...), but the mapping the admin actually submits is always what gets
used - the suggestion is never authoritative.

### Lifecycle

```
upload (create_import_batch)
  -> preview (preview_student_import) - repeatable, nothing committed
  -> commit (commit_student_import) - or cancel (cancel_import_batch)
```

- **Preview** is recomputed from the stored source file every time it is
  called, never from a cached/staged copy of the rows (no permanent
  per-row staging table exists - only `ImportBatch` itself is persisted).
  Each row is classified `READY`, `REVIEW_REQUIRED` (missing/invalid field,
  or an unresolved rank), or `SKIP_EXISTING` (the WKSA ID already belongs
  to a `Student`).
- **An existing WKSA ID is always skipped, never silently updated.** Any
  future bulk-update-existing-students feature is a separate, undesigned
  piece of work.
- **Commit re-validates from scratch immediately before writing** - it
  never trusts a preview response the frontend is holding onto, since the
  file could have changed nothing, but the database (an existing WKSA ID
  created moments earlier by a different batch, or a rank deactivated in
  the meantime) could have. Only `READY` rows are ever written.
- **Every created `Student` goes through the ordinary
  `students.services.create_student` service** - the same one a hand-typed
  student creation uses - so full model validation and the normal
  `STUDENT_CREATED` audit event happen identically either way. The importer
  has no separate, weaker write path.
- **Commit is all-or-nothing**, inside one database transaction. If a row
  that was `READY` at the start of commit somehow fails when actually
  written (a rare race, not something normal usage triggers), the whole
  batch rolls back rather than partially committing. This is a deliberate
  simplification versus the source spec's partial-commit design - see the
  decision log.
- The source file is deleted from private storage on commit, cancel, or
  expiry (`manage.py expire_stale_import_batches --hours 24`, run manually
  or via an external cron - no background worker exists in this codebase).
- Re-uploading a file with an identical SHA-256 to one already `COMMITTED`
  produces a warning in the create response, not a block - the admin
  decides whether that's intentional.

### Rank resolution

Exact match only, against `Rank.code` or `Rank.name`, case-insensitive,
active ranks only. A row whose rank text doesn't resolve is
`REVIEW_REQUIRED`, not silently dropped or guessed. This is simpler than
the historical importer's rank-review workflow will need to be (see below)
because a clean roster export is expected to already use real rank names.

### Audit trail

One `IMPORT_BATCH_COMMITTED` (or `IMPORT_BATCH_CANCELLED`) event per batch,
with safe summary metadata only (`batch_id`, `kind`, a SHA-256 prefix,
`record_count`) - never row content, names, or dates of birth. Each created
`Student` additionally gets its own ordinary `STUDENT_CREATED` event, exactly
as it would from any other creation path.

### Storage

The uploaded file lives in private local storage
(`STORAGES["import_uploads"]`, `kukgrade/settings.py`), never under a public
`MEDIA_URL`, with a random UUID-based filename. **`IMPORT_UPLOAD_ROOT` must
be a persistent volume in any containerised deployment** - the same
requirement the database's own data directory already has - or an uploaded
file will not survive a container restart between upload and commit.

## Historical grading-workbook migration

Reuses the same `ImportBatch` foundation as the roster importer
(`ImportBatch.Kind.LEGACY_GRADINGS`) rather than a separate provenance
mechanism - the same `POST/GET .../batches/`, `.../preview/`, `.../commit/`,
`.../cancel/` endpoints, branching on `batch.kind`.

### Who can use it

Import/commit: the same `data_imports.*` permissions as the roster importer.
Reconciliation (link/unlink/resolve/void): `gradings.can_reconcile_imported
_history`, administrator-only. **Reading** an imported record
(`GET /api/gradings/legacy-records/`) is available to both roles, matching
native grading visibility (Decision 15 of the spec) - an instructor can see
imported history, only an administrator can correct it.

### Accepted format

`.xlsx` only, same size/row/column limits as the roster importer.

### The workbook adapter

`data_imports/ksw_adapter.py`, `parse_ksw_colchester_workbook()` -
deliberately source-specific (spec section 15), understands one workbook's
structure only:

- Ignores an `Information` sheet; recognises a cycle sheet by a `MM/YYYY`-
  shaped title and derives `cycle_year`/`cycle_month` from it, never an
  exact day. **A real finding during implementation**: Excel forbids `/` in
  a worksheet title (openpyxl raises on it), so despite the spec's own prose
  consistently writing cycle sheet names as `"06/2025"`, the real workbook
  cannot literally be titled that - the sheet-name pattern accepts `-` or
  `.` as the separator too, and preserves whatever the real title turns out
  to be in `source_sheet` rather than normalising it.
  An unrecognised non-empty sheet produces a warning rather than being
  silently dropped.
- Finds the main table's header row by content (a defensive scan for at
  least three of `Name`/`Current Rank`/`Testing For`/`Outcome`/`Comments`),
  not a fixed row number, and does not stop at the first blank row - an
  auxiliary section may follow further down the same sheet.
- Recognises `Unaccounted`/`Missing`/`Current belt` as `AUXILIARY_NOTE`
  sections and `Did not attend` as its own `DID_NOT_ATTEND` section, each
  producing classified rows rather than being forced into a fake grading
  result.
- Outcome text: `Pass`/`Fail`/`Conditional` map deterministically; `DNA`/
  `Did not attend` (in the main table's Outcome column, not just the
  auxiliary section) become `DID_NOT_ATTEND` attendance, never a `Fail`;
  anything else (`N/A`, free-form text) is preserved verbatim in
  `source_outcome_text` with `outcome` left unresolved, never forced.
- Every row gets a deterministic `source_locator` (e.g. `"06-2025!R14"`,
  or `"06-2025!Missing!R3"` for an auxiliary-section row), unique within
  the batch - checked defensively even though it cannot collide by
  construction.
- **Never resolves a rank.** `source_current_rank_text`/
  `source_testing_for_rank_text` are extracted verbatim; `current_rank`/
  `testing_for_rank` are always left unset by the parser. Rank resolution
  is an explicit, later, admin-reviewed step (Decision 4), not a parsing
  concern.

### Rank review

Unlike the roster importer, rank text here is reviewed **once per distinct
value across the whole batch**, not per row (spec section 17) -
`preview_legacy_grading_import()` collects every distinct
`source_current_rank_text`/`source_testing_for_rank_text`, case-insensitive,
and suggests an exact `Rank.code`/`Rank.name` match for each (never a
fuzzy/probabilistic one). The admin's `rank_mappings` (source text -> chosen
rank code, or explicitly `null`/omitted for "leave unresolved") is supplied
at both preview and commit time, and **never blocks a row from being
committed** - unlike the roster importer's required `current_rank`, an
unresolved historical rank is a normal, expected outcome, correctable at any
time afterwards via the reconciliation actions below.

### Commit

`commit_legacy_grading_import()` - re-parses the workbook and re-resolves
every rank mapping from scratch (never trusts a stale preview), creates one
`LegacyGradingRecord` per row via `gradings.legacy_services.
create_legacy_grading_record` inside one all-or-nothing transaction, and
records a single `IMPORT_BATCH_COMMITTED` audit event for the whole batch
(counts only - `total`, per-`record_kind` counts, unresolved-rank counts;
never row content). No native `Promotion`, `CandidateOutcome`, or
`Student.current_rank` change is ever produced by this path - verified
directly by a dedicated test.

### `LegacyGradingRecord`: what's immutable, what's correctable

Every source-derived field (everything except `student`, `current_rank`,
`testing_for_rank`, and the void fields) is immutable after creation -
`LegacyGradingRecord.clean()` diffs the persisted row and rejects any
attempted change, derived generically as "every model field except the
mutable set" rather than a second hand-maintained list. Physical deletion
is blocked at every layer (`Model.delete()`, `QuerySet.delete()`, `QuerySet.
update()`) - void is the only removal path, and it is itself one-shot: a
second void on an already-voided record is refused deterministically, and
there is no "unvoid".

The only mutation path is `gradings/legacy_services.py`, five functions,
each locking the row, saving, and recording one audit event
(`LEGACY_GRADING_LINKED`/`_UNLINKED`/`_RANK_RESOLVED`/`_VOIDED`):

- `link_legacy_record_to_student(record, student, actor=...)` /
  `unlink_legacy_record_from_student(record, actor=...)` - every link is an
  explicit administrator decision (Decision 3); nothing in this codebase
  ever infers one from a name match, however strong the suggestion looked.
  Unlinking or relinking never touches `source_name`.
- `resolve_legacy_current_rank(record, rank_or_none, actor=...)` /
  `resolve_legacy_testing_for_rank(record, rank_or_none, actor=...)` -
  `rank=None` explicitly leaves the mapping unresolved; the source rank text
  is never touched either way.
- `void_legacy_record(record, reason=..., actor=...)` - reason required,
  refused a second time on an already-voided record.

### Reconciliation screen and API

`GET /api/gradings/legacy-records/` (filters: `student`, `linked`,
`voided`, `record_kind`, `source_batch`) plus the five actions above as
`POST .../link-student/`, `.../unlink-student/`, `.../resolve-current-rank/`,
`.../resolve-testing-for-rank/`, `.../void/`. The frontend
(`LegacyReconciliationScreen.tsx`, reachable from the Gradings list header)
filters by link/void status and expands a row into an inline panel for
each action, including a name/WKSA-ID student search for linking.

### Unified grading history

`GET /api/students/{id}/grading-history/` (`gradings.
unified_student_grading_history`) combines every finalised native
`CandidateOutcome` with every linked, non-voided `LegacyGradingRecord` for a
student into one newest-first, source-labelled (`KUKGRADE`/`LEGACY`) list,
each item carrying its own honest date precision (`DAY` for a native
grading; `MONTH` for a historical one, unless a genuinely verified exact
date was added later). Deliberately separate from `/rank-history/`, which
is untouched and remains `Promotion`-only (spec section 26) - a legacy Pass
is never merged into native rank history. `StudentDetailScreen.tsx`'s
"Grading history" card renders this endpoint directly, with Did Not Attend
shown distinctly from Fail rather than as a red failure.

### Still open before a real production import

The spec's own hardening/rehearsal step (section 46): run the adapter
against a sanitised copy of the actual KSW Colchester workbook in a
non-production environment, compare per-sheet record counts against the
source, and explicitly verify zero native `Promotion`s, zero native
`CandidateOutcome`s, and zero `Student.current_rank` changes resulted. The
adapter's sheet-structure assumptions (header row detection, auxiliary
section names, the `-`/`.` sheet-name separator finding above) are a
best-effort reading of the spec's written description, built without ever
having the real file in this repository, and should be expected to need
adjustment once tested against it.
