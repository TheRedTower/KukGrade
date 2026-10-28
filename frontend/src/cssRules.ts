import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What the style checks (layoutRules.test.ts, tokenRules.test.ts) share: one way
 * of reading the stylesheets and one way of counting what is in them, so the
 * numbers in the baselines mean the same thing everywhere.
 */

export const SRC = __dirname;

/** The two files that define the design: tokens, and layout (widths, gutters, shared pieces). */
export const DEFINITION_FILES = ["theme.css", "layout.css"];

export function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every stylesheet in src, sorted. */
export function cssFiles(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

export function readCss(file: string): string {
  return strip(readFileSync(join(SRC, file), "utf8"));
}

/** Every .ts/.tsx source file in src (tests included), sorted. */
export function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((name) => /\.tsx?$/.test(name))
    .sort();
}

export function readSource(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

export interface Declaration {
  prop: string;
  value: string;
}

/** The `property: value` pairs, wherever they sit (custom properties included). */
export function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of css.matchAll(/[{;]\s*(-{0,2}[\w-]+)\s*:\s*([^;{}]*)/g)) {
    found.push({ prop: match[1], value: match[2].trim() });
  }
  return found;
}

/** The class names a stylesheet defines or mentions in a selector. */
export function definedClasses(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) names.add(match[1]);
  return names;
}

/** The literal class names a source file puts in className="..." or className={`...`}. */
export function usedClasses(source: string): Set<string> {
  const names = new Set<string>();
  const add = (text: string) => {
    for (const token of text.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      // A fragment of a name built at run time (gsd-status-${x}) ends in a dash.
      if (/^[a-zA-Z_][\w-]*[\w]$/.test(token) && !token.endsWith("-")) names.add(token);
    }
  };
  for (const match of source.matchAll(/className="([^"]*)"/g)) add(match[1]);
  for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) add(match[1]);
  // The extra classes given to buttonClass as its second argument.
  for (const match of source.matchAll(/buttonClass\(\{[^}]*\},\s*"([^"]*)"\)/g)) add(match[1]);
  return names;
}
