import { render } from "@testing-library/react";

import { RankVisual } from "./RankVisual";

function dotColour(rankName: string): string {
  const { container } = render(<RankVisual rankName={rankName} classPrefix="gsd" />);
  return (container.firstChild as HTMLElement).style.backgroundColor;
}

describe("RankVisual", () => {
  it("draws every black-belt title black, not just those named black", () => {
    for (const rank of ["Dahn Bo Nim", "Jo Kyo Nim", "Kyo Sa Nim", "Pu Sa buhm Nim", "Sa Buhm nim"]) {
      expect(dotColour(rank)).toBe("rgb(15, 23, 42)");
    }
  });

  it("gives each coloured belt its own colour", () => {
    expect(dotColour("White")).toBe("rgb(203, 213, 225)");
    expect(dotColour("Yellow")).toBe("rgb(234, 179, 8)");
    expect(dotColour("Brown")).toBe("rgb(120, 53, 15)");
  });

  it("draws a stripe rank as two bars in its belt colour", () => {
    const { container } = render(<RankVisual rankName="Blue stripe" classPrefix="caw" />);
    const stripes = container.firstChild as HTMLElement;

    expect(stripes).toHaveClass("caw-rank-stripes");
    expect(stripes.style.getPropertyValue("--rank-color")).toBe("#2563eb");
    expect(stripes.querySelectorAll(".caw-stripe-bar")).toHaveLength(2);
  });
});
