import { describe, expect, it } from "vitest";

import {
  DEFINITION_FILES,
  cssFiles,
  declarations,
  definedClasses,
  readCss,
  readSource,
  sourceFiles,
  usedClasses,
} from "./cssRules";

/**
 * Every colour, size and value a screen uses comes from theme.css or layout.css,
 * and every class a screen writes as a className literal is defined. These checks stop a screen from
 * growing its own, so a visual bug always has the same two places to look:
 * the token or shared piece, or the screen's use of it. There are no
 * exceptions: every count is zero, so a new one fails at once.
 */

const COLOUR_NAMES =
  /\b(?:white|black|red|green|blue|gold|orange|yellow|purple|pink|grey|gray|silver|brown|navy|teal)\b/;

const COUNTED: Record<string, (prop: string, value: string) => number> = {
  rawColour: (_prop, value) =>
    (value.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|%23[0-9a-fA-F]{3,6}/g)?.length ?? 0) +
    (COLOUR_NAMES.test(value.replace(/var\([^)]*\)/g, "")) ? 1 : 0),
  important: (_prop, value) => (/!important/.test(value) ? 1 : 0),
  varFallback: (_prop, value) => value.match(/var\(\s*--[\w-]+\s*,/g)?.length ?? 0,
  fontSize: (prop, value) =>
    prop === "font-size" && !/^(?:inherit|var\()/.test(value) && !/^[\d.]+em$/.test(value) ? 1 : 0,
  fontWeight: (prop, value) => (prop === "font-weight" && !/^(?:inherit|var\()/.test(value) ? 1 : 0),
  fontFamily: (prop, value) => (prop === "font-family" && !/^(?:inherit|var\()/.test(value) ? 1 : 0),
  radius: (prop, value) =>
    // A corner of 0 is square, not a size: only another number is hand-set.
    prop === "border-radius" && /\d/.test(value.replace(/var\([^)]*\)/g, "").replace(/\b0\b/g, "")) && value !== "50%"
      ? 1
      : 0,
  letterSpacing: (prop, value) => (prop === "letter-spacing" && !/^(?:0|normal|inherit|var\()/.test(value) ? 1 : 0),
  lineHeight: (prop, value) => (prop === "line-height" && !/^(?:0|1|normal|inherit|var\()/.test(value) ? 1 : 0),
  // A change takes the one duration, and names what changes: never `all`.
  transition: (prop, value) =>
    prop === "transition" && value !== "none" && (/\ball\b/.test(value) || /\b\d*\.?\d+m?s\b/.test(value)) ? 1 : 0,
  // Space between and inside boxes is a step of the scale; a hairline offset (0.2rem or less) or a clearance (over 3.25rem) is not a step.
  spacing: (prop, value) => {
    if (!/^(?:gap|row-gap|column-gap|margin|padding)(?:-[a-z]+)?$/.test(prop)) return 0;
    const lengths = value
      .replace(/(?:calc|clamp|min|max|var)\((?:[^()]|\([^()]*\))*\)/g, "")
      .matchAll(/(?<![\w.-])(\d*\.?\d+)(rem|px)\b/g);
    return [...lengths].some(([, n, unit]) => {
      const rem = unit === "px" ? Number(n) / 16 : Number(n);
      return rem > 0.2 && rem <= 3.25;
    })
      ? 1
      : 0;
  },
  shadow: (prop, value) => (prop === "box-shadow" && !/^(?:none|var\()/.test(value) ? 1 : 0),
  zIndex: (prop, value) => (prop === "z-index" && !/^(?:var\(|1$)/.test(value) ? 1 : 0),
  outlineNone: (prop, value) => (prop === "outline" && /^(?:none|0)\b/.test(value) ? 1 : 0),
};

const TYPE_FILES = ["layout.css", "controls.css"];

function countFile(file: string): Record<string, number> {
  const css = readCss(file);
  const counts: Record<string, number> = {};
  const decls = declarations(css);
  for (const [rule, count] of Object.entries(COUNTED)) {
    const total = decls
      // A token's own value is where a colour is meant to be written.
      .filter(({ prop }) => !prop.startsWith("--"))
      .reduce((sum, { prop, value }) => sum + count(prop, value), 0);
    if (total > 0) counts[rule] = total;
  }
  // A button is written once, in controls.css: a screen's own button class is a second one.
  const buttons =
    file === "controls.css"
      ? 0
      : [...definedClasses(css)].filter((name) => /(?:^|-)(?:btn|button)(?:-|$)/.test(name)).length;
  if (buttons > 0) counts.buttonClass = buttons;
  // Text takes a heading's size or a type role, both in layout.css: a screen's own size or weight is a second one.
  const ownType = TYPE_FILES.includes(file)
    ? 0
    : decls.filter(({ prop }) => prop === "font-size" || prop === "font-weight").length;
  if (ownType > 0) counts.ownType = ownType;
  const dark = (css.match(/\[data-theme=|prefers-color-scheme/g) ?? []).length;
  if (dark > 0) counts.darkOverride = dark;
  return counts;
}

const files = cssFiles().filter((name) => name !== "theme.css");
const sources = sourceFiles().filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"));

function unknownClasses(): string[] {
  const defined = new Set<string>();
  for (const file of cssFiles()) for (const name of definedClasses(readCss(file))) defined.add(name);
  const unknown = new Set<string>();
  for (const file of sources) {
    for (const name of usedClasses(readSource(file))) if (!defined.has(name)) unknown.add(name);
  }
  return [...unknown].sort();
}

describe("token rules", () => {
  it.each(files)("%s holds no raw values of its own", (file) => {
    expect(countFile(file)).toEqual({});
  });

  it("every class the code uses is defined by a stylesheet", () => {
    expect(unknownClasses()).toEqual([]);
  });

  it("every token a stylesheet uses is defined", () => {
    const defined = new Set<string>();
    for (const file of DEFINITION_FILES) {
      for (const { prop } of declarations(readCss(file))) if (prop.startsWith("--")) defined.add(prop);
    }
    // Set from a component for a rule that reads it.
    const setInline = new Set(["--theme-toggle-active-index"]);
    const missing: string[] = [];
    for (const file of cssFiles()) {
      for (const match of readCss(file).matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!defined.has(match[1]) && !setInline.has(match[1]) && !missing.includes(`${file}: ${match[1]}`)) {
          missing.push(`${file}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every token the theme and layout define is used somewhere", () => {
    const everything = [...cssFiles().map(readCss), ...sources.map(readSource)].join("\n");
    const unused: string[] = [];
    for (const file of DEFINITION_FILES) {
      for (const { prop } of declarations(readCss(file))) {
        if (
          prop.startsWith("--") &&
          !new RegExp(`var\\(\\s*${prop}(?![\\w-])`).test(everything) &&
          !unused.includes(prop)
        )
          unused.push(prop);
      }
    }
    expect(unused).toEqual([]);
  });

  it("only theme.css and layout.css define a custom property", () => {
    const stray: string[] = [];
    for (const file of cssFiles().filter((name) => !DEFINITION_FILES.includes(name))) {
      for (const { prop } of declarations(readCss(file))) if (prop.startsWith("--")) stray.push(`${file}: ${prop}`);
    }
    expect(stray).toEqual([]);
  });
});
