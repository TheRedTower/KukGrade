# Data import and legacy grading migration

This feature was built from an external implementation specification that
is not part of this repository. Its sixteen locked product decisions are
summarised below - code comments cite them as "import Decision N" - and stay
authoritative unless a dated `decision_log.md` entry supersedes one.

## Locked decisions

1. **Import authority**: only administrators upload, preview, map, commit,
   reconcile, or void. Backend permissions enforce it.
2. **No Student link required**: a historical record may be committed
   before anyone knows which student it belongs to; it keeps its own source
   name rather than inventing a placeholder student.
3. **No automatic identity linking**: suggestions only; a link is real only
   once an administrator confirms it.
4. **Rank mappings need review**: source rank text is never silently
   normalised, and is kept verbatim after a mapping is approved.
5. **Uncertainty does not block the import**: an unresolved rank or outcome
   is imported and left unresolved for review; a row fails only when it
   cannot be represented safely.
6. **A historical Pass never creates a native Promotion**, outcome,
   candidate, assessment, or rank change - native rank history stays
   native.
7. **Comments are not interpreted**: preserved verbatim, never turned into
   results.
8. **Did Not Attend is attendance, not failure**, and is excluded from
   Pass/Fail/Conditional rates.
9. **An existing WKSA ID is skipped and flagged**, never updated.
10. **No incomplete or placeholder students**: a roster row missing
    required data is held for review, not created.
11. **Standard template or custom mapping** for student files.
12. **Formats**: `.xlsx`/`.csv` rosters; `.xlsx` historical workbooks.
13. **Auxiliary information is preserved** (Unaccounted, Missing, Current
    belt sections) rather than dropped.
14. **Source date precision is preserved**: a cycle month stays a month;
    an exact day is never invented.
15. **Historical visibility matches native grading visibility**: both roles
    read imported records.
16. **Historical records are never physically deleted**: void, with a
    reason, is the only removal; a wrong link is corrected by unlinking.

## Status

**Implemented: student roster import (2026-09-21) and historical
KSW Colchester grading-workbook migration (2026-09-22)**, including rank
review, identity reconciliation, void/correction workflows, and the unified
grading-history read model. See `decision_log.md`'s "Student roster bulk
import (Phase A of the data-import spec)" entry for the five deviations
from the specification's recommendations that apply to both halves (Tablib
instead of `django-import-export` - itself replaced on 2026-09-30 by reading
with openpyxl and `csv` directly - no background worker, local filesystem
storage, all-or-nothing commit) and the exact-match-only rank resolution
decision specific to the roster importer, and its "Historical KSW
Colchester grading-workbook migration" entry for the historical half's own
choices. Not yet done: a rehearsal against a real (sanitised) copy of the
actual workbook - every fixture used to build and test the adapter is
synthetic, and the real file must never enter this repository.

## Student roster import

### Who can use it

Administrator only - `data_imports.add_importbatch` to upload,
`data_imports.view_importbatch` to preview, `data_imports.can_commit_import`
to commit, `data_imports.change_importbatch` to cancel. No group grants any
of these to an Instructor. See `permissions.md`.

### Accepted formats

A roster workbook is read from the sheet it opens on unless another is named
at upload, and every sheet's name is shown, so a roster on another tab is
never silently missed; `POST .../sheet/` reads another sheet instead
(2026-10-20). A column with no heading that holds something is named by its
letter ("Column F") so it can be matched or kept, and a heading used twice is
refused at upload, as one column would hide the other.

`.xlsx` and `.csv`, up to 5 MiB (`KUKGRADE_UPLOAD_MAX_BYTES`), 1,000 rows (5,000 until 2026-10-20)
after the header (blank rows included) and 50 columns; an `.xlsx` may also
expand to no more than 50 MiB. Each limit is enforced while the file is
read, not after, because a few kilobytes of workbook can describe a million
rows (`data_imports/parsers.py`). Anything else - wrong extension, a file
that isn't actually a valid workbook/CSV, `.xlsm` - is rejected before it
is ever written to disk. The workbook's active sheet (the one open when it
was saved) is read, its first row being the header; blank rows are skipped,
and every row keeps its own row number in the sheet.

### Standard column headers

```
WKSA ID | First Name | Last Name | Date of Birth | Current Rank | Status
```

Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, or `DD-MM-YYYY`. `Current Rank` must match a `Rank.code`
or `Rank.name` exactly (case-insensitive) - see "Rank resolution" below.
`Status` defaults to `ACTIVE` if left blank.

A custom column mapping (source header -> target field) is also supported
for a non-standard spreadsheet; `data_imports.mappings.suggest_column_mapping`
pre-fills a best-effort guess from common aliases (`Member No`, `Forename`,
`Belt`, ...), but the mapping the admin actually submits is always what gets
used - the suggestion is never authoritative.

