import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KukGradeLogo } from "./KukGradeLogo";

describe("KukGradeLogo", () => {
  it("draws its black strokes in the surrounding text colour and keeps the gold", () => {
    render(<KukGradeLogo className="nav-logo" />);

    const logo = screen.getByRole("img", { name: "KukGrade" });
    const fills = [...logo.querySelectorAll("path")].map((path) => path.getAttribute("fill"));
    // currentColor is what makes it light on the ink rail and dark on a page.
    expect(fills).toEqual(["currentColor", "#cca736"]);
    expect(logo.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
