# Link historical records - proposed directions (2026-10-24)

Status: **selected 2026-10-24**: 8A. Design complete; not yet built.

This redoes screen 7 of `../2026-10-20-imports-overhaul/` (7B, FDR-055),
which the owner found clunky in use: finding the right student, too many
one-at-a-time steps, linking crowded with rank matching and Void, and no
clear progress. Scope is the linking page at `/imports/records` only. The
results-page panel and the Historical records browser (`/imports/history`)
keep their behaviour and only follow shared pieces.

| Path | What it is |
| --- | --- |
| `boards/*.dc.html` | One artboard per direction. Interactive sources. |
| `boards/canvas.json` | Canvas index: layout and board titles. |

These are Design-canvas sources, not standalone pages. The data is invented
and the colour tokens are copied from `frontend/src/theme.css`. Each board
has a dark-mode tweak and draws the page content only, without the sidebar.

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| **8A** | **Review Table** | **Selected 2026-10-24 (FDR-059, SCR-039).** Every name a row with filter chips and counts, a progress bar, "Select the N clear suggestions" and one "Link N names" action; a row opens to its records and a student search. | Dense; needs the server to filter and page names. |
| 8B | Focus and Finder | 7B kept, with a grouped queue with search and tabs, per-record "Fix or void", an always-visible student finder of rich cards, and "also link" for another spelling of the same person. | Still one name at a time. |
| 8C | Name to Student | Names, records and students as three columns; students pre-sorted and pre-filtered for the focused name; fixing and Void in their own panel. | Three columns are wide; no bulk action. |

## What 8A needs from the backend (built 2026-10-24)

All declared in the schema and generated into the frontend's types.

1. `GET gradings/legacy-records/people/` gained `search`, `suggestion`
   (`clear`, `choose`, `none`), `group_keys` and `exclude_group_keys`, and each
   name now carries `suggestion` and `linked_student_name`.
2. `GET gradings/legacy-records/people-summary/` returns the counts for the
   chips and the progress bar.
3. "Left for now" is held in the browser (owner, 2026-10-24), sent to the
   server as `group_keys` / `exclude_group_keys` so lists and counts stay right.
4. Dropped: "records already linked" on a student result. The students list
   does not serve it and linking does not need it.
5. Needed no backend change: the "Linked" chip (`people?linked=true`) and
   linking several names in one request (`bulk-link` already takes
   record/student pairs, all or nothing, a refusal keyed by record).
