# Privacy: what the audit log holds, and erasing a student

KukGrade is used with children's data, so the permanent audit log is kept free of
personal details.

## What an event holds

- A student is named by **WKSA ID** only ("Student 123-4-001 created.") and, in the
  event's details, by their internal `student_id`.
- A change to a student records **which fields changed** (`changed_fields`), never a
  name or a date of birth. Rank and status values are kept; they are not identifying.
- The audit screen and the overview show the student's **current name beside the event**,
  read when the page loads. It is blank once a student with no history has been erased (a
  deleted student with history keeps their record, so their name still shows). Correcting a
  student's name therefore corrects every screen at once.
- **Nothing typed is copied.** Notes, reasons and conditions (an assessment's overall
  notes, item comments, the reason for changing a mark, a proposal's notes, a Conditional
  pass's requirements, a withdrawal note, a session's cancellation reason, a registration's
  notes, a historical record's void reason) can mention a child, so an event records only
  that one was written or changed ("Notes: Changed", "Note given: Yes"), by whom and when.
  The words live only on the record, which is kept with the student's grading history. A
  record holds its current text, and what is final is frozen with the decision; an earlier
  wording, and the notes of a proposal discarded by a withdrawal after lock, are not kept.
  `audit.recording.record()` refuses an event whose details carry any of these fields.

A user-management event names the account as every record names a person ("Authority
changed for KSN Jane Smith."), and keeps the account's email address in its details, which
tell one person's administrator and instructor accounts apart. Those events are visible to
administrators only.

Events written before 2026-11-27 copied typed text; a migration cleared it from them, so
they read as new ones do.

## Printed and downloaded files

A record, summary or grading sheet saved as a PDF ([Downloads and printing](features.md#downloads-and-printing-pdf))
or printed is outside the app's reach. Correcting a student's details, deleting a student
and any retention rule change nothing in a file already
made, nor on paper. The school owns those copies and must keep, share and destroy them under
its own rules. The app records each file made (who, when, and the WKSA IDs in it) but keeps
no copy. A PDF never holds a date of birth, an email address or anything only the audit log
shows, but it does hold names, marks, comments and outcomes.

## Erasing a student

The audit log holds nothing to erase: no name, date of birth or typed text. What an erasure
request reaches is elsewhere:

- **The student's record.** Deleting a student (their page) erases a record with no grading
  history. Once they have been in a grading the record is kept, name and date of birth
  included, so their past gradings still show who it was (owner, 2026-11-07); a request for a
  student with history is therefore not met by deleting them.
- **What was typed about them** on their gradings (comments, reasons and notes) is kept with
  that history.
- **Backups** taken before the erasure must be expired or replaced under your own retention
  rules, and **printed and downloaded files** are the school's (above).
- How long audit events are kept is not decided yet; see the [roadmap](roadmap.md).
