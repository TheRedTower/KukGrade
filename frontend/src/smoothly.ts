import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * A change the person asked for (the sidebar to icons, the theme, another
 * settings tab) eases from the old look to the new over `--duration`, rather
 * than jumping. The browser draws it (a view transition, styled in layout.css):
 * it pictures the page before and after and fades one into the other while the
 * sidebar and the page slide to their new sizes.
 *
 * A browser without view transitions, or a person who asked for reduced motion,
 * gets the change at once, as before.
 */
export function smoothly(change: () => void | Promise<void>): void {
  const still =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || typeof document.startViewTransition !== "function") {
    void change();
    return;
  }
  document.startViewTransition(async () => {
    let waiting: void | Promise<void> = undefined;
    flushSync(() => {
      waiting = change();
    });
    await waiting;
  });
}

// The longest a view transition waits for the next page before it gives up and shows it.
const ARRIVAL_LIMIT_MS = 1000;

/**
 * Goes to another page smoothly. The router shows the next page in a React
 * transition, so the change is not on screen when `navigate` returns: the
 * picture of the new page waits for it to arrive.
 */
export function useSmoothNavigate(): (to: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const arrived = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    arrived.current?.();
    arrived.current = null;
  }, [location.key]);

  return useCallback(
    (to: string) =>
      smoothly(
        () =>
          new Promise<void>((resolve) => {
            arrived.current = resolve;
            window.setTimeout(resolve, ARRIVAL_LIMIT_MS);
            void navigate(to);
          }),
      ),
    [navigate],
  );
}
