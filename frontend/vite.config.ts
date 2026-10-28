import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    environment: "jsdom",
    globals: true,
    // The width check is Playwright's (npm run test:widths), not Vitest's.
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
