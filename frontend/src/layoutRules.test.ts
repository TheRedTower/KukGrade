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
  fixedMinWidth:
    /(?<![-\w(])min-(?:width|inline-size):[ \t]*(?![ \t])(?!0(?:\.0+)?(?:px|rem|em|vw)?\s*[;}])[^;}]*\d[^;}]*/g,
};

function countViolations(css: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, pattern] of Object.entries(RULES)) {
    const found = css.match(pattern)?.length ?? 0;
    if (found > 0) counts[name] = found;
  }
  const widthQueries = (css.match(QUERY) ?? []).filter(
    (query) => WIDTH_CONDITION.test(query) && offScale(query),
  ).length;
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

/**
 * The page is the only thing that scrolls up and down (stickyParts.ts): a box
 * that scrolls inside a scrolling page traps a swipe at its end and hides what
 * is under it. The two exceptions sit over or beside the page, never in it.
 */
const OWN_SCROLLERS = new Set([
  "layout.css: .dialog", // over the page, which cannot scroll behind it
  "NavigationRail.css: .nav-rail", // the sidebar, beside the page
]);

const SCROLLS_DOWN = /(?:^|[;\s])overflow(?:-y|-block)?\s*:\s*(?:\S+\s+)?(?:auto|scroll)\b/;

/** Every rule that lets a box scroll up and down, as "file: selector". */
function verticalScrollers(file: string, css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => SCROLLS_DOWN.test(body))
    .map(([, selector]) => `${file}: ${selector.trim()}`);
}

describe("one scroller per page", () => {
  it("finds a box that scrolls up and down, and passes one that scrolls sideways", () => {
    expect(verticalScrollers("a.css", ".a { overflow-y: auto }")).toEqual(["a.css: .a"]);
    expect(verticalScrollers("a.css", "@media (x) { .b { color: red; overflow: auto; } }")).toEqual(["a.css: .b"]);
    expect(verticalScrollers("a.css", ".c { overflow: hidden scroll }")).toEqual(["a.css: .c"]);
    expect(verticalScrollers("a.css", ".d { overflow-x: auto } .e { overflow: clip }")).toEqual([]);
  });

  it("no stylesheet has a box that scrolls inside the page", () => {
    const found = allCssFiles().flatMap((file) => verticalScrollers(file, readCss(file)));
    expect(found.filter((rule) => !OWN_SCROLLERS.has(rule))).toEqual([]);
    expect(found.sort()).toEqual([...OWN_SCROLLERS].sort());
  });
});

/**
 * Cards, fields and facts that wrap onto more rows are `.tiles` (layout.css): the
 * tiles of a short last row share its width, where an auto-fit grid leaves a hole
 * beside them. The two grids left keep their columns on purpose.
 */
const OWN_GRIDS = new Set([
  "Imports.css: .ix-field-grid", // each imported row's fields line up with the next row's
  "GradingSessions.css: .gsd-lifecycle-track", // a session's steps, in order, one size each
]);

function autoFitGrids(file: string, css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /repeat\(\s*auto-(?:fit|fill)/.test(body))
    .map(([, selector]) => `${file}: ${selector.trim()}`);
}

describe("no row ends in a gap", () => {
  it("finds an auto-fit grid", () => {
    expect(autoFitGrids("a.css", ".a { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)) }")).toEqual([
      "a.css: .a",
    ]);
    expect(autoFitGrids("a.css", ".b { grid-template-columns: 1fr 1fr }")).toEqual([]);
  });

  it("cards and fields that wrap are tiles, not an auto-fit grid", () => {
    const found = allCssFiles().flatMap((file) => autoFitGrids(file, readCss(file)));
    expect(found.sort()).toEqual([...OWN_GRIDS].sort());
  });
});

/**
 * A bar kept at the foot of the window is drawn over the page that scrolls
 * under it, so it names its layer (`--z-bar`). Without one, anything on the
 * page with a layer of its own shows through the bar, as a decision row's
 * buttons once did. (A real browser checks what is drawn: e2e/overflow.ts.)
 */
function footBarsOffLayer(file: string, css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /position:\s*sticky/.test(body) && /(?:^|[;\s])bottom:\s*0\s*(?:;|$)/.test(body))
    .filter(([, , body]) => !/z-index:\s*var\(--z-bar\)/.test(body))
    .map(([, selector]) => `${file}: ${selector.trim()}`);
}

