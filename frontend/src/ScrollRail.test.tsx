import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrollRail } from "./ScrollRail";

function renderRail() {
  return render(
    <ScrollRail label="Ranks" watch="B">
      {["A", "B", "C", "D"].map((name) => (
        <button key={name} type="button" aria-pressed={name === "B"}>{name}</button>
      ))}
    </ScrollRail>,
  );
}

/** Gives the track a size, as a browser would: a 250px window over 400px of items. */
function sizeTrack(track: HTMLElement, scrollLeft: number) {
  Object.defineProperty(track, "clientWidth", { configurable: true, value: 250 });
  Object.defineProperty(track, "scrollWidth", { configurable: true, value: 400 });
  track.scrollLeft = scrollLeft;
  fireEvent.scroll(track);
}

describe("ScrollRail", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a named region with its items, and arrows named for it", () => {
    renderRail();
    const region = screen.getByRole("region", { name: "Ranks" });
    expect(region).toContainElement(screen.getByRole("button", { name: "B" }));
    const arrows = document.querySelectorAll(".rail__arrow");
    expect([...arrows].map((arrow) => arrow.getAttribute("aria-label"))).toEqual([
      "Scroll ranks left",
      "Scroll ranks right",
    ]);
  });

  it("hides the arrows while every item fits", () => {
    renderRail();
    expect(document.querySelectorAll(".rail__arrow[hidden]")).toHaveLength(2);
  });

  it("shows the arrows, and which edge it is at, when the items overflow", () => {
    renderRail();
    const track = screen.getByRole("region", { name: "Ranks" });
    sizeTrack(track, 0);
    expect(document.querySelectorAll(".rail__arrow[hidden]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Scroll ranks left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll ranks right" })).toBeEnabled();
    expect(track).toHaveAttribute("data-at-start");
    expect(track).not.toHaveAttribute("data-at-end");
    sizeTrack(track, 150);
    expect(screen.getByRole("button", { name: "Scroll ranks right" })).toBeDisabled();
    expect(track).toHaveAttribute("data-at-end");
  });

  it("moves a page, most of the window, with an arrow", () => {
    renderRail();
    const track = screen.getByRole("region", { name: "Ranks" });
    sizeTrack(track, 0);
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy;
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    fireEvent.click(screen.getByRole("button", { name: "Scroll ranks right" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior: "smooth" });
  });
  it("brings the chosen item in clear of the track's padding, so its focus outline is not clipped", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ paddingLeft: "4px", getPropertyValue: () => "" } as unknown as CSSStyleDeclaration);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const box = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) });
      if (this.classList.contains("rail__track")) return box(0, 250);
      return box(this.textContent === "B" ? 260 : 0, 100);
    });
    renderRail();
    // B ends 110px past the window; it is brought in to end 4px inside it.
    expect(screen.getByRole("region", { name: "Ranks" }).scrollLeft).toBe(114);
  });
});
