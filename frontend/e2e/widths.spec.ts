import { mkdir, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  expect,
  test,
} from "@playwright/test";

import { findLayoutFaults, findOverflow, findSmallTargets } from "./overflow";
import { ALL_WIDTHS, QUICK_WIDTHS, WEBKIT_WIDTHS } from "./widths";

type Role = "master" | "administrator";

interface Ids {
  batch: string;
  student: string;
  user: string;
  sessions: Record<string, string>;
  candidate: string;
  completedCandidate: string;
}

interface Screen {
  /** The test's name. */
  name: string;
  role: Role;
  path: (ids: Ids) => string;
  /** What to do on the screen before it is checked, such as opening a dialog. */
  after?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { name: "dashboard", role: "master", path: () => "/" },
  { name: "students", role: "administrator", path: () => "/students" },
  { name: "student-new", role: "administrator", path: () => "/students/new" },
  // A record that is not there: the shared not-found page (RecordPage).
  { name: "student-missing", role: "administrator", path: () => "/students/999999" },
  { name: "student-detail", role: "administrator", path: (ids) => `/students/${ids.student}` },
  {
    name: "student-edit-dialog",
    role: "administrator",
    path: (ids) => `/students/${ids.student}`,
    after: async (page) => {
      await page.getByRole("button", { name: "Edit student", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "gradings", role: "master", path: () => "/gradings" },
  { name: "grading-new", role: "master", path: () => "/gradings/new" },
  { name: "grading-open", role: "master", path: (ids) => `/gradings/${ids.sessions.OPEN}` },
  {
    name: "grading-draft-actions",
    role: "master",
    path: (ids) => `/gradings/${ids.sessions.DRAFT}`,
    after: async (page) => {
      await page.getByRole("button", { name: /^Session actions/ }).click();
      await page.getByRole("menu").waitFor();
    },
  },
  {
    name: "grading-locked-actions",
    role: "master",
    path: (ids) => `/gradings/${ids.sessions.LOCKED}`,
    after: async (page) => {
      await page.getByRole("button", { name: /^Session actions/ }).click();
      await page.getByRole("menu").waitFor();
    },
  },
  { name: "grading-register", role: "master", path: (ids) => `/gradings/${ids.sessions.DRAFT}/register` },
  {
    name: "grading-register-filled",
    role: "master",
    path: (ids) => `/gradings/${ids.sessions.DRAFT}/register`,
    after: async (page) => {
      await page
        .getByRole("button", { name: /^Add all \d+$/ })
        .first()
        .click();
      await page.getByRole("button", { name: /^Review candidates/ }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "grading-decisions", role: "master", path: (ids) => `/gradings/${ids.sessions.LOCKED}/decisions` },
  { name: "grading-promotions", role: "master", path: (ids) => `/gradings/${ids.sessions.COMPLETED}/promotions` },
  {
    name: "assessment",
    role: "master",
    path: (ids) => `/gradings/${ids.sessions.OPEN}/assessments/${ids.candidate}`,
  },
  { name: "syllabus", role: "master", path: () => "/syllabus" },
  { name: "audit", role: "master", path: () => "/audit" },
  {
    name: "audit-dialog",
    role: "master",
    path: () => "/audit",
    after: async (page) => {
      await page
        .getByRole("button", { name: /^View .* event$/ })
        .first()
        .click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "users", role: "administrator", path: () => "/users" },
  {
    name: "users-add-dialog",
    role: "administrator",
    path: () => "/users",
    after: async (page) => {
      await page.getByRole("button", { name: "Add user" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "user-reset-dialog",
    role: "administrator",
    path: (ids) => `/users/${ids.user}`,
    after: async (page) => {
      await page.getByRole("button", { name: "Reset password" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "user-detail", role: "administrator", path: (ids) => `/users/${ids.user}` },
  {
    name: "assessment-review",
    role: "master",
    path: (ids) => `/gradings/${ids.sessions.COMPLETED}/assessments/${ids.completedCandidate}/review`,
  },
  { name: "imports", role: "administrator", path: () => "/imports" },
  { name: "imports-new", role: "administrator", path: () => "/imports/new?kind=STUDENT_ROSTER" },
  { name: "imports-batch", role: "administrator", path: (ids) => `/imports/${ids.batch}` },
  { name: "imports-missing", role: "administrator", path: () => "/imports/999999" },
  { name: "imports-history", role: "administrator", path: () => "/imports/history" },
  { name: "imports-records", role: "administrator", path: () => "/imports/records" },
  { name: "settings-account", role: "master", path: () => "/settings/account" },
  { name: "settings-appearance", role: "master", path: () => "/settings/appearance" },
  { name: "settings-about", role: "master", path: () => "/settings/about" },
  { name: "settings-about-licence", role: "master", path: () => "/settings/about/licence" },
  { name: "settings-about-conduct", role: "master", path: () => "/settings/about/code-of-conduct" },
  { name: "settings-about-security", role: "master", path: () => "/settings/about/security" },
  { name: "settings-about-support", role: "master", path: () => "/settings/about/support" },
  { name: "settings-about-credits", role: "master", path: () => "/settings/about/credits" },
];

const quick = Boolean(process.env.KUKGRADE_E2E_QUICK);
const contexts = new Map<Role, BrowserContext>();
let ids: Ids;

async function signIn(browser: Browser, role: Role): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await show(page, "/login");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${role}`, "i") }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.close();
  return context;
}

/**
 * Opens a screen and returns once the server has answered its address, not
 * once every picture and font has arrived ("load"); what the screen shows is
 * waited for after (its heading, then `settled`). WebKit on Linux now and then
 * loses a request outright, the page's own address included, although the
 * server answers in a tenth of a second: an address with no answer in 15
 * seconds is opened once more, and the log says so.
 */
async function show(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: "commit", timeout: 15_000 });
  } catch {
    console.warn(`${path}: no answer in 15 seconds, opened again`);
    await page.goto(path, { waitUntil: "commit", timeout: 15_000 });
  }
}

/** The data requests (`/api/`) each page has sent and not yet had an answer to. */
const inFlight = new WeakMap<Page, Set<Request>>();

async function trackedPage(role: Role): Promise<Page> {
  const page = await contexts.get(role)!.newPage();
  const open = new Set<Request>();
  inFlight.set(page, open);
  const done = (request: Request) => open.delete(request);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) open.add(request);
  });
  // Answered once its whole body has arrived, not at its headers: WebKit
  // sometimes never reports a request as finished, though its answer is in.
  page.on("response", (response) => {
    const request = response.request();
    response.body().then(
      () => done(request),
      () => done(request),
    );
  });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return page;
}

/**
 * Waits until the screen shows what it loads: no loading line, every data
 * request answered (some screens fill in without a loading line), and the
 * same two frames later, since an answer can start the next request. Then its
 * fonts. Pictures, scripts and styles are not counted one by one: the heading
 * is already drawn, and the fonts are checked themselves. A wait that runs out
 * names what the screen is still waiting for.
 */
async function settled(page: Page): Promise<void> {
  const open = inFlight.get(page)!;
  const waitingFor = () => [...open].map((request) => new URL(request.url()).pathname + new URL(request.url()).search);
  const loading = page.locator(".loading-state");
  for (;;) {
    await expect(loading, "the screen still shows a loading line").toHaveCount(0);
    await expect
      .poll(waitingFor, { intervals: [10], message: "the screen is still waiting for these answers" })
      .toEqual([]);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (open.size === 0 && (await loading.count()) === 0) break;
  }
  await expect
    .poll(() => page.evaluate(() => document.fonts.status), { message: "the screen's fonts are still loading" })
    .toBe("loaded");
}

async function list(request: APIRequestContext, path: string): Promise<Record<string, unknown>[]> {
  const response = await request.get(path);
  expect(response.ok(), path).toBe(true);
  const body = await response.json();
  return Array.isArray(body) ? body : body.results;
}

test.beforeAll(async ({ browser }) => {
  contexts.set("master", await signIn(browser, "master"));
  contexts.set("administrator", await signIn(browser, "administrator"));
  const admin = contexts.get("administrator")!.request;
  const master = contexts.get("master")!.request;
  const me = await (await admin.get("/api/auth/me/")).json();
  const sessions: Record<string, string> = {};
  for (const session of await list(master, "/api/gradings/sessions/")) {
    sessions[String(session.status)] ??= String(session.id);
  }
  const open = sessions.OPEN;
  const candidates = await list(master, `/api/gradings/candidates/?session=${open}`);
  const completed = await list(master, `/api/gradings/candidates/?session=${sessions.COMPLETED}`);
  ids = {
    batch: String((await list(admin, "/api/data-imports/batches/"))[0].id),
    completedCandidate: String(completed[0].id),
    student: String((await list(admin, "/api/students/"))[0].id),
    // Not the signed-in administrator: their own page has no password reset.
    user: String((await list(admin, "/api/users/")).find((user) => user.id !== me.id)!.id),
    sessions,
    candidate: String(candidates[0].id),
  };
});

test("the edit-student dialog can be scrolled to Save on a short landscape screen", async () => {
  const page = await contexts.get("administrator")!.newPage();
  await page.setViewportSize({ width: 667, height: 320 });
  await show(page, `/students/${ids.student}`);
  await page.getByRole("button", { name: "Edit student", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const save = dialog.getByRole("button", { name: "Save changes" });
  await save.scrollIntoViewIfNeeded();
  const box = (await save.boundingBox())!;
  expect(box.y + box.height, "Save is on screen once scrolled to").toBeLessThanOrEqual(320);
  await save.click();
  await dialog.waitFor({ state: "detached" });
  await page.close();
});

test("an import step's Cancel and Continue stack on a phone and share a row with room", async () => {
  const page = await contexts.get("administrator")!.newPage();
  for (const [width, together] of [
    [390, false],
    [1400, true],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await show(page, "/imports/new?kind=STUDENT_ROSTER");
    const cancel = page.getByRole("button", { name: "Cancel import" });
    const next = page.getByRole("button", { name: /^Continue to match/ });
    await next.waitFor();
    const [c, n] = [(await cancel.boundingBox())!, (await next.boundingBox())!];
    expect(Math.abs(c.y - n.y) < 20, `${width}px: Cancel and Continue on one row`).toBe(together);
    if (!together) {
      expect(Math.abs(c.width - n.width), "stacked buttons are as wide as each other").toBeLessThan(2);
      expect(n.y, "the way on is above Cancel").toBeLessThan(c.y);
    }
  }
  await page.close();
});

/** How many decisions the Master has staged and kept in the locked session. One taken off is listed only for its revision. */
async function stagedCount(page: Page): Promise<number> {
  const rows = await list(page.request, `/api/gradings/outcomes/staged-decisions/?session=${ids.sessions.LOCKED}`);
  return rows.filter((row) => !row.discarded).length;
}

/**
 * One browser at a time through `work`. The three browsers run side by side as
 * the demo's one Master, who has one set of staged decisions: two of them
 * staging on the same row at once each undo the other's. Making a folder is
 * the lock, since only one process can make it; one left by a run that was
 * stopped is taken over once it is older than a test may last.
 */
async function oneBrowserAtATime(name: string, work: () => Promise<void>): Promise<void> {
  const lock = join(tmpdir(), `kukgrade-widths-${name}.lock`);
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch {
      const made = await stat(lock).then(
        (found) => found.mtimeMs,
        () => Date.now(),
      );
      if (Date.now() - made > 120_000) await rmdir(lock).catch(() => undefined);
      else await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  try {
    await work();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}

test("a tap anywhere on a decision card brings it into focus, and its buttons still answer for themselves", async () => {
  const page = await contexts.get("master")!.newPage();
  await oneBrowserAtATime("staged-decisions", () => tapAndStage(page));
  await page.close();
});

async function tapAndStage(page: Page): Promise<void> {
  // An iPad mini on its side (cards, the focus pane under them) and a desktop (table rows).
  for (const width of [1133, 1440]) {
    await page.setViewportSize({ width, height: 744 });
    await show(page, `/gradings/${ids.sessions.LOCKED}/decisions`);
    const rows = page.locator("[data-testid^=cab-row-]");
    await rows.nth(1).waitFor();
    const row = rows.nth(1);
    const name = row.locator(".cab-row-name");
    await expect(name).toHaveAttribute("aria-pressed", "false");

    // The evidence cell: neither the name nor a button. The tap lands on the
    // name's stretched target, which is the point.
    const evidence = (await row.locator("td").nth(1).boundingBox())!;
    await page.mouse.click(evidence.x + evidence.width / 2, evidence.y + evidence.height / 2);
    await expect(name, `${width}px`).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cab-detail").getByRole("heading", { level: 2 })).toHaveText(
      (await name.textContent())!,
    );

    // A decision button stages its decision rather than only selecting the row.
    const decidable = page.locator("tr[data-testid^=cab-row-]", { has: page.getByRole("group") }).last();
    const pass = decidable.getByRole("button", { name: /Pass$/ });
    await pass.click();
    await expect(pass).toHaveAttribute("aria-pressed", "true");
    await expect(decidable.locator(".cab-row-name")).toHaveAttribute("aria-pressed", "true");
    // Kept on the server, then dropped again once unstaged, leaving the demo
    // as it was for the other browsers.
    await expect.poll(() => stagedCount(page)).toBe(1);
    await pass.click();
    await expect(pass).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => stagedCount(page)).toBe(0);
  }
}

test("a record's back link returns to the page it was opened from, and to the page above otherwise", async () => {
  const page = await contexts.get("master")!.newPage();
  await page.setViewportSize({ width: 1133, height: 744 });
  const board = `/gradings/${ids.sessions.LOCKED}/decisions`;
  await show(page, board);
  const title = (await page.getByRole("heading", { level: 1 }).textContent())!;
  await page.evaluate(() => scrollTo(0, 300));
  await page.getByRole("link", { name: "Open the full assessment record" }).click();
  await page.waitForURL(/\/review$/);
  const back = page.locator(".back-link");
  await expect(back).toHaveText(title);

  // The browser's own Back: the board as it was left, with its own way back.
  await back.click();
  await page.waitForURL((url) => url.pathname === board);
  await expect(page.locator(".back-link")).not.toHaveText(title);
  await expect(page.locator(".back-link")).not.toHaveText(/record/i);

  // Opened directly, the record goes back to its scoring page, as before.
  await show(page, `/gradings/${ids.sessions.COMPLETED}/assessments/${ids.completedCandidate}/review`);
  await expect(page.locator(".back-link")).toHaveText("Back to scoring");
  await page.close();
});

for (const path of ["/", "/students", "/gradings"]) {
  test(`on a phone and a tablet the logo and the page start at one left edge: ${path}`, async () => {
    const page = await contexts.get("master")!.newPage();
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await show(page, path);
      await page.getByRole("heading", { level: 1 }).waitFor();
      const left = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((el) => el.getBoundingClientRect().left);
      const logo = await left(".nav-logo");
      expect(Math.abs(logo - (await left("h1"))), `logo against the title at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.close();
  });
}

for (const screen of SCREENS) {
  test(screen.name, async ({ browserName }, testInfo) => {
    const webkit = browserName === "webkit";
    const widths = webkit ? WEBKIT_WIDTHS[testInfo.project.name] : quick ? QUICK_WIDTHS : ALL_WIDTHS;
    // Touch targets are judged on the phone, at its own width.
    const phone = testInfo.project.name === "webkit-iphone";
    const page = await trackedPage(screen.role);
    const problems: string[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      const path = screen.path(ids);
      await show(page, path);
      await page.getByRole("heading").first().waitFor();
      // A redirect or a not-found page would fit and prove nothing.
      expect(new URL(page.url()).pathname, "the screen was not shown").toBe(path.split("?")[0]);
      await settled(page);
      await screen.after?.(page);
      for (const issue of await findOverflow(page, width)) problems.push(`${width}px  ${issue}`);
      for (const issue of await findLayoutFaults(page)) problems.push(`${width}px  ${issue}`);
      if (phone && width === 390) {
        for (const small of await findSmallTargets(page)) problems.push(`${width}px  under 44px: ${small}`);
      }
    }
    await page.close();
    expect(problems, `${screen.name} does not fit:\n  ${problems.join("\n  ")}`).toEqual([]);
  });
}
