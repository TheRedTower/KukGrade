import { createContext, useContext, useEffect } from "react";
import { type Location, useLocation } from "react-router-dom";

/**
 * Where each page was opened from, so its back link returns there (owner,
 * 2026-11-12): a record opened from the decision board goes back to the board,
 * the same record opened from a student goes back to the student. A page
 * opened any other way (typed, bookmarked, in a new tab) goes back to the page
 * above it, as before.
 *
 * Every page names itself once (PageHeader does it with its title, or a page
 * calls usePageLabel). When a link or a save moves to another page, the page
 * left behind is kept against the new step in the browser's history
 * (PageTrailProvider), in sessionStorage so a reload keeps it. BackLink reads it.
 */

export interface CameFrom {
  /** The page's address, with its filters. */
  path: string;
  /** The page's title, as its back link says it. */
  label: string;
  /** Its place in the browser's history, so going back is the browser's own Back. */
  index?: number;
}

export type Trail = Record<string, CameFrom>;

export interface PageTrailValue {
  trail: Trail;
  /** Names the page now on screen. */
  name: (label: string) => void;
}

export const PageTrailContext = createContext<PageTrailValue | null>(null);

const STORE = "kukgrade.pageTrail";
// Enough for any visit; the oldest steps are dropped first.
const KEEP = 100;

export function readTrail(): Trail {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORE) ?? "{}") as unknown;
    return stored && typeof stored === "object" ? (stored as Trail) : {};
  } catch {
    return {};
  }
}

export function writeTrail(trail: Trail): Trail {
  const kept = Object.fromEntries(Object.entries(trail).slice(-KEEP));
  try {
    sessionStorage.setItem(STORE, JSON.stringify(kept));
  } catch {
    // Without storage the trail lasts until a reload; nothing else changes.
  }
  return kept;
}

/** The browser's place in its history, which React Router keeps in history.state. */
export function historyIndex(): number | undefined {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === "number" ? index : undefined;
}

export const pathOf = (location: Location) => `${location.pathname}${location.search}`;

/** Names the page on screen, for the back link of any page opened from it. */
export function usePageLabel(label: string | undefined) {
  const context = useContext(PageTrailContext);
  useEffect(() => {
    if (context && label) context.name(label);
  }, [context, label]);
}

/** The page this one was opened from, if it was opened by a link or a save in the app. */
export function useCameFrom(): CameFrom | undefined {
  const context = useContext(PageTrailContext);
  const location = useLocation();
  return context?.trail[location.key];
}
