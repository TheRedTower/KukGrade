import { defineConfig } from "@playwright/test";

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
    // Locally the installed Chrome is enough: KUKGRADE_E2E_CHANNEL=chrome.
    channel: process.env.KUKGRADE_E2E_CHANNEL || undefined,
  },
});
