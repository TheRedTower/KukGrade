# Width check

Renders the screens listed in `e2e/widths.spec.ts` at phone, tablet and desktop widths in a real browser and fails
if anything does not fit (see `overflow.ts`). It runs against the demo image, which has
a made-up club, so every screen has data. The demo refuses file uploads, so the import
steps that need an uploaded file (matching columns, reviewing rows) are not covered here;
they are covered by the unit tests, and a real-device look is still needed for them.

```sh
docker build --target production -t kukgrade:local .
docker run -d --name kg-widths -p 127.0.0.1:6943:6942 --shm-size 256m -e KUKGRADE_DEMO_MODE=1 \
  -e DJANGO_ALLOWED_HOSTS=localhost -e DJANGO_CSRF_TRUSTED_ORIGINS=https://localhost:6943 kukgrade:local
cd frontend
npx playwright install chromium webkit   # once (with KUKGRADE_E2E_CHANNEL=chrome, chromium is not needed)
npm run test:widths                  # every width
KUKGRADE_E2E_QUICK=1 npm run test:widths
```

`widthDebt.json` lists screens that still do not fit. CI is authoritative (fonts differ
between machines): there, a screen on the list is expected to fail and a screen off it must
pass, so the list only shrinks and the run tells you when to remove one. A local run only
notes what it finds for the screens on the list.

## WebKit (iPhone and iPad)

Three projects run the same screens: `chromium` (the nine widths), `webkit-iphone` (320, 390, 430) and
`webkit-ipad` (768, 820, 1024). WebKit is Safari's engine, so it catches layout that only Safari gets wrong.
Run one with `npx playwright test --project=webkit-iphone`. `widthDebtWebkit.json` is the debt list per WebKit
project, and works like `widthDebt.json`.

Besides overflow, `overflow.ts` flags a date input wider than its box and two cards stacked with no gap, and
the `grading-*-actions` screens open the Session actions menu so a menu running off the screen is caught.

What it cannot reproduce: Safari's address bar, the on-screen keyboard, safe areas, real touch scrolling, or
iOS's own date control (Linux and Mac WebKit draw dates differently). Real-device checks stay in the release
checklist. CI's fonts differ from a Mac's, so a result can differ there.