### Lifecycle

```
upload (create_import_batch) - every row read once and stored (ImportRow)
  -> match columns (save_import_mapping) - every row checked
  -> fix a row (correct_import_row) / leave one out (set_import_row_excluded)
     - repeatable, nothing committed; the import screens save each as they
     go, and preview_student_import does all three in one call for an API
     client holding the mapping and fixes itself
  -> commit (commit_student_import) - or cancel (cancel_import_batch)
```

- **Rows are stored** (superseding "no permanent per-row staging table",
  2026-10-20 import overhaul): the file is read once at upload, and every
  later step reads and updates `ImportRow`s under the batch's lock, so fixes
  survive a reload and the file is not parsed again. An open batch uploaded
  before this has its rows read from its file the first time it is touched.
  Rows hold personal data: they go with a cancelled or expired batch, and a
  finished batch's rows go `COMMITTED_ROWS_KEPT_FOR` (30 days) after it
  finished. Each row is classified `READY`, `REVIEW_REQUIRED` (missing/invalid field,
  or an unresolved rank), or `SKIP_EXISTING` (the WKSA ID already belongs
  to a `Student`). A row is checked with `Student.full_clean()` - the
  validation `create_student` runs - so a `READY` row is one commit can
  create, field lengths included.
- **A roster's rank** is matched to an active rank's code or name, or to
  the club's fixed spellings of one ("White Belt" is White, "DBN" Dahn Bo -
  `ranks/matching.py`, 2026-10-20); a rank the file marks as doubtful ("Red
  stripe?") or misspells needs the importer, and a whole-file rank may be
  written either way.
- **An existing WKSA ID is always skipped, never silently updated.** Any
  future bulk-update-existing-students feature is a separate, undesigned
  piece of work.
- **Commit re-validates from scratch immediately before writing** - it
  never trusts a preview response the frontend is holding onto, since the
  file could have changed nothing, but the database (an existing WKSA ID
  created moments earlier by a different batch, or a rank deactivated in
  the meantime) could have. Only `READY` rows are ever written, and a
  commit with any row still `REVIEW_REQUIRED` is refused whole (owner,
  2026-10-20): each such row is fixed or left out first, never passed over.
- **A needed field may have no column** (owner, 2026-10-20): the mapping is
  accepted, and each row's value is typed in as a fix; until it is, the row
  is `REVIEW_REQUIRED`, so nothing missing is imported.
- **Each imported student records its import** (`Student.source_import`,
  by number), so an import's results can show just the students it added
  (`GET /api/students/?source_import=`).
- **Every created `Student` goes through the students service**: since
  2026-10-20 (A3) `students.services.create_students`, which creates many at
  once under the same rules as `create_student` - the model's own field and
  `clean()` rules for each, every ID's lock, and one check across all of
  them that no ID is held now, before or by a deleted student - and records
  the same `STUDENT_CREATED` event for each. The importer has no separate,
  weaker write path; it is one write instead of one per row.
- **Commit is all-or-nothing**, inside one database transaction. If a row
  that was `READY` at the start of commit somehow fails when actually
  written (a concurrent change, such as the same WKSA ID created elsewhere
  a moment earlier), the whole batch rolls back rather than partially
  committing, and the error names the row and the reason. This is a
  deliberate simplification versus the specification's partial-commit
  design - see the decision log.
- The source file is deleted from private storage on commit, cancel, or
  expiry - after that transaction commits, never before, so a failed commit
  leaves the batch open with its file intact.
- Expiry (`manage.py expire_stale_import_batches --hours 24`, run manually
  or via an external cron - no background worker exists in this codebase)
  takes the same batch lock as commit and cancel and rechecks each batch
  under it, so it never overwrites a batch committed in the meantime. It
  deletes an expired batch's stored rows with it, and the rows of batches
  finished more than 30 days ago. It also deletes stored files no batch names once they are older than
  `--hours`: a file left by an upload that failed, or whose delete after a
  commit failed.
- Re-uploading a file with an identical SHA-256 to one already `COMMITTED`
  produces a warning, shown by both import screens, not a block - the admin
  decides whether that's intentional.

### Rank resolution

Against `Rank.code` or `Rank.name`, case-insensitive, active ranks only,
plus the club's fixed spellings ("White Belt", "DBN" - `ranks/matching.py`)
and never a near miss. A row whose rank text doesn't resolve, or that the
file marks as doubtful ("Red stripe?"), is `REVIEW_REQUIRED`, not silently
dropped or guessed: the importer chooses the rank in the review step.

### Audit trail

One `IMPORT_BATCH_COMMITTED`, `IMPORT_BATCH_CANCELLED` or (from
`expire_stale_import_batches`) `IMPORT_BATCH_EXPIRED` event per batch,
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
native grading visibility (import Decision 15) - an instructor can see
imported history, only an administrator can correct it.

### Accepted format

`.xlsx` only, up to 5 MiB and expanding to no more than 50 MiB, with at
most 500 sheets, 50 columns and 50,000 rows across all sheets (blank rows
and unrecognised sheets included). The whole workbook is parsed at upload:
one that cannot be read, or that yields no records at all, is refused with
the adapter's warnings before anything is stored. So is one with a cell longer
than its record field can keep (source text is never cut to fit); the
refusal names each cell by its locator, such as `06-2025!R14`.

### The workbook adapter

`data_imports/ksw_adapter.py`, `parse_ksw_colchester_workbook()` -
deliberately source-specific, understands one workbook's
structure only:

- Ignores an `Information` sheet; recognises a cycle sheet by a `MM/YYYY`-
  shaped title and derives `cycle_year`/`cycle_month` from it, never an
  exact day. **A real finding during implementation**: Excel forbids `/` in
  a worksheet title (openpyxl raises on it), so although cycle sheet names
  are conventionally written `"06/2025"`, the real workbook
  cannot literally be titled that - the sheet-name pattern accepts `-` or
  `.` as the separator too, and preserves whatever the real title turns out
  to be in `source_sheet` rather than normalising it.
  An unrecognised non-empty sheet, or a cycle sheet with no recognisable
  header row, produces a warning in the preview rather than being silently
  dropped.
- Finds the main table's header row by content (a defensive scan for at
  least three of `Name`/`Current Rank`/`Testing For`/`Outcome`/`Comments`),
  not a fixed row number, and does not stop at the first blank row - an
  auxiliary section may follow further down the same sheet.
