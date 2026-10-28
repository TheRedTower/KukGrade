import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

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
 * start of the next page, so nothing is ever left half shown. This is the one place a screen may
 * scroll sideways on purpose (see .rail in layout.css).
 */
export function ScrollRail({ label, watch, className, children }: ScrollRailProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true, clipStart: 0, clipEnd: 0 });

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // An item cut off at either edge is hidden: only whole ones show.
    const view = el.getBoundingClientRect();
    const boxes = ([...el.children] as HTMLElement[]).map((item) => item.getBoundingClientRect());
    const whole = boxes.filter((box) => box.left >= view.left - 1 && box.right <= view.right + 1);
    const allWhole = whole.length === boxes.length;
    const clipStart = whole.length > 0 && !allWhole ? Math.max(0, Math.min(...whole.map((box) => box.left)) - view.left) : 0;
    const clipEnd = whole.length > 0 && !allWhole ? Math.max(0, view.right - Math.max(...whole.map((box) => box.right))) : 0;
    setEdges({
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      clipStart,
      clipEnd,
    });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    update();
    // A browser always has it; the test environment does not.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update, children]);

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
  }, [watch, reveal]);

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
      target = el.scrollLeft + (next.getBoundingClientRect().left - view.left);
    } else {
      // The item just before the first whole one becomes the last in view.
      const first = items.findIndex((item) => item.getBoundingClientRect().left >= view.left - 1);
      const previous = items[first - 1];
      target = previous ? el.scrollLeft + (previous.getBoundingClientRect().right - view.right) : 0;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }

  const fits = edges.atStart && edges.atEnd;
  return (
    <div className={`rail${className ? ` ${className}` : ""}`}>
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
        style={edges.clipStart > 0 || edges.clipEnd > 0 ? { clipPath: `inset(0 ${edges.clipEnd}px 0 ${edges.clipStart}px)` } : undefined}
        onFocusCapture={(event) => reveal(event.target as HTMLElement)}
        onScroll={update}
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
