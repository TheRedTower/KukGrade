import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrollRail } from "./ScrollRail";

describe("ScrollRail", () => {
  it("is a named region with its items, and arrows named for it", () => {
    render(
      <ScrollRail label="Ranks" watch="b">
        <button type="button" aria-pressed="false">A</button>
        <button type="button" aria-pressed="true">B</button>
      </ScrollRail>,
    );
    const region = screen.getByRole("region", { name: "Ranks" });
    expect(region).toContainElement(screen.getByRole("button", { name: "B" }));
    // Without layout everything "fits", so the arrows are hidden; they are named for the rail.
    const arrows = document.querySelectorAll(".rail__arrow");
    expect([...arrows].map((arrow) => arrow.getAttribute("aria-label"))).toEqual([
      "Scroll ranks left",
      "Scroll ranks right",
    ]);
  });

  describe("with a window that holds two and a half items", () => {
    afterEach(() => vi.restoreAllMocks());

    /** A 250px window; each item is 100px wide, 2px in from the start, with no gap of its own. */
    function mockLayout(trackWidth: number) {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) });
        if (this.classList.contains("rail__track")) return box(0, trackWidth);
        const track = this.parentElement as HTMLElement;
        const gap = parseFloat(track.style.columnGap) || 0;
        const index = [...track.children].indexOf(this);
        return box(2 + index * (100 + gap) - track.scrollLeft, 100);
      });
    }

    function renderRail() {
      return render(
        <ScrollRail label="Ranks">
          {["A", "B", "C", "D"].map((name) => (
            <button key={name} type="button">{name}</button>
          ))}
        </ScrollRail>,
      );
    }

    it("shares the room left over as gap, so the window ends on a whole item", () => {
      mockLayout(250);
      renderRail();
      // Two whole items (2-202); 250 - 2 - 202 = 46px spare, shared into the one gap.
      expect(screen.getByRole("region", { name: "Ranks" }).style.columnGap).toBe("46px");
    });

    it("leaves the gap alone when every item fits", () => {
      mockLayout(500);
      renderRail();
      expect(screen.getByRole("region", { name: "Ranks" }).style.columnGap).toBe("");
    });

    it("keeps the item at the start when it fits again after a page", () => {
      vi.useFakeTimers();
      mockLayout(250);
      render(
        <ScrollRail label="Ranks">
          {Array.from({ length: 16 }, (_, index) => (
            <button key={index} type="button">{`R${index}`}</button>
          ))}
        </ScrollRail>,
      );
      const track = screen.getByRole("region", { name: "Ranks" });
      const gap = parseFloat(track.style.columnGap);
      // Paged so that the third item (index 2) is at the start, under the gap now set.
      track.scrollLeft = 2 * (100 + gap);
      fireEvent.scroll(track);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      const newGap = parseFloat(track.style.columnGap);
      // The same item is still the first, however the gap came out.
      expect(track.scrollLeft).toBeCloseTo(2 * (100 + newGap), 5);
      vi.useRealTimers();
    });

    it("keeps the last page as it is, however the scroll range moves", () => {
      vi.useFakeTimers();
      mockLayout(250);
      render(
        <ScrollRail label="Ranks">
          {Array.from({ length: 16 }, (_, index) => (
            <button key={index} type="button">{`R${index}`}</button>
          ))}
        </ScrollRail>,
      );
      const track = screen.getByRole("region", { name: "Ranks" });
      const gap = parseFloat(track.style.columnGap);
      // The last two items (14 and 15) are the window.
      track.scrollLeft = 14 * (100 + gap);
      fireEvent.scroll(track);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(parseFloat(track.style.columnGap)).toBe(gap);
      expect(track.scrollLeft).toBeCloseTo(14 * (100 + gap), 5);
      vi.useRealTimers();
    });
  });
});