- Recognises `Unaccounted`/`Missing`/`Current belt` as `AUXILIARY_NOTE`
  sections and `Did not attend` as its own `DID_NOT_ATTEND` section, each
  producing classified rows rather than being forced into a fake grading
  result - whether written below the main table or, as the real workbook
  writes them (2026-10-20), **beside it in the same rows**. A side table
  starts at its heading; it claims the headed columns after it that it has
  (`Outcome`, `Comments`, `Current belt`) and the unheaded ones after those,
  which hold its notes. An `Unaccounted` table with its own Outcome and
  Comments is a set of grading results; `Missing` is notes; `Did not attend`
  keeps the current belt. A second copy of a main column (`Name` twice) is
  read once, with a warning. A main-table column KukGrade has no field for
  is kept on each row's record as `Heading: value` in `admin_note`.
- **Nothing non-blank on a grading sheet is dropped.** A cell no table
  claims - a "General Comments" column, a note typed beside the table - is
  kept as an `AUXILIARY_NOTE` named `Sheet note`, sectioned by its column's
  heading (or "Beside the table", or "Above the table" for a title over it)
  and located by its cell (`062026!Note!G2`), and the preview warns how many
  each sheet has. A main-table row with no name - a comment run on from the
  row above - is kept the same way, cell by cell. Before 2026-10-20 the adapter
  silently dropped every side table of the real workbook.
- Outcome text: `Pass`/`Fail`/`Conditional` map deterministically, a
  closing full stop allowed (`Pass.`, kept as written in the source text); `DNA`/
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
  is an explicit, later, admin-reviewed step (import Decision 4), not a parsing
  concern.

### Rank review

Unlike the roster importer, rank text here is reviewed **once per distinct
value across the whole batch**, not per row -
`preview_legacy_grading_import()` collects every distinct
`source_current_rank_text`/`source_testing_for_rank_text`, case-insensitive,
and suggests a `Rank.code`/`Rank.name` match for each: exact, or (since
2026-10-20, from the real workbook) through fixed spellings - a trailing
"Belt" dropped ("White Belt" is White), "DBN" for Dahn Bo - and a trailing
"?" read as the source's own doubt (`doubtful`). Never a near miss or a
fuzzy/probabilistic match: "DNB" is left for the importer. Each suggestion
also says how many rows use the text. The admin's `rank_mappings` (source text -> chosen
rank code, or explicitly `null`/omitted for "leave unresolved") is supplied
at both preview and commit time, and **never blocks a row from being
committed** - unlike the roster importer's required `current_rank`, an
unresolved historical rank is a normal, expected outcome, correctable at any
time afterwards via the reconciliation actions below.

**Records worth a look** (2026-10-21, FDR-052): each stored row carries its
reasons in `issues` - a rank not matched yet or marked uncertain, an outcome
KukGrade does not know, a sheet note - found at upload and again whenever
`rank_mappings` are saved. They only point the review step at a record;
none of them stops the import. The rows list filters them (`worth_a_look`)
and by kind (`record_kind`), and the preview counts them (`worth_a_look`).

