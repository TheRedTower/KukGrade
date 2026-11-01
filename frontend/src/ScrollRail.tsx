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
 * A row of choices too long for the screen: the usual native scroller. It
 * swipes or wheels sideways and snaps to an item, a fade at an edge shows that
 * there is more, and on a screen with a pointer the arrows move it a page at a
 * time (they are hidden on touch, where swiping is the way). This is the one
 * place a screen may scroll sideways on purpose (see .rail in layout.css).
 */
export function ScrollRail({ label, watch, className, children }: ScrollRailProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const readEdges = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    readEdges();
    // A browser always has it; the test environment does not.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(readEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [readEdges, children]);

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

  function page(direction: -1 | 1) {
    const el = track.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduced ? "auto" : "smooth" });
  }

  const fits = edges.atStart && edges.atEnd;

  return (
    <div className={`rail${className ? ` ${className}` : ""}`} data-fits={fits || undefined}>
      <button
        type="button"
        className="rail__arrow"
        aria-label={`Scroll ${label.toLowerCase()} left`}
        disabled={edges.atStart}
        hidden={fits}
        onClick={() => page(-1)}
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
        data-at-start={edges.atStart || undefined}
        data-at-end={edges.atEnd || undefined}
        onFocusCapture={(event) => reveal(event.target as HTMLElement)}
        onScroll={readEdges}
      >
        {children}
      </div>
      <button
        type="button"
        className="rail__arrow"
        aria-label={`Scroll ${label.toLowerCase()} right`}
        disabled={edges.atEnd}
        hidden={fits}
        onClick={() => page(1)}
      >
        ›
      </button>
    </div>
  );
}
