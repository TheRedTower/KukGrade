# Settings, About and the app shell - proposed directions (2026-10-21)

Status: **screens 1 to 3 selected 2026-10-21**: 1G, 2C and 3D. Designs complete.
Each screen is proposed as competing directions, one is selected, and the
selection is recorded in `../FRONTEND_DESIGN_REGISTER.md` before the next
screen is designed.

| Path | What it is |
| --- | --- |
| `boards/*.dc.html` | One artboard per direction. Interactive sources. |
| `boards/canvas.json` | Canvas index: layout and board titles. |

As with `../2026-10-20-imports-overhaul/`, these are Design-canvas sources,
not standalone pages: they need the canvas runtime, so opening one directly
in a browser shows nothing. The data is invented and the colour tokens are
copied from `frontend/src/theme.css`. Each board has a dark-mode tweak. The
boards draw the brand as a gold "K" square and a text wordmark; the built
shell uses the FDR-048 artwork in their place.

## Screen 1 - Sidebar and shell

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 1A | Footer Dock (`Main.dc.html`) | Settings last in the nav; the rail foot a dock of mark, version (to About) and GitHub; the account stays in the top bar. | Settings among the work links. |
| 1B | Account at the Foot | The account at the rail foot opens a menu upward: Settings, About, GitHub, appearance, sign out; the top bar is the page title. | Settings a click further. |
| 1C | Settings Apart | Nav grouped Club / Administration; Settings, About (version) and GitHub pinned at the bottom. | A taller rail. |
| 1D | Utility Bar | A row of icon buttons at the foot: Settings, appearance, About, GitHub, with the version under it. | Icon-only buttons lean on tooltips. |
| 1E | Icon Rail, Opens Out | Collapses to a 72px icon strip; Settings, About and GitHub pinned to the bottom. | New behaviour to remember. |
| 1F | Club Card, No Top Bar | No top bar: a "Your club" card with club time in the rail, the person's card with Settings and Sign out at the foot, a version/About/GitHub line. | The largest restructure. |
| **1G** | **Club Card Rail (E + F)** | **Selected 2026-10-21 (FDR-056, SCR-036).** 1F's rail, club card and person's card, collapsing to 1E's icon rail. | - |

The owner asked for new directions after 1A-1C ("try again"), then chose a
mix of 1E and 1F.

## Screen 2 - Settings

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 2A | Section List | Settings' own list of sections down the left (You, Club, KukGrade), one section at a time. | A second column of navigation beside the sidebar. |
| 2B | One Page, Index Beside | Every section a card on one long page, with an "On this page" index. | A long page; club settings among personal ones. |
| **2C** | **Tabs and Rows** | **Selected 2026-10-21 (FDR-057, SCR-037).** Tabs (Account, Appearance, Club, About); each setting a row with its name and a line on the left and its control on the right. The owner asked for the read-only rules card on Club to go (the password rule is already on Account). | - |

## Screen 3 - About

| | Direction | Idea | Cost |
| --- | --- | --- | --- |
| 3A | Rows | The same row style as the other tabs: version, build, updates, licence, source, system. | No brand moment. |
| 3B | Hero Plate | A centred brand card with the version pill, two link buttons and a compact detail strip. | Shows less detail. |
| 3C | Support Sheet | Links beside a "Version details" card with Copy details, then Updates and Licence. | The busiest. |
| **3D** | **Hero and Support Sheet (B + C)** | **Selected 2026-10-21 (FDR-058, SCR-038).** 3B's brand card on top, 3C's two columns below. | - |

The boards show a build date and commit as examples; both come from the
build. The licence is shown as "To be decided" until the owner chooses one.

The Club tab on 2C was dropped in the end (owner, 2026-10-21): the time zone and
club name are container variables, not edited in the app.