describe("a bar at the foot of the window", () => {
  it("finds a bar with no layer, and passes one on the bar layer", () => {
    expect(footBarsOffLayer("a.css", ".a { position: sticky; bottom: 0; }")).toEqual(["a.css: .a"]);
    expect(footBarsOffLayer("a.css", ".b { position: sticky; bottom: 0; z-index: var(--z-bar); }")).toEqual([]);
    expect(footBarsOffLayer("a.css", ".c { position: sticky; top: 0; } .d { bottom: 0; }")).toEqual([]);
  });

  it("is on the bar layer in every stylesheet", () => {
    expect(allCssFiles().flatMap((file) => footBarsOffLayer(file, readCss(file)))).toEqual([]);
  });

  // Every screen's bar is the one ActionBar, so they look and behave alike.
  it("is the shared action bar, never a screen's own", () => {
    const bars = allCssFiles().flatMap((file) =>
      [...readCss(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => /position:\s*sticky/.test(body) && /(?:^|[;\s])bottom:\s*0\s*(?:;|$)/.test(body))
        .map(([, selector]) => `${file}: ${selector.trim().split("\n").at(-1)}`),
    );
    expect(bars).toEqual(["layout.css: .action-bar"]);
  });
});

/**
 * A button that carries a tone (`data-tone`: a chosen mark, a chosen outcome)
 * keeps it under the pointer. A hover is written with two pseudo-classes, so
 * it outweighs the tone unless it leaves toned buttons alone; and the pointer
 * is still on a button that was just pressed, which hid the Met or Not met
 * just chosen until the pointer moved away.
 */
function hoversOverATone(file: string, css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => /\.btn[\w-]*[^,{]*:hover/.test(selector))
    .filter(([, , body]) => /(?:^|[;\s])(?:background|border-color|color)\s*:/.test(body))
    .filter(([, selector]) => !selector.includes("[data-tone]"))
    .map(([, selector]) => `${file}: ${selector.trim()}`);
}

describe("a tone outranks a hover", () => {
  it("finds a button hover that repaints a toned button, and passes one that leaves it alone", () => {
    expect(hoversOverATone("a.css", ".btn--x:hover:not(:disabled) { background: var(--a); }")).toEqual([
      "a.css: .btn--x:hover:not(:disabled)",
    ]);
    expect(hoversOverATone("a.css", ".btn--x:hover:not(:disabled, [data-tone]) { background: var(--a); }")).toEqual([]);
    expect(hoversOverATone("a.css", ".btn--y:hover { filter: brightness(1.1); }")).toEqual([]);
  });

  it("no button hover repaints a toned button", () => {
    expect(allCssFiles().flatMap((file) => hoversOverATone(file, readCss(file)))).toEqual([]);
  });
});

/**
 * No control is left in the browser's own blue. The root gives every radio,
 * tick and progress bar the theme's gold (`accent-color` is inherited), and one
 * rule gives every input, select and text box the theme's focus ring. A screen
 * that sets the same accent again has only repeated the root. (A real browser
 * checks what is drawn: e2e/overflow.ts.)
 */
function repeatsTheAccent(file: string, css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.trim() !== ":root")
    .filter(([, , body]) => /accent-color:\s*var\(--color-accent\)/.test(body))
    .map(([, selector]) => `${file}: ${selector.trim()}`);
}

describe("no control is left in the browser's own blue", () => {
  it("finds a screen that repeats the root's accent, and passes another tone", () => {
    expect(repeatsTheAccent("a.css", ".a input { accent-color: var(--color-accent); }")).toEqual(["a.css: .a input"]);
    expect(repeatsTheAccent("a.css", ".b { accent-color: var(--color-success); }")).toEqual([]);
    expect(repeatsTheAccent("a.css", ":root { accent-color: var(--color-accent); }")).toEqual([]);
  });

  it("the root sets the accent once, and no screen repeats it", () => {
    expect(readCss("App.css")).toMatch(/:root\s*\{[^}]*accent-color:\s*var\(--color-accent\)/);
    expect(allCssFiles().flatMap((file) => repeatsTheAccent(file, readCss(file)))).toEqual([]);
  });

  it("one rule gives every input, select and text box the theme's focus ring", () => {
    expect(readCss("layout.css")).toMatch(
      /:where\(input, select, textarea\):focus-visible\s*\{\s*outline:\s*var\(--focus-outline\);\s*outline-offset:\s*var\(--focus-offset\);\s*\}/,
    );
  });
});

/**
 * A hover style is only for a pointer that can hover. A touch screen leaves
 * `:hover` on whatever was tapped until the next touch, so a row or a button
 * stays shaded as though it were chosen; inside `@media (hover: hover)` a
 * finger never sets it. The one hover written outside is a selector paired
 * with itself at rest (`.x, .x:hover`), which says "the same under the
 * pointer" and paints nothing new.
 */
function hoversForAnyPointer(file: string, css: string): string[] {
  const found: string[] = [];
  const open: string[] = [];
  let from = 0;
  for (let at = 0; at < css.length; at++) {
    if (css[at] === "{") {
      const prelude = css.slice(from, at).trim();
      const selectors = prelude.split(/,(?![^()]*\))/).map((selector) => selector.trim());
      const hovers = selectors.filter((selector) => selector.includes(":hover"));
      const sameAtRest = hovers.every((selector) => selectors.includes(selector.replace(":hover", "")));
      if (hovers.length > 0 && !sameAtRest && !open.some((rule) => /^@media\s*\(hover:\s*hover\)$/.test(rule))) {
        found.push(`${file}: ${prelude.replace(/\s+/g, " ")}`);
      }
      open.push(prelude);
      from = at + 1;
    } else if (css[at] === "}") {
      open.pop();
      from = at + 1;
    } else if (css[at] === ";") {
      from = at + 1;
    }
  }
  return found;
}

describe("a hover style is only for a pointer that can hover", () => {
  it("finds a hover for any pointer, and passes one for a pointer that can hover", () => {
    expect(hoversForAnyPointer("a.css", ".a { color: red; } .a:hover { color: blue; }")).toEqual(["a.css: .a:hover"]);
    expect(hoversForAnyPointer("a.css", ".a:hover, .a:focus-visible { color: blue; }")).toEqual([
      "a.css: .a:hover, .a:focus-visible",
    ]);
    expect(hoversForAnyPointer("a.css", "@media (max-width: 40rem) { .a:hover { color: blue; } }")).toEqual([
      "a.css: .a:hover",
    ]);
    expect(hoversForAnyPointer("a.css", "@media (hover: hover) { .a:hover { color: blue; } }")).toEqual([]);
    expect(hoversForAnyPointer("a.css", ".a.active, .a.active:hover { color: gold; }")).toEqual([]);
  });

  it("no stylesheet has a hover for any pointer", () => {
    expect(allCssFiles().flatMap((file) => hoversForAnyPointer(file, readCss(file)))).toEqual([]);
  });
});
