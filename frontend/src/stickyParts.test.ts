import { afterEach, describe, expect, it, vi } from "vitest";

import { footBar, stickyAside } from "./stickyParts";

// jsdom lays nothing out: a stand-in observer reports whenever it is told to.
let report: () => void = () => {};
class FakeResizeObserver {
  constructor(callback: () => void) {
    report = callback;
  }
  observe() {
    report();
  }
  disconnect() {
    report = () => {};
  }
}

function sized(height: number): HTMLElement {
  const element = document.createElement("aside");
  Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => height });
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sticky parts", () => {
  it("hands a side panel its own height, and takes it back when it goes", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const aside = sized(900);

    const cleanup = stickyAside(aside);
    expect(aside.style.getPropertyValue("--aside-height")).toBe("900px");

    Object.defineProperty(aside, "offsetHeight", { configurable: true, get: () => 400 });
    report();
    expect(aside.style.getPropertyValue("--aside-height")).toBe("400px");

    cleanup?.();
    expect(aside.style.getPropertyValue("--aside-height")).toBe("");
  });

  it("puts a foot bar's height on the page, for the side panels above it", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const cleanup = footBar(sized(96));
    expect(document.documentElement.style.getPropertyValue("--foot-bar-height")).toBe("96px");
    cleanup?.();
    expect(document.documentElement.style.getPropertyValue("--foot-bar-height")).toBe("");
  });

  it("does nothing without an element or an observer", () => {
    expect(stickyAside(null)).toBeUndefined();
    vi.stubGlobal("ResizeObserver", undefined);
    expect(stickyAside(sized(10))).toBeUndefined();
  });
});
