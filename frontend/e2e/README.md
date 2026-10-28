# Width check

Renders the screens listed in `e2e/widths.spec.ts` at phone, tablet and desktop widths in a real browser and fails
if anything does not fit (see `overflow.ts`). It runs against the demo image, which has
a made-up club, so every screen has data.

```sh
docker build --target production -t kukgrade:local .
docker run -d --name kg-widths -p 127.0.0.1:6943:6942 --shm-size 256m -e KUKGRADE_DEMO_MODE=1 \
  -e DJANGO_ALLOWED_HOSTS=localhost -e DJANGO_CSRF_TRUSTED_ORIGINS=https://localhost:6943 kukgrade:local
cd frontend
npx playwright install chromium      # once; or set KUKGRADE_E2E_CHANNEL=chrome
npm run test:widths                  # every width
KUKGRADE_E2E_QUICK=1 npm run test:widths
```

`widthDebt.json` lists screens that still do not fit. A screen on the list is expected to
fail and a screen off it must pass, so the list only shrinks: when you fix a screen, the
run tells you to remove it.
