# Privacy: what the audit log holds, and erasing a student's details

KukGrade is used with children's data, so the permanent audit log is kept free of
personal details.

## What a new event holds

- A student is named by **WKSA ID** only ("Student 123-4-001 created.") and, in the
  event's details, by their internal `student_id`.
- A change to a student records **which fields changed** (`changed_fields`), never a
  name or a date of birth. Rank and status values are kept; they are not identifying.
- The audit screen and the overview show the student's **current name beside the event**,
  read when the page loads. It is blank once the student has been deleted. Correcting a
  student's name therefore corrects every screen at once.
- Written judgements are kept as written because accountability needs them: a mark
  change's reason, an assessment's overall notes (both versions), a comment's existence.
  These can mention a child, so they are covered by the student's own records, not the
  log's rules; see "What this does not do".

Staff accounts appear in user-management events by email address; those events are
visible to administrators only.

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

## What this does not do

- It does not delete the student or their grading history; that is a separate, deliberate
  act (the student's page), and it removes the student's results.
- It does not reach **backups** taken before the erasure. Those must be expired or
  replaced under your own retention rules.
- It does not erase free text that someone typed about a child in a comment, a reason or
  a note; that text is part of the record and is removed with the record.
- It cannot find a name that was typed into free text in some other spelling.
- How long audit events are kept is not decided yet; see the [roadmap](roadmap.md).
