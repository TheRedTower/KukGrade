import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };

// A candidate's build names itself as the server does (0.2.0-rc.4), by the same
// rule as BUILD_PRE_RELEASE in backend/kukgrade/settings.py.
const preRelease = process.env.KUKGRADE_BUILD_PRE_RELEASE?.trim() ?? "";
const version = /^[0-9A-Za-z.-]{1,20}$/.test(preRelease) ? `${packageJson.version}-${preRelease}` : packageJson.version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "jsdom",
    // Each file still gets its own context, but the jsdom set-up is not
    // rebuilt in a fresh worker per file: about a third faster.
    pool: "vmThreads",
    globals: true,
    // The width check is Playwright's (npm run test:widths), not Vitest's.
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
