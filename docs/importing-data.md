# Importing data

Administrators can bring existing records into KukGrade from the **Imports**
screen. Nothing is saved until you review it and confirm, and you can leave an
import part-way and come back to it.

There are two kinds:

<!-- prettier-ignore -->
| | Student roster | Historical gradings |
| --- | --- | --- |
| For | The school's current list of students | Records of past gradings from an old spreadsheet |
| Formats | `.xlsx`, `.csv` | `.xlsx` |
| Creates | Student records | Read-only historical records, kept apart from native gradings |
| Who | Administrators only | Administrators import and reconcile; every staff member can read the result |

**Limits:** files up to 5 MiB (`KUKGRADE_UPLOAD_MAX_BYTES`); rosters up to 1,000 rows
and 50 columns. The limits are enforced while the file is read, so an oversized or
malformed file is refused rather than loaded.

## Student roster

1. **Upload.** The file is read once and its rows are stored for review. If the
   workbook has several sheets, pick the one that holds the roster.
2. **Match columns.** KukGrade suggests which of your columns is which (it knows
   common names like `Member No`, `Forename` and `Belt`); you confirm or change
   each. Columns KukGrade has no field for are kept as the student's extra
   information. A field the file lacks, such as everyone's rank, can be set once
   for the whole file.
3. **Review.** Each row is checked with the same rules as adding a student by hand
   and sorted into **ready**, **needs attention** or **already exists**. Fix a row in
   place or leave it out. A roster is imported only when no row needs attention.
4. **Commit.** Students are created in one batch, each with an audit event, and
   remember which import they came from so you can list one import's students.

The standard layout is:

```
WKSA ID | First Name | Last Name | Date of Birth | Current Rank | Status
```

Dates may be `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`. `Current Rank` is matched
to a rank's name or code (and common spellings such as "White Belt"); a rank marked
doubtful ("Red stripe?") is held for you to decide. `Status` defaults to Active.

An ID that already belongs to a student is **skipped, never updated**, so importing
the same list twice is safe.

## Historical gradings

A school that kept its grading results in a spreadsheet can bring them in so a
student's full history appears in one place. The importer was written against one
school's workbook layout, with one sheet per grading cycle; other layouts may need
the adapter in `backend/data_imports/ksw_adapter.py` adjusting.

Import the students first: past gradings are linked to students, so KukGrade does not
start an import of them while it has none.

Imported records are deliberately **weaker evidence** than a grading done in
KukGrade:

- They are stored as text exactly as written (name, rank, outcome, comments) and
  that text can never be edited.
- They never create a promotion, an outcome or a rank change. Native rank history
  stays native.
- They are not linked to a student automatically. KukGrade suggests a student for each
  person, with the reasons, and an administrator decides. A wrong link can be moved; a
  wrong record can be **voided**, never deleted.
- When records are saved, KukGrade groups them into **people**: the records whose names
  could be one person ("Theo R", "Theo Rowan", "Teo Rowan"; "Ben Marsh", "Benjamin Marsh";
  "Ivo Hart", "Ivo Lund-Hart"; anything in brackets after a name is not part of it) and
  whose ranks tell one story. A shortened first name counts only when both give a surname.
  Someone in an "Unaccounted" table with no outcome KukGrade knows ("N/A") counts as not
  graded that day, like someone missing or not attending.
  Passing to a rank and holding it on the next sheet is the strongest sign; nobody goes down
  a grade, and two results on one sheet are always two people. Each person says how sure that
  is and why, and is rated again when a record's rank is corrected or a record voided. A later
  import's records join the people already there, or become new ones; a
  person someone has already decided about takes a new record only on that strongest sign,
  and it waits for that decision to be confirmed for it. A suggested student whose rank now is
  below the rank the records gave then is never offered as the clear match.
- Each person is then decided: **linked** to a student (their records join that student's
  history), **not a current student** (an instructor, someone who left before KukGrade, an
  entry that is not a real person, or another reason that needs a note; their records stay
  unlinked), or **later** (shared by every administrator). A person can be **split** ("these
  aren't all the same person") or **merged** with another, and every decision can be undone:
  reopen a decision, merge back a split, split back a merge. People ready to confirm can be
  confirmed together, all or nothing. Each decision is in the audit log, naming the student
  by WKSA ID and nobody by a name as written. A decision made on what someone saw is refused
  once the person has changed since (another administrator, an import, a correction), so two
  administrators never undo each other unseen. While a person is linked or not a student,
  their records are changed only through that person.
- A note written beside a person's row, outside any table, is kept on that person's
  record and says where it was written; a note merged down several rows is kept on each
  person beside it. A note beside no one (a title above the table, say) is kept as a
  note on the sheet.
- Saving goes straight on to **sorting the people**, one screen at a time: how many are
  sorted, then three queues - **ready to confirm** (one student fits and the ranks agree;
  these can be confirmed together, after a look at the list), **needs a look** (several
  fit, something disagrees, or records joined a person already decided) and **no student
  found** - with the people left for later and those decided below. Each person has a page
  of their own: how they are written, their gradings in date order, the suggested
  students with the reasons, and only the decisions open to them. Next goes on through the
  list. Split and merge have a page of their own, and so does finding a student by name
  or WKSA ID.
- KukGrade reads what it can and lists only **what to check**, each one decision:
  - a rank it cannot read ("Bown Stripe") or that the workbook marks with "?": choose
    the rank, or keep it as written (unmatched);
  - an outcome it cannot read ("Testing? No"): read it as Pass, Fail or Conditional,
    or keep it as written (no outcome);
  - a name written twice on one sheet (the same person twice, or two people with one
    name), or someone listed as missing or absent and also graded there: leave one
    row out, or keep both;
  - a result with no outcome, or a row with a rank missing: leave it out, or keep it.

  One decision covers every row that writes a spelling the same way. A rank or
  outcome KukGrade reads is taken as read, with nothing to confirm; a later decision
  replaces an earlier one, so keeping as written brings back a row the check left out. The workbook's text is always kept as written: a chosen rank
  or a reading is applied when the records are saved. Nothing is guessed, and nothing
  to check stops the import.

- A month stays a month: an exact day is never invented.
- "Did not attend" counts as attendance, not as a fail.
- The workbook grows a sheet each grading, so upload the whole of it again: it is
  imported **sheet by sheet**. Each sheet is compared with what KukGrade already holds for
  its month and is **new**, **already imported**, or **changed since imported** (with the
  records that differ). Only new sheets are chosen; a changed one comes in only if you
  choose it. Two sheets for the same month are refused.
- **Nothing is added twice.** A record already held - known by what it says (month, name,
  ranks, outcome, comments), wherever its row now is - is never added again, even on a
  sheet you choose. A note written beside a row later does not make the record new. A
  voided record does not count as held.

A student's page then shows one timeline of both kinds, each labelled with its
source.

## Privacy

Uploaded files and stored rows contain personal data. They are deleted when an
import is cancelled or expires (24 hours), and an import's stored rows are deleted once it
has been finished for 30 days. An expired upload is cleared by the next upload or the next
start of the container; finished rows past 30 days, by the next start of the container. Run
`expire_stale_import_batches` daily for a firm limit on both
([installation](installation.md#maintenance)).
