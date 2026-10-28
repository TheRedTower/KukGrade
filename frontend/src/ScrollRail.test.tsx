import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
