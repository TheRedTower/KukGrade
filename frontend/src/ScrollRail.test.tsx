import { render, screen } from "@testing-library/react";
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
  });
});
