import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionStatusBadge, StudentStatusBadge } from "./StatusBadge";

describe("SessionStatusBadge", () => {
  it("shows the label the server sent, in the tone of its status", () => {
    render(<SessionStatusBadge status="LOCKED" label="Locked for decisions" />);
    expect(screen.getByText("Locked for decisions")).toHaveClass("badge", "badge--locked");
  });
});

describe("StudentStatusBadge", () => {
  it("shows the label the server sent, in the tone of its status", () => {
    render(<StudentStatusBadge status="LEFT" label="Left the club" />);
    expect(screen.getByText("Left the club")).toHaveClass("badge", "badge--danger");
  });
});
