// Takes the project page's screenshots from a running KukGrade demo
// (KUKGRADE_DEMO_MODE=1), in light and dark, so the page always shows the app
// as it is. Made-up data only: never point this at a real school's install.
//
//   node scripts/shots.mjs https://localhost:6943
//
// Writes src/assets/shots/<name>-<theme>.png.
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "playwright";

const base = (process.argv[2] ?? "https://localhost:6943").replace(/\/$/, "");
const out = new URL("../src/assets/shots/", import.meta.url);

const laptop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { ...devices["iPhone 15"], defaultBrowserType: undefined };

/** Each screenshot: who signs in, where, at what size. */
const SHOTS = [
  { name: "overview", role: "master", size: laptop, path: () => "/" },
  { name: "session", role: "master", size: laptop, path: (ids) => `/gradings/${ids.open}` },
  { name: "decisions", role: "master", size: laptop, path: (ids) => `/gradings/${ids.locked}/decisions` },
  { name: "assessment", role: "instructor", size: phone, path: (ids) => `/gradings/${ids.open}/assessments/${ids.marking}` },
];

async function signIn(browser, role, size, theme) {
  const context = await browser.newContext({ ...size, ignoreHTTPSErrors: true, bypassCSP: true, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: new RegExp(`Sign in as ${role}`, "i") }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

async function list(page, path) {
  const answer = await (await page.request.get(`${base}${path}`)).json();
  return answer.results ?? answer;
}

async function findIds(browser) {
  const { context, page } = await signIn(browser, "master", laptop, "light");
  const sessions = await list(page, "/api/gradings/sessions/");
  const open = sessions.find((session) => session.status === "OPEN").id;
  const locked = sessions.find((session) => session.status === "LOCKED").id;
  const candidates = await list(page, `/api/gradings/candidates/?session=${open}`);
  const marking = candidates.find(
    ({ assessment }) => assessment?.marks_open && assessment.overall.met > 0 && assessment.overall.not_met > 0,
  ).id;
  await context.close();
  return { open, locked, marking };
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const ids = await findIds(browser);
for (const shot of SHOTS) {
  for (const theme of ["light", "dark"]) {
    const { context, page } = await signIn(browser, shot.role, shot.size, theme);
    await page.goto(`${base}${shot.path(ids)}`);
    await page.waitForLoadState("networkidle");
    // The demo's banner says it is a demo; the page says so in words instead.
    await page.addStyleTag({ content: "[class*='demo-banner']{display:none!important}" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: new URL(`${shot.name}-${theme}.png`, out).pathname });
    await context.close();
    console.log(`${shot.name}-${theme}.png`);
  }
}
await browser.close();
