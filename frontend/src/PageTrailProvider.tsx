import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Location, useLocation, useNavigationType } from "react-router-dom";

import { type CameFrom, PageTrailContext, type Trail, historyIndex, pathOf, readTrail, writeTrail } from "./pageTrail";

/** Keeps, for each step in the browser's history, the page it was opened from (pageTrail.ts). */
export function PageTrailProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [trail, setTrail] = useState<Trail>(readTrail);
  const labels = useRef(new Map<string, string>());
  // A page's title, by its address without filters: changing a filter keeps its name.
  const here = useRef(location.pathname);
  const previous = useRef<Location | null>(null);

  // Before the new page is painted, so its back link is right from the start;
  // and before any page names itself (an effect), so the name lands on its own page.
  useLayoutEffect(() => {
    here.current = location.pathname;
    const left = previous.current;
    previous.current = location;
    if (!left || left.key === location.key || navigationType !== "PUSH") return;
    // A back link followed as a link: its page goes back to the page above it.
    if ((location.state as { back?: unknown } | null)?.back) return;
    const current = readTrail();
    let came: CameFrom | undefined;
    if (left.pathname === location.pathname) {
      // The same page with other filters: it still came from where it came from.
      came = current[left.key];
    } else {
      const label = labels.current.get(left.pathname);
      const index = historyIndex();
      if (label) came = { path: pathOf(left), label, index: index === undefined ? undefined : index - 1 };
    }
    if (came) setTrail(writeTrail({ ...current, [location.key]: came }));
  }, [location, navigationType]);

  const name = useCallback((label: string) => {
    labels.current.set(here.current, label);
  }, []);
  const value = useMemo(() => ({ trail, name }), [trail, name]);
  return <PageTrailContext.Provider value={value}>{children}</PageTrailContext.Provider>;
}
