import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResultBadge, SessionStatusBadge, StudentStatusBadge } from "./StatusBadge";

describe("SessionStatusBadge", () => {
  it("shows the label the server sent, in the tone of its status", () => {
    render(<SessionStatusBadge status="LOCKED" label="Locked for decisions" />);
    expect(screen.getByText("Locked for decisions")).toHaveClass("badge");
    expect(screen.getByText("Locked for decisions")).toHaveAttribute("data-tone", "locked");
  });
});

describe("StudentStatusBadge", () => {
  it("shows the label the server sent, in the tone of its status", () => {
    render(<StudentStatusBadge status="LEFT" label="Left the club" />);
    expect(screen.getByText("Left the club")).toHaveClass("badge");
    expect(screen.getByText("Left the club")).toHaveAttribute("data-tone", "danger");
  });
});

describe("ResultBadge", () => {
  it("shows the served words in the tone of the result", () => {
    render(<ResultBadge result="FAIL">Not yet</ResultBadge>);
    expect(screen.getByText("Not yet").closest(".badge")).toHaveAttribute("data-tone", "danger");
  });

  it("draws a grading the student missed as neutral, whatever the result", () => {
    render(
      <ResultBadge result={null} absent>
        Did not attend
      </ResultBadge>,
    );
    expect(screen.getByText("Did not attend").closest(".badge")).toHaveAttribute("data-tone", "neutral");
  });

  it("reads a result KukGrade does not know as a caution", () => {
    render(<ResultBadge result={null}>Unresolved</ResultBadge>);
    expect(screen.getByText("Unresolved").closest(".badge")).toHaveAttribute("data-tone", "warning");
  });
});
