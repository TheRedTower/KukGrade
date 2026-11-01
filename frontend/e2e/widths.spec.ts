import { type APIRequestContext, type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

import debt from "./widthDebt.json" with { type: "json" };
import webkitDebt from "./widthDebtWebkit.json" with { type: "json" };
import { findOverflow } from "./overflow";
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
  /** The name used in the width debt lists. */
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
      await page.getByRole("button", { name: /^Add all \d+$/ }).first().click();
      await page.getByRole("button", { name: /^Review exceptions/ }).click();
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
      await page.getByRole("button", { name: /^View .* event$/ }).first().click();
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
const known = new Set(SCREENS.map((screen) => screen.name));
const authoritative = Boolean(process.env.CI);
const contexts = new Map<Role, BrowserContext>();
let ids: Ids;

async function signIn(browser: Browser, role: Role): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${role}`, "i") }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.close();
  return context;
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

test("the debt lists name only screens that exist", () => {
  const testInfo = test.info();
  const webkitProjects = testInfo.config.projects.map((project) => project.name).filter((name) => name.startsWith("webkit"));
  expect(Object.keys(webkitDebt).sort()).toEqual(webkitProjects.sort());
  expect(Object.keys(WEBKIT_WIDTHS).sort()).toEqual(webkitProjects.sort());
  expect([...debt, ...Object.values(webkitDebt).flat()].filter((name) => !known.has(name))).toEqual([]);
});

test("the edit-student dialog can be scrolled to Save on a short landscape screen", async () => {
  const page = await contexts.get("administrator")!.newPage();
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto(`/students/${ids.student}`);
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

for (const screen of SCREENS) {
  test(screen.name, async ({ browserName }, testInfo) => {
    const webkit = browserName === "webkit";
    const widths = webkit ? WEBKIT_WIDTHS[testInfo.project.name] : quick ? QUICK_WIDTHS : ALL_WIDTHS;
    // WebKit checks the same few widths in every run, so only Chrome's quick run is partial.
    const partial = quick && !webkit;
    const debtFile = webkit ? `widthDebtWebkit.json (${testInfo.project.name})` : "widthDebt.json";
    const owedHere = ((webkit ? webkitDebt[testInfo.project.name as keyof typeof webkitDebt] : debt) as string[]).includes(screen.name);
    // A screen on the debt list is expected not to fit yet. Where the run is
    // authoritative (CI, all widths) Playwright reports a pass of an expected
    // failure as a failure: remove the screen from widthDebt.json. Fonts differ
    // from machine to machine, so a local run only notes what it finds, and the
    // quick run checks too few widths to tell.
    test.skip(partial && owedHere, "owed: only the full run checks it");
    test.fail(owedHere && authoritative && !partial, `still owed: listed in ${debtFile}`);
    const page = await contexts.get(screen.role)!.newPage();
    const problems: string[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      const path = screen.path(ids);
      await page.goto(path);
      await page.getByRole("heading").first().waitFor();
      // A redirect or a not-found page would fit and prove nothing.
      expect(new URL(page.url()).pathname, "the screen was not shown").toBe(path.split("?")[0]);
      await page.waitForLoadState("networkidle");
      await screen.after?.(page);
      for (const issue of await findOverflow(page, width)) problems.push(`${width}px  ${issue}`);
    }
    await page.close();
    if (owedHere && !authoritative) {
      if (process.env.KUKGRADE_E2E_REPORT && problems.length) console.log(`${screen.name}:\n  ${problems.join("\n  ")}`);
      test.info().annotations.push({
        type: "owed",
        description: problems.length ? "does not fit yet" : `fits here: remove it from ${debtFile} once CI agrees`,
      });
      return;
    }
    expect(problems, `${screen.name} does not fit:\n  ${problems.join("\n  ")}`).toEqual([]);
  });
}
