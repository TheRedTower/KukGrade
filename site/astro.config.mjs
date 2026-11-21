// The project page: plain HTML and CSS, no client JavaScript. Stylesheets are
// files, never inline, so the Content-Security-Policy in public/_headers can
// allow only the site's own styles.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://kukgrade.co.uk",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "never", format: "file" },
  devToolbar: { enabled: false },
  compressHTML: true,
});
