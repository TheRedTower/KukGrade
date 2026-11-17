# Width check

Renders the screens listed in `e2e/widths.spec.ts` at phone, tablet and desktop widths in a real browser and fails
if anything does not fit (see `overflow.ts`). It runs against the demo image, which has
a made-up club, so every screen has data. The demo refuses file uploads, so the import
steps that need an uploaded file (matching columns, reviewing rows) are not covered here;
they are covered by the unit tests, and a real-device look is still needed for them.

```sh
docker build --target production --build-arg KUKGRADE_BUILD_COMMIT="$(git rev-parse HEAD)" -t kukgrade:local .
docker run -d --name kg-widths -p 127.0.0.1:6943:6942 --shm-size 256m -e KUKGRADE_DEMO_MODE=1 \
  -e DJANGO_ALLOWED_HOSTS=localhost -e DJANGO_CSRF_TRUSTED_ORIGINS=https://localhost:6943 kukgrade:local
cd frontend
npx playwright install chromium webkit   # once (with KUKGRADE_E2E_CHANNEL=chrome, chromium is not needed)
npm run test:widths                  # every width
KUKGRADE_E2E_QUICK=1 npm run test:widths
```

Every screen must fit: there is no list for parking one that does not. CI is
authoritative, since fonts differ between machines.

## WebKit (iPhone and iPad)

Three projects run the same screens: `chromium` (the nine widths), `webkit-iphone` (320, 390, 430) and
`webkit-ipad` (768, 820, 1024). WebKit is Safari's engine, so it catches layout that only Safari gets wrong.
Run one with `npx playwright test --project=webkit-iphone`.

A screen is checked once it shows what it loads: its heading, no loading line, every `/api/` answer in full,
and its fonts. The check does not wait for every picture and script to arrive. WebKit on Linux (CI) now and
then loses a request outright, the page's own address included, though the server answers in a tenth of a
second, so an address with no answer in 15 seconds is opened once more and the log says
`no answer in 15 seconds, opened again`. A wait that runs out names the answers the screen is still waiting for.

Besides overflow, `overflow.ts` flags a date input wider than its box and two cards stacked with no gap, and
the `grading-*-actions` screens open the Session actions menu so a menu running off the screen is caught.

What fits can still look broken, so `findLayoutFaults` in `overflow.ts` also flags, on every screen at every width:
a word split between two letters (a break at a hyphen, slash or dash is allowed, and so is a run wider than most
of the screen, such as a long web address), a table column whose rows do not start at one edge, a link or
button left in the browser's own colours, and a box that scrolls up and down inside the page (the page is the
one scroller; the sidebar beside it and a dialog over it are the exceptions), a row of `.tiles` that ends in a hole or an even set whose rows differ, and a `gap` on a box that is neither grid nor flex (its layout was lost). `layoutFaults.spec.ts` plants one of each, so a check that stops
finding anything fails there.

Three more checks need the page to move. `findCoveredBars` scrolls each screen from top to bottom and flags anything
drawn over a bar kept at the foot of the window (a row's buttons showing through the bar). `findChoicesLostOnHover`
puts the pointer on one of each kind of chosen control (a pressed button, a mark or outcome with a tone, the current
page's link, a ticked choice) and flags one whose text colour, fill or border changes: the pointer is still on a
button that was just pressed, so the choice just made would not show until the pointer moved away. `findBrowserDrawnControls` flags a radio, tick or progress bar left in the browser's own blue, and gives the keyboard
to one of each kind of text box to flag one that shows the browser's focus ring instead of the theme's; nothing is
typed. These two run once for each browser, at its widest. All three have a planted fault in `layoutFaults.spec.ts`.
The `assessment` screen is a candidate being marked, with a Met and a Not met already made; `assessment-comment-box`
is that page with a comment box opened on a row, `assessment-withdrawn` the same page with every mark closed, and
`student-status-dialog` the dialog whose choices are radios. One more test holds the two bars pinned to a phone's
window to what is needed there: the decision board's bar is its one row of buttons (how recording works is said in the
page), and the mat bar drops the count its button already gives.

What it cannot reproduce: Safari's address bar, the on-screen keyboard, safe areas, real touch scrolling, or
iOS's own date control (Linux and Mac WebKit draw dates differently). Real-device checks stay in the release
checklist. CI's fonts differ from a Mac's, so a result can differ there.
