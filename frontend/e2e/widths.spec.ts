import { type APIRequestContext, type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

import debt from "./widthDebt.json" with { type: "json" };
import { findOverflow } from "./overflow";
import { ALL_WIDTHS, QUICK_WIDTHS } from "./widths";

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
  /** The name used in widthDebt.json. */
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
  { name: "gradings", role: "master", path: () => "/gradings" },
  { name: "grading-new", role: "master", path: () => "/gradings/new" },
  { name: "grading-open", role: "master", path: (ids) => `/gradings/${ids.sessions.OPEN}` },
  { name: "grading-register", role: "master", path: (ids) => `/gradings/${ids.sessions.DRAFT}/register` },
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
const widths = quick ? QUICK_WIDTHS : ALL_WIDTHS;
const owed = new Set<string>(debt);
const authoritative = Boolean(process.env.CI);
const known = new Set(SCREENS.map((screen) => screen.name));
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
    user: String((await list(admin, "/api/users/"))[0].id),
    sessions,
    candidate: String(candidates[0].id),
  };
});

test("widthDebt.json names only screens that exist", () => {
  expect([...owed].filter((name) => !known.has(name))).toEqual([]);
});

for (const screen of SCREENS) {
  test(screen.name, async () => {
    // A screen on the debt list is expected not to fit yet. Where the run is
    // authoritative (CI, all widths) Playwright reports a pass of an expected
    // failure as a failure: remove the screen from widthDebt.json. Fonts differ
    // from machine to machine, so a local run only notes what it finds, and the
    // quick run checks too few widths to tell.
    const owedHere = owed.has(screen.name);
    test.skip(quick && owedHere, "owed: only the full run checks it");
    test.fail(owedHere && authoritative && !quick, "still owed: listed in widthDebt.json");
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
      for (const issue of await findOverflow(page)) problems.push(`${width}px  ${issue}`);
    }
    await page.close();
    if (owedHere && !authoritative) {
      test.info().annotations.push({
        type: "owed",
        description: problems.length ? "does not fit yet" : "fits here: remove it from widthDebt.json once CI agrees",
      });
      return;
    }
    expect(problems, `${screen.name} does not fit:\n  ${problems.join("\n  ")}`).toEqual([]);
  });
}