### Commit

`commit_legacy_grading_import()` - reads the stored rows not left out and
re-resolves every rank mapping from scratch (never trusts a stale preview), creates one
`LegacyGradingRecord` per row - all of them in one write since 2026-10-20,
through `gradings.legacy_services.create_legacy_grading_records`, under each
record's own field and `clean()` rules (the real workbook's 214 records in
0.1 s and 30 queries, against 1.7 s and 3,665 one at a time) - inside one
all-or-nothing transaction, and
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
  explicit administrator decision (import Decision 3); nothing in this codebase
  ever infers one from a name match, however strong the suggestion looked.
  Unlinking or relinking never touches `source_name`. Since 2026-10-20 a
  record already linked to someone else moves only with `replace` (it used
  to be overwritten silently), and the student is locked before the record,
  the order deleting a student takes. `bulk_link_legacy_records` links many
  at once, all or nothing, each with its own audit event.
- **A wrong workbook imported is voided as a whole**
  (`POST /api/data-imports/batches/{id}/void-records/`, 2026-10-20): every
  record it created is voided with the reason, each with its own event, and
  leaves its student's history. Records are never deleted (import Decision
  16); re-importing the right file is the way back.
- **A voided record is left as it is**: linking, unlinking and resolving a
  rank are refused on it (2026-10-20). Deleting its student still unlinks it.
- `resolve_legacy_current_rank(record, rank_or_none, actor=...)` /
  `resolve_legacy_testing_for_rank(record, rank_or_none, actor=...)` -
  `rank=None` explicitly leaves the mapping unresolved; the source rank text
  is never touched either way.
- `void_legacy_record(record, reason=..., actor=...)` - reason required,
  refused a second time on an already-voided record.

### Reconciliation screen and API

`GET /api/gradings/legacy-records/` (filters: `linked`,
`voided`, and since 2026-10-20 `batch`, `needs_rank`, `source_name`,
`search`; each record carries its rank names, `report` - the comments - and
`note`) plus `GET .../people/` and `POST .../bulk-link/` (below) and the five
actions above as
`POST .../link-student/`, `.../unlink-student/`, `.../resolve-current-rank/`,
`.../resolve-testing-for-rank/`, `.../void/`. The frontend
(`LinkRecordsScreen.tsx` at `/imports/records`, FDR-055) takes one name at
a time from `people/`: its records in full beside the suggested students,
with a search for anyone else; the ticked records are linked through
`bulk-link/`, a rank still as written is matched and a record voided in
place. An import's results page links on the spot the same way (FDR-054).

**Suggested students** (`gradings/legacy_matching.py`, 2026-10-20):
`GET .../people/` groups records by the name as written and suggests, for
each, up to five students with the reasons in plain words - the first name
the same or close ("Sabastian" for Sebastian), a surname or initial that fits
(one that contradicts rules a student out), a name written surname first,
and whether the student's rank now fits the rank the record gave then
(nobody goes down a grade). Titles in front of a name ("JKN Alex") are not
part of it. When several students fit equally well the group says so
(`shared`) rather than one being picked. Sheet notes and voided records are
never suggested. Nothing is linked until a person confirms it, singly or with
`bulk-link` for a person's whole history.

### Unified grading history

`GET /api/students/{id}/grading-history/` (`gradings.read_models.
unified_student_grading_history`) combines every finalised native
`CandidateOutcome` with every linked, non-voided `LegacyGradingRecord` for a
student into one newest-first, source-labelled (`KUKGRADE`/`LEGACY`) list,
each item carrying its own honest date precision (`DAY` for a native
grading; `MONTH` for a historical one, unless a genuinely verified exact
date was added later). Deliberately separate from `/rank-history/`, which
is untouched and remains `Promotion`-only (import Decision 6) - a legacy Pass
is never merged into native rank history. `StudentDetailScreen.tsx`'s
"Grading history" card renders this endpoint directly, with Did Not Attend
shown distinctly from Fail rather than as a red failure.

### Still open before a real production import

A rehearsal before any production import: run the adapter
against a sanitised copy of the actual KSW Colchester workbook in a
non-production environment, compare per-sheet record counts against the
source, and explicitly verify zero native `Promotion`s, zero native
`CandidateOutcome`s, and zero `Student.current_rank` changes resulted. The
adapter was checked against the owner's real workbook on 2026-10-20 (read
outside the repository): its six quarterly sheets are titled `MMYYYY` with
no separator, and it reads 214 records - 196 in the main tables and 18 from
side tables and notes the earlier adapter dropped - with every non-blank cell
kept. The rehearsal's database checks are still to do.
