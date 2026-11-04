import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SRC, cssFiles as allCssFiles, readCss } from "./cssRules";
import { BREAKPOINTS_REM } from "./layout";

/**
 * Width and layout numbers live in layout.css. These checks stop a screen from
 * growing its own, so a width problem always has the same two places to look:
 * layout.css, or the screen's use of it. A screen may query the window or its
 * page only at a breakpoint of layout.ts, and never with a width of its own.
 */

const QUERY = /@(?:media|container)[^{]*/g;
// A width condition, in either syntax; colour-scheme and reduced-motion queries are not layout.
const WIDTH_CONDITION = /(?:(?:min|max)-(?:width|inline-size)|(?:width|inline-size)\s*[<>]=?)/;

const BREAKPOINTS = new Set<number>(Object.values(BREAKPOINTS_REM));

/** A width query is on the scale when every length in it is a breakpoint in rem. */
function offScale(query: string): boolean {
  const lengths = [...query.matchAll(/(\d+(?:\.\d+)?)([a-z%]*)/g)];
  return lengths.some(([, value, unit]) => unit !== "rem" || !BREAKPOINTS.has(Number(value)));
}

const RULES: Record<string, RegExp> = {
  nowrap: /(?:white-space|text-wrap|text-wrap-mode):\s*nowrap/g,
  // overflow-x, and the shorthand when it makes a box scroll.
  overflowX: /overflow(?:-x|-inline)?:\s*(?:auto|scroll)/g,
  // A fixed minimum (not 0, not a keyword), outside a query's parentheses.
  fixedMinWidth: /(?<![-\w(])min-(?:width|inline-size):[ \t]*(?![ \t])(?!0(?:\.0+)?(?:px|rem|em|vw)?\s*[;}])[^;}]*\d[^;}]*/g,
};

function countViolations(css: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, pattern] of Object.entries(RULES)) {
    const found = css.match(pattern)?.length ?? 0;
    if (found > 0) counts[name] = found;
  }
  const widthQueries = (css.match(QUERY) ?? []).filter((query) => WIDTH_CONDITION.test(query) && offScale(query)).length;
  if (widthQueries > 0) counts.widthQueries = widthQueries;
  return counts;
}

const cssFiles = allCssFiles().filter((name) => name !== "layout.css");

describe("layout rules", () => {
  it("flags a width query of a screen's own, and passes a breakpoint", () => {
    expect(countViolations("@media (max-width: 600px) { a { top: 0 } }")).toEqual({ widthQueries: 1 });
    expect(countViolations("@container (min-width: 73rem) { a { top: 0 } }")).toEqual({ widthQueries: 1 });
    expect(countViolations("@media (max-width: 56rem) { a { top: 0 } }")).toEqual({});
    expect(countViolations("@media (prefers-color-scheme: dark) { a { top: 0 } }")).toEqual({});
  });

  it.each(cssFiles)("%s has no layout numbers of its own", (file) => {
    expect(countViolations(readCss(file))).toEqual({});
  });

  it("layout.css queries only at the breakpoints in layout.ts", () => {
    const css = readCss("layout.css");
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
