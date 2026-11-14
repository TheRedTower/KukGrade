# Privacy: what the audit log holds, and erasing a student's details

KukGrade is used with children's data, so the permanent audit log is kept free of
personal details.

## What a new event holds

- A student is named by **WKSA ID** only ("Student 123-4-001 created.") and, in the
  event's details, by their internal `student_id`.
- A change to a student records **which fields changed** (`changed_fields`), never a
  name or a date of birth. Rank and status values are kept; they are not identifying.
- The audit screen and the overview show the student's **current name beside the event**,
  read when the page loads. It is blank once a student with no history has been erased (a
  deleted student with history keeps their record, so their name still shows). Correcting a
  student's name therefore corrects every screen at once.
- Some written judgements are copied into the log as written, because accountability
  needs them: both versions of an assessment's overall notes whenever they change; a
  proposal's notes, before and after each revision; a Conditional pass's requirements; the
  notes of a proposal discarded by a withdrawal after lock; a withdrawal note; and a
  historical record's void reason. These can mention a child, and **they stay in the log
  even after the student's record is erased**; see "What this does not do".
- Item comments and the reasons given for changing a mark are **not** copied: the log
  records that one was written, by whom and when, and the text lives only on the
  assessment, which is kept with the student's grading history.

A user-management event names the account as every record names a person ("Authority
changed for KSN Jane Smith."), and keeps the account's email address in its details, which
tell one person's administrator and instructor accounts apart. Those events are visible to
administrators only. Events written before 2026-11-11 named the account by email address
and are left as they were.

## Events written before this change

Events from before 2026-11 copied a student's name into their summaries ("Student Alex
Kim (123-4-001) created.") and a snapshot of their name, date of birth, rank and status
into their details. They are permanent, and the app refuses every change to them.
`redact_student_audit` is the one sanctioned way to remove a student's details.

### Procedure

1. Find the student's WKSA ID (the current one is enough) and every name they have had (a corrected name is in an
   older event). If they were deleted, take these from the request, not the database.
2. **Take a backup.** The command rewrites rows that are otherwise immutable.
3. Check what would change, for each name the student has had:

   ```bash
   python manage.py redact_student_audit --wksa-id 123-4-001 --first-name Alex --last-name Kim --dry-run
   ```

   In the container: `docker compose exec -it kukgrade python manage.py redact_student_audit …`.
4. Run it again without `--dry-run`. It prints how many events changed. Repeat for each
   other name.
5. A new event, "Personal details erased from the audit log", records that it was done: the
   WKSA ID and how many events changed, nothing else.

### What it does

- Replaces `<name> (<WKSA ID>)` in summaries with the WKSA ID, and any other occurrence of
  the full name with `[name erased]`.
- Removes `first_name`, `last_name` and `date_of_birth` from every snapshot of that
  student, found through the WKSA ID you give (in the log, and among current and previous
  student IDs): every snapshot in the events of that
  student's record, so a student whose ID changed (a black belt ID, a corrected typo) is
  followed through every ID. It does not match dates by value, so another student with the
  same birthday is untouched.
- Refuses, changing nothing, when the WKSA ID was held by more than one student record. That
  can only happen to a mistyped ID that was corrected: an ID a student really held, replaced
  or deleted is never given out again, but a mistyped one was never theirs and is not kept.
  It lists the internal student ids; run it again with the right one as `--student-id`,
  using `--dry-run` for each to see which events it would touch.
- Refuses a blank name or ID rather than rewriting the log.
- Leaves every event, its action, actor and time exactly as they were, and is safe to run
  twice (the second run changes nothing).

## Printed and downloaded files

A record, summary or grading sheet saved as a PDF ([Downloads and printing](features.md#downloads-and-printing-pdf))
or printed is outside the app's reach. Correcting a student's details, deleting a student,
erasing details from the audit log and any retention rule change nothing in a file already
made, nor on paper. The school owns those copies and must keep, share and destroy them under
its own rules. The app records each file made (who, when, and the WKSA IDs in it) but keeps
no copy. A PDF never holds a date of birth, an email address or anything only the audit log
shows, but it does hold names, marks, comments and outcomes.

## What this does not do

- It does not delete the student or their grading history. Deleting a student (their page)
  does not erase personal details either once they have been in a grading: the record is
  kept, name and date of birth included, so their past gradings still show who it was
  (owner, 2026-11-07). Only a record with no grading history is erased. An erasure request
  for a student with history is therefore not met by deleting them.
- It does not reach **backups** taken before the erasure. Those must be expired or
  replaced under your own retention rules.
- It does not erase other free text that someone typed about a child. The assessments keep
  their comments, reasons and notes, and **the audit log keeps its own copy** of the free
  text listed under "What a new event holds" (overall notes, proposal notes, Conditional
  requirements, discarded proposals, withdrawal notes, void reasons), and the command only
  replaces the name you give it, so a birth date or other identifying detail written into
  those notes stays. Treat an erasure as not complete until those events have been checked
  (the audit screen shows each event's recorded details).
- It cannot find a name that was typed into free text in some other spelling.
- How long audit events are kept is not decided yet; see the [roadmap](roadmap.md).
