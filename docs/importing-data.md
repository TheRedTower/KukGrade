# Importing data

Administrators can bring existing records into KukGrade from the **Imports**
screen. Nothing is saved until you review it and confirm, and you can leave an
import part-way and come back to it.

There are two kinds:

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

Imported records are deliberately **weaker evidence** than a grading done in
KukGrade:

- They are stored as text exactly as written (name, rank, outcome, comments) and
  that text can never be edited.
- They never create a promotion, an outcome or a rank change. Native rank history
  stays native.
- They are not linked to a student automatically. KukGrade suggests matches, with
  the reason, and an administrator confirms each link (or a person's whole history
  at once). A wrong link can be moved; a wrong record can be **voided**, never deleted.
- A month stays a month: an exact day is never invented.
- "Did not attend" counts as attendance, not as a fail.

A student's page then shows one timeline of both kinds, each labelled with its
source.

## Privacy

Uploaded files and stored rows contain personal data. They are deleted when an
import is cancelled or expires (24 hours), and an import's stored rows are deleted
30 days after it finishes. Run `expire_stale_import_batches` daily to enforce this
([installation](installation.md#maintenance)).
