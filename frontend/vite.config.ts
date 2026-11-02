import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    // A candidate's build names itself as the server does (0.2.0-rc.4).
    __APP_VERSION__: JSON.stringify(
      [packageJson.version, process.env.KUKGRADE_BUILD_PRE_RELEASE].filter(Boolean).join("-"),
    ),
  },
  test: {
    environment: "jsdom",
    globals: true,
    // The width check is Playwright's (npm run test:widths), not Vitest's.
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
