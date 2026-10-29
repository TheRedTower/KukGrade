import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionStatusBadge } from "./StatusBadge";

describe("SessionStatusBadge", () => {
  it("shows the label the server sent, in the tone of its status", () => {
    render(<SessionStatusBadge status="LOCKED" label="Locked for decisions" />);
    expect(screen.getByText("Locked for decisions")).toHaveClass("badge", "badge--locked");
  });

  it("falls back to the shared words for a status", () => {
    render(<SessionStatusBadge status="COMPLETED" />);
    expect(screen.getByText("Completed")).toHaveClass("badge--completed");
  });

  it("shows nothing when there is no status", () => {
    const { container } = render(<SessionStatusBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
