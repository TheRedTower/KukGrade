import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("is a polite status with the text and a hidden spinner", () => {
    const { container } = render(<LoadingState>Loading students…</LoadingState>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading students…");
    expect(container.querySelector(".spinner")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("EmptyState", () => {
  it("shows a title, why and the next step, without announcing itself", () => {
    render(
      <EmptyState title="No students yet" action={<button type="button">Add student</button>}>
        <p>Add your first student.</p>
      </EmptyState>,
    );
    expect(screen.getByText("No students yet")).toBeVisible();
    expect(screen.getByText("Add your first student.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add student" })).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can be a labelled heading and a framed, filling box", () => {
    const { container } = render(<EmptyState title="Not found" titleAs="h2" titleId="nf" framed fill />);
    expect(screen.getByRole("heading", { level: 2, name: "Not found" })).toHaveAttribute("id", "nf");
    expect(container.firstChild).toHaveClass("empty-state--framed", "empty-state--fill");
  });
});
