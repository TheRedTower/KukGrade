# Data import and legacy grading migration

Source spec: `KukGrade_Data_Import_Legacy_Migration_Definitive_Implementation_Spec.md`
(handed over in full; its sixteen locked product/domain decisions are
authoritative for this feature unless superseded by a dated entry in
`decision_log.md`). This document tracks what is actually implemented today
and defers to the spec for anything not yet built.

## Status

**Implemented (2026-09-21): student roster import.** Not yet implemented:
historical KSW Colchester grading-workbook migration, identity
reconciliation, unified grading history, void/correction workflows. See
`decision_log.md`'s "Student roster bulk import (Phase A of the data-import
spec)" entry for why the historical-workbook half was deliberately deferred
past the student-roster half, and the five recorded deviations from the
spec's literal recommendations (Tablib instead of `django-import-export`,
no background worker, local filesystem storage, all-or-nothing commit, and
exact-match-only rank resolution for this phase).

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

## Historical grading-workbook migration (not yet implemented)

The source spec's `LegacyGradingRecord` model, `KswColchesterLegacyWorkbook
AdapterV1` parser, rank-review-and-approval workflow, identity reconciliation
(suggest-only, never auto-link), void/unlink/relink correction services, and
the unified `/students/{id}/grading-history/` endpoint are all designed in
the source spec but not yet built. When implemented, they will reuse the
same `ImportBatch` foundation (`ImportBatch.Kind.LEGACY_GRADINGS` already
exists in the model) rather than a separate provenance mechanism. See the
spec document itself for the full design - it remains the authoritative
reference for that half of the feature.
