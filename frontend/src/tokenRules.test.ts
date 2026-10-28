import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFINITION_FILES,
  SRC,
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
 * the token or shared piece, or the screen's use of it.
 *
 * tokenBaseline.json counts what the stylesheets still hold (it only ever
 * shrinks, and a file not in it may have none); classBaseline.json lists the
 * class names in the code that no stylesheet defines (it only ever shrinks).
 * After converting a screen, lower them with
 *   UPDATE_TOKEN_BASELINE=1 npx vitest run src/tokenRules.test.ts
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
    prop === "border-radius" && /\d/.test(value.replace(/var\([^)]*\)/g, "")) && value !== "50%" ? 1 : 0,
  shadow: (prop, value) => (prop === "box-shadow" && !/^(?:none|var\()/.test(value) ? 1 : 0),
  zIndex: (prop, value) => (prop === "z-index" && !/^(?:var\(|1$)/.test(value) ? 1 : 0),
  outlineNone: (prop, value) => (prop === "outline" && /^(?:none|0)\b/.test(value) ? 1 : 0),
};

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
  const buttons = file === "controls.css" ? 0 : [...definedClasses(css)].filter((name) => /(?:^|-)(?:btn|button)(?:-|$)/.test(name)).length;
  if (buttons > 0) counts.buttonClass = buttons;
  const dark = (css.match(/\[data-theme=|prefers-color-scheme/g) ?? []).length;
  if (dark > 0) counts.darkOverride = dark;
  return counts;
}

const BASELINE_FILE = join(SRC, "tokenBaseline.json");
const CLASS_BASELINE_FILE = join(SRC, "classBaseline.json");

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

let baseline: Record<string, Record<string, number>> = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
let classBaseline: string[] = JSON.parse(readFileSync(CLASS_BASELINE_FILE, "utf8"));

// The lists can only be lowered here: a count that went up, a file that was not
// on them or a new undefined class is something a screen must not add.
if (process.env.UPDATE_TOKEN_BASELINE) {
  const fresh: Record<string, Record<string, number>> = {};
  for (const file of files) {
    const counts = countFile(file);
    for (const [rule, count] of Object.entries(counts)) {
      if (count > (baseline[file]?.[rule] ?? 0)) {
        throw new Error(`${file} adds ${rule}: ${count}, up from ${baseline[file]?.[rule] ?? 0}. Remove it instead.`);
      }
    }
    if (Object.keys(counts).length > 0) fresh[file] = counts;
  }
  const unknown = unknownClasses();
  const added = unknown.filter((name) => !classBaseline.includes(name));
  if (added.length > 0) throw new Error(`Classes with no style: ${added.join(", ")}. Define or remove them.`);
  writeFileSync(BASELINE_FILE, `${JSON.stringify(fresh, null, 2)}\n`);
  writeFileSync(CLASS_BASELINE_FILE, `${JSON.stringify(unknown, null, 2)}\n`);
  baseline = fresh;
  classBaseline = unknown;
}

describe("token rules", () => {
  it.each(files)("%s holds no more raw values than its baseline", (file) => {
    expect(countFile(file)).toEqual(baseline[file] ?? {});
  });

  it("lists only files that still exist", () => {
    for (const file of Object.keys(baseline)) expect(files).toContain(file);
  });

  it("every class the code uses is defined by a stylesheet, apart from the listed legacy ones", () => {
    expect(unknownClasses()).toEqual(classBaseline);
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
        if (prop.startsWith("--") && !new RegExp(`var\\(\\s*${prop}(?![\\w-])`).test(everything) && !unused.includes(prop)) unused.push(prop);
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
