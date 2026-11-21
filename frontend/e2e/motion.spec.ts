import { type Page, expect, test } from "@playwright/test";

/**
 * A change the person asks for eases from the old look to the new (smoothly.ts)
 * rather than jumping, and a person who asked for reduced motion gets it at once.
 * Counted where the browser starts each view transition, and checked to finish.
 */

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /Sign in as master/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Counts the view transitions the page starts from now on, and keeps the last. */
async function countTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const own = document.startViewTransition?.bind(document);
    if (!own) return;
    const counted = window as unknown as { transitions: number; lastTransition?: ViewTransition };
    counted.transitions = 0;
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      counted.transitions += 1;
      counted.lastTransition = own(update);
      return counted.lastTransition;
    }) as typeof document.startViewTransition;
  });
}

/** How many have started, once the last has finished. */
async function transitions(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const counted = window as unknown as { transitions: number; lastTransition?: ViewTransition };
    await counted.lastTransition?.finished;
    return counted.transitions;
  });
}

test.beforeEach(async ({ page }) => {
  // The sidebar is open beside the page only on a wide screen.
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto("/settings/appearance");
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await countTransitions(page);
});

test("the sidebar, the theme and the settings sections ease into their new look", async ({ page }) => {
  test.skip(
    !(await page.evaluate(() => typeof document.startViewTransition === "function")),
    "This browser has no view transitions: every change is made at once, as before.",
  );
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });

  await page.getByRole("group", { name: "Sidebar" }).getByRole("button", { name: "Icons only" }).click();
  expect(await transitions(page)).toBe(1);
  await expect(sidebar).toHaveClass(/\bstrip\b/);

  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  expect(await transitions(page)).toBe(2);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "About" }).click();
  expect(await transitions(page)).toBe(3);
  await page.getByRole("navigation", { name: "About sections" }).getByRole("link", { name: "Licence" }).click();
  expect(await transitions(page)).toBe(4);
  await expect(page.getByRole("heading", { name: "Licence", exact: true })).toBeVisible();

  // Back to the sidebar open, as it was.
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  expect(await transitions(page)).toBe(5);
  await expect(sidebar).not.toHaveClass(/\bstrip\b/);
});

test("a person who asked for reduced motion gets each change at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("group", { name: "Sidebar" }).getByRole("button", { name: "Icons only" }).click();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveClass(/\bstrip\b/);
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/settings\/about$/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).not.toHaveClass(/\bstrip\b/);
  expect(await page.evaluate(() => (window as unknown as { transitions?: number }).transitions ?? 0)).toBe(0);
});
