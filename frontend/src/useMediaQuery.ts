import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches right now, for a decision made at that moment. */
export function mediaMatches(query: string): boolean {
  return window.matchMedia(query).matches;
}

/** Whether a media query matches, kept current as the screen or the system changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => mediaMatches(query));
}
