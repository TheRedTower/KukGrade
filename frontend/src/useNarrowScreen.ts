import { useEffect, useState } from "react";

const QUERY = "(max-width: 56rem)";

/** Whether the screen is phone-sized, where the sidebar becomes a menu. */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
