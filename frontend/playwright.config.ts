import { defineConfig, devices } from "@playwright/test";

/**
 * The width check runs against a real server with the demo's made-up club (the
 * same image the demo site runs), never against jsdom, which cannot lay out
 * CSS. See e2e/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.KUKGRADE_E2E_URL ?? "https://localhost:6943",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      // Locally the installed Chrome is enough: KUKGRADE_E2E_CHANNEL=chrome.
      use: { channel: process.env.KUKGRADE_E2E_CHANNEL || undefined },
    },
    // Safari's engine, with the touch and mobile behaviour of an iPhone and an
    // iPad: native date inputs, menus and flex/grid differ from Chrome's.
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
    { name: "webkit-ipad", use: { ...devices["iPad (gen 7)"] } },
  ],
});
