// The project page: plain HTML and CSS, no client JavaScript. Stylesheets are
// files, never inline, so the Content-Security-Policy in public/_headers can
// allow only the site's own styles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

// The version is read here, where this file sits in the repository, and handed
// to the page as a constant. Read from the page itself, it depended on where
// the build ran, and broke in Cloudflare's build.
const versionFile = fileURLToPath(new URL("../backend/kukgrade/version.py", import.meta.url));
const version = /VERSION = "([^"]+)"/.exec(readFileSync(versionFile, "utf8"))?.[1];
if (!version) throw new Error("No VERSION in backend/kukgrade/version.py");

export default defineConfig({
  site: "https://kukgrade.co.uk",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "never", format: "file" },
  devToolbar: { enabled: false },
  compressHTML: true,
  vite: { define: { __KUKGRADE_VERSION__: JSON.stringify(version) } },
});
