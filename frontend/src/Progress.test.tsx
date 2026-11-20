import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./Progress";

function fill(): string {
  return (document.querySelector(".meter__fill") as HTMLElement).style.width;
}

describe("Progress", () => {
  it("says how far, in words, with the bar filled as far", () => {
    render(<Progress done={52} total={80} what="people sorted" />);
    expect(screen.getByText("52 of 80 people sorted")).toBeVisible();
    expect(fill()).toBe("65%");
  });

  it("shows an empty bar when there is nothing to do, never a broken one", () => {
    render(<Progress done={0} total={0} what="checks done" />);
    expect(screen.getByText("0 of 0 checks done")).toBeVisible();
    expect(fill()).toBe("0%");
  });

  it("never fills past the end", () => {
    render(<Progress done={9} total={8} what="people sorted" />);
    expect(fill()).toBe("100%");
  });
});
