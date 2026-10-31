import { Children, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** The track's side padding in px (see .rail__track in layout.css). */
const RAIL_PADDING = 2;

/** How long scrolling must be still before the window is fitted again, in ms. */
const SETTLE_MS = 120;

interface ScrollRailProps {
  /** Names the rail, and its arrows, for assistive technology. */
  label: string;
  /** A value that changes when the chosen item does: the rail brings it into view. */
  watch?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A row of choices too long for the screen. The arrows move it a page at a
 * time: only whole items are shown, and what did not fit comes whole to the
 * start of the next page, so nothing is ever left half shown (the room left over
 * is shared out as gap between the items). This is the one place a screen may
 * scroll sideways on purpose (see .rail in layout.css).
 */
export function ScrollRail({ label, watch, className, children }: ScrollRailProps) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const readEdges = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
  }, []);

  // Fit the window to whole items: the first whole item sits at the start, and
  // what is left over at the end is shared out between the items as extra gap,
  // so no item is cut off, no gap is left beside the arrows, and the arrows stay
  // where they are. Runs when the rail resizes and when scrolling settles.
  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const items = [...el.children] as HTMLElement[];
    const view = el.getBoundingClientRect();
    // The item at the start is the anchor: changing the gap moves every item, so
    // after each change the rail is scrolled to put the anchor back at the start.
    const anchor = items.find((item) => item.getBoundingClientRect().left >= view.left - 1);
    const align = () => {
      if (anchor) el.scrollLeft += anchor.getBoundingClientRect().left - view.left - RAIL_PADDING;
    };
    el.style.columnGap = "";
    align();
    const whole = items
      .map((item) => item.getBoundingClientRect())
      .filter((box) => box.left >= view.left - 1 && box.right <= view.right + 1);
    if (whole.length >= 1 && whole.length < items.length) {
      const spare = view.right - RAIL_PADDING - Math.max(...whole.map((box) => box.right));
      const base = parseFloat(getComputedStyle(el).columnGap) || 0;
      if (spare > 0) {
        el.style.columnGap = `${base + spare / Math.max(1, whole.length - 1)}px`;
        align();
      }
    }
    readEdges();
  }, [readEdges]);

  const fits = edges.atStart && edges.atEnd;
  const count = Children.count(children);

  useEffect(() => {
    const rail = root.current;
    if (!rail) return;
    update();
    // A browser always has it; the test environment does not.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [update, count]);

  // The arrows come and go with `fits`, and they take room from the window.
  useLayoutEffect(() => {
    update();
  }, [fits, update]);

  // After a page, a swipe or Tab, fit again once the scrolling has settled.
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const onScroll = useCallback(() => {
    readEdges();
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(update, SETTLE_MS);
  }, [readEdges, update]);

  // An item is brought in at the nearer edge if it is out of view.
  const reveal = useCallback((item: HTMLElement | null | undefined) => {
    const el = track.current;
    if (!el || !item) return;
    const view = el.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (box.left < view.left) el.scrollLeft += box.left - view.left;
    else if (box.right > view.right) el.scrollLeft += box.right - view.right;
  }, []);

  // The chosen item is always in view.
  useEffect(() => {
    reveal(track.current?.querySelector<HTMLElement>('[aria-pressed="true"]'));
    // Bringing it in may have cut an item at the other edge: fit the window again.
    update();
  }, [watch, reveal, update]);

  function page(direction: "left" | "right") {
    const el = track.current;
    if (!el) return;
    const items = [...el.children] as HTMLElement[];
    const view = el.getBoundingClientRect();
    let target: number;
    if (direction === "right") {
      // The first item cut off at the right edge becomes the first in view.
      const next = items.find((item) => item.getBoundingClientRect().right > view.right + 1);
      if (!next) return;
      target = el.scrollLeft + (next.getBoundingClientRect().left - view.left) - RAIL_PADDING;
    } else {
      // The item just before the first whole one becomes the last in view.
      const first = items.findIndex((item) => item.getBoundingClientRect().left >= view.left - 1);
      const previous = items[first - 1];
      target = previous ? el.scrollLeft + (previous.getBoundingClientRect().right - view.right) + RAIL_PADDING : 0;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div ref={root} className={`rail${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="rail__arrow"
        aria-label={`Scroll ${label.toLowerCase()} left`}
        disabled={edges.atStart}
        hidden={fits}
        onClick={() => page("left")}
      >
        ‹
      </button>
      <div
        ref={track}
        className="rail__track"
        role="region"
        aria-label={label}
        tabIndex={0}
        data-scroll-ok
        onFocusCapture={(event) => reveal(event.target as HTMLElement)}
        onScroll={onScroll}
      >
        {children}
      </div>
      <button
        type="button"
        className="rail__arrow"
        aria-label={`Scroll ${label.toLowerCase()} right`}
        disabled={edges.atEnd}
        hidden={fits}
        onClick={() => page("right")}
      >
        ›
      </button>
    </div>
  );
}
