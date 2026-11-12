/**
 * The page is the only thing that scrolls (docs/development.md): a box that
 * scrolls inside a scrolling page traps a swipe at its end and hides what is
 * under it. A side panel stays in view with `position: sticky`, and a bar at the
 * foot of the window with `position: sticky; bottom: 0`.
 *
 * CSS cannot read an element's own height, so these refs hand it over as a
 * custom property (layout.css uses them). A side panel taller than the window
 * then moves with the page until its foot is in view above any foot bar, and
 * stays there, rather than scrolling inside itself.
 *
 * Both are ref callbacks that clean up after themselves (React 19).
 */

function followHeight(element: HTMLElement, holder: HTMLElement, property: string): (() => void) | undefined {
  if (typeof ResizeObserver === "undefined") return undefined;
  const observer = new ResizeObserver(() => {
    holder.style.setProperty(property, `${element.offsetHeight}px`);
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
    holder.style.removeProperty(property);
  };
}

/** On a `.split__aside` (or any panel kept in view beside the page). */
export function stickyAside(element: HTMLElement | null): (() => void) | undefined {
  return element ? followHeight(element, element, "--aside-height") : undefined;
}

/** On a bar kept at the foot of the window, so a side panel's foot stays above it. */
export function footBar(element: HTMLElement | null): (() => void) | undefined {
  return element ? followHeight(element, document.documentElement, "--foot-bar-height") : undefined;
}
