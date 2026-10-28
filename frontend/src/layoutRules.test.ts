import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BREAKPOINTS_REM } from "./layout";

/**
 * Width and layout numbers live in layout.css. These checks stop a screen from
 * growing its own, so a width problem always has the same two places to look:
 * layout.css, or the screen's use of it. layoutBaseline.json lists the legacy
 * uses still to be converted; it only ever shrinks, and a file that is not in
 * it may have none. After converting a screen, lower the list with
 *   UPDATE_LAYOUT_BASELINE=1 npx vitest run src/layoutRules.test.ts
 */

const SRC = __dirname;
const BASELINE = join(SRC, "layoutBaseline.json");

const RULES: Record<string, RegExp> = {
  // Width-based queries, in either syntax; colour-scheme and reduced-motion
  // queries are not layout.
  widthQueries:
    /@(?:media|container)[^{]*(?:(?:min|max)-(?:width|inline-size)|(?:width|inline-size)\s*[<>]=?)/g,
  nowrap: /(?:white-space|text-wrap|text-wrap-mode):\s*nowrap/g,
  // overflow-x, and the shorthand when it makes a box scroll.
  overflowX: /overflow(?:-x|-inline)?:\s*(?:auto|scroll)/g,
  // A fixed minimum (not 0, not a keyword), outside a query's parentheses.
  fixedMinWidth: /(?<![-\w(])min-(?:width|inline-size):[ \t]*(?![ \t])(?!0(?:\.0+)?(?:px|rem|em|vw)?\s*[;}])[^;}]*\d[^;}]*/g,
};

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function countViolations(css: string): Record<string, number> {
  const text = strip(css);
  const counts: Record<string, number> = {};
  for (const [name, pattern] of Object.entries(RULES)) {
    const found = text.match(pattern)?.length ?? 0;
    if (found > 0) counts[name] = found;
  }
  return counts;
}

const cssFiles = readdirSync(SRC)
  .filter((name) => name.endsWith(".css") && name !== "layout.css")
  .sort();

let baseline: Record<string, Record<string, number>> = JSON.parse(readFileSync(BASELINE, "utf8"));

// The list can only be lowered here: a count that went up, or a file that was
// not on it, is a layout number a screen must not add.
if (process.env.UPDATE_LAYOUT_BASELINE) {
  const fresh: Record<string, Record<string, number>> = {};
  for (const file of cssFiles) {
    const counts = countViolations(readFileSync(join(SRC, file), "utf8"));
    for (const [rule, count] of Object.entries(counts)) {
      if (count > (baseline[file]?.[rule] ?? 0)) {
        throw new Error(`${file} adds ${rule}: ${count}, up from ${baseline[file]?.[rule] ?? 0}. Remove it instead.`);
      }
    }
    if (Object.keys(counts).length > 0) fresh[file] = counts;
  }
  writeFileSync(BASELINE, `${JSON.stringify(fresh, null, 2)}\n`);
  baseline = fresh;
}

describe("layout rules", () => {
  it.each(cssFiles)("%s adds no layout numbers beyond its baseline", (file) => {
    const actual = countViolations(readFileSync(join(SRC, file), "utf8"));
    const allowed = baseline[file] ?? {};
    expect(actual).toEqual(allowed);
  });

  it("lists only files that still exist", () => {
    for (const file of Object.keys(baseline)) {
      expect(cssFiles).toContain(file);
    }
  });

  it("layout.css queries only at the breakpoints in layout.ts", () => {
    const css = strip(readFileSync(join(SRC, "layout.css"), "utf8"));
    const allowed = new Set<number>(Object.values(BREAKPOINTS_REM));
    const queries = css.match(/@(?:media|container)[^{]*/g) ?? [];
    for (const query of queries) {
      expect(query).not.toMatch(/\d(?:px|em|vw)/);
      for (const [, value] of query.matchAll(/(\d+(?:\.\d+)?)rem/g)) {
        expect(allowed.has(Number(value))).toBe(true);
      }
    }
  });

  it("the sidebar collapses at the breakpoint the hook uses", () => {
    const wide = BREAKPOINTS_REM.wide;
    for (const file of ["NavigationRail.css", "App.css"]) {
      expect(readFileSync(join(SRC, file), "utf8")).toContain(`@media (max-width: ${wide}rem)`);
    }
  });
});
