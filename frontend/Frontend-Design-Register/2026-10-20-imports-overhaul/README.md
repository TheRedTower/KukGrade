# Imports overhaul - proposed directions (2026-10-20)

Status: **in progress, screen by screen.** Selected so far: 1D, 2D, 3D, 4D and 5C. Each screen is proposed as
competing directions, one is selected, and the selection is recorded in
`../FRONTEND_DESIGN_REGISTER.md` before the next screen is designed.

The backend these screens sit on (stored rows, column mapping, suggested
students, the batch list) is described in
`docs/data-import-and-legacy-migration.md`.

## Contents

| Path | What it is |
| --- | --- |
| `boards/*.dc.html` | One artboard per direction. Interactive sources. |
| `boards/canvas.json` | Canvas index: layout and board titles. |

As with `../2026-09-23-assessment-overhaul/`, these are Design-canvas sources,
not standalone pages: they need the canvas runtime, so opening one directly
in a browser shows nothing. The markup, copy and seeded data are readable
as-is; the data is invented and the colour tokens are copied from
`frontend/src/theme.css`. Each board has a dark-mode tweak.

## Screen 1 - Imports hub

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 1A | Import Ledger (`Main.dc.html`) | In progress, finished and historical records as three stacked sections. | Never explains the two kinds of file. |
| 1B | Two Lanes | Students and Past gradings side by side, each with its own start, unfinished and recent imports; linking ends the Past gradings lane. | No single view of every import. |
| 1C | Start Here | Unfinished banner, three start tiles, then every import, filterable and paged. | The busiest of the three. |
| **1D** | **Combined** | **Selected 2026-10-20 (FDR-049, SCR-029).** 1A's unfinished list first, 1B's two plain start panels with linking at the foot of Past gradings, 1C's filterable, paged history. | - |

## Screen 2 - Choose file

Every board has a Students / Past gradings switch and a before / after
choosing a file switch, and its buttons work in Play.

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 2A | Guided Column | One narrow column under a five-step bar: drop area, then the file and a "What KukGrade found" checklist, with the sheet picker for a workbook. | Says nothing about what the file should hold until after it is read. |
| 2B | What KukGrade Looks For | The file on the left; on the right the fields KukGrade reads, which are needed, and the template. | Two columns to read; the guide stays on screen after it has done its job. |
| 2C | First Rows | After reading, the file's first rows as they are, sheet by sheet: "Is this the right file?" | Needs the backend to serve a file's first rows as read; the row list today serves them as checked. |
| **2D** | **Combined (A + B)** | **Selected 2026-10-20 (FDR-050, SCR-030).** Before a file is chosen, 2B: the drop area beside the "What KukGrade looks for" guide. After, 2A: one column with the file, the "What KukGrade found" checklist and the sheet picker, the guide folded into a "What KukGrade looks for" disclosure. | - |

## Screen 3 - Match columns (students) and ranks (past gradings)

Each board shows both: students match the file's columns to KukGrade's
fields; past gradings keep the workbook's fixed layout and match each rank
spelling instead. Suggestions are never applied without a visible choice.

| | Direction | Students | Past gradings |
| --- | --- | --- | --- |
| 3A | Your Columns | One row per column in the file, with sample values and what it holds (a field, extra information or leave out); "Not in your file" below sets rank or status for everyone. | One row per spelling with its record count and a rank, "Use" on each suggestion, "Use all suggestions". |
| 3B | KukGrade's Fields | One row per KukGrade field, choosing the column that holds it; "Columns left over" ticked to keep as extra information. | KukGrade's ranks in order, each with the spellings placed on it; suggestions dashed until accepted; spellings with no suggestion in a tray. |
| 3C | Live Preview | The file's first rows with a field chooser above each column, and how KukGrade reads each row as the choices change. | Pick a spelling to see the records that use it, then choose its rank. |

All three need each column's sample values, which the backend does not serve
yet. 3C also needs the first rows checked against a mapping before it is
saved, and the records behind one spelling.

**3D, selected 2026-10-20 (FDR-051, SCR-031)**, proposed after the owner chose 3C and asked to fill in what
is missing: 3C with every mapped cell typable. A fix shows "Your fix" with
the file's value and Undo. A needed field with no column offers "Type each
one in", which adds that column to fill row by row, and rank can also be one
value for everyone. A missing field no longer stops Continue; the rows wait
in Needs attention until filled. For past gradings the workbook's words are
kept as written, and what is added is what they mean.

## Screen 4 - Review rows (students) and records (past gradings)

Every row of the file, after matching. Students' rows can be fixed by typing
(as on screen 3) or left out; past gradings' records are shown exactly as
written and can only be left out.

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 4A | Exceptions First | Four counts that double as filters (ready, need attention, already in KukGrade, left out); opens on the rows that need attention, each with its fields to fix and "Leave this row out". | The rows that are fine are one click away, not in view. |
| 4B | Whole Sheet | Screen 3's table continued over the whole file, 50 rows a page, with filter tabs, search, typing into any cell and a Leave out tick per row. | Dense; the problems sit among the rows that are fine. |
| 4C | One at a Time | A queue of the rows to sort beside one row at a time, as a large form: fix, skip or leave out, then the next. Past gradings go sheet by sheet. | Slower for many small fixes; no overview of the fine rows. |

**4D, selected 2026-10-20 (FDR-052, SCR-032)**: 4A with "Look over all",
added at the owner's request so a person can give everything being imported
a last check: every row that will be saved, in file order, fixes marked,
each with Leave out.

4D was amended the same day: a row still needing attention must be fixed or
left out before Continue is available, with "Leave out the N left" for all
that remain (owner: only rows whose KukGrade fields are right are imported).

## Screen 5 - Confirm

Each board shows the import ready, saving and refused (someone changed
something since the check, so nothing was saved), and every one confirms
through the same two-sentence dialog (FDR-040).

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 5A | Receipt | One ledger of what the import does, line by line (new, skipped, left out, extra information, status, rank), each with a link back to its step. | Reads as a list of numbers. |
| 5B | Before and After | The file's rows on one side, what KukGrade holds afterwards on the other: a proportional bar and a group per outcome that opens to show who. | More to take in for a small import. |
| **5C** | **Seal on the Review Page** (selected 2026-10-20, FDR-053, SCR-033) | No separate page: once every row is sorted, an action banner on the review page carries the summary and the button, above the last-look list. | The review and the confirmation share one screen. |
