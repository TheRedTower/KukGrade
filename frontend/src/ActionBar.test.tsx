import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionBar } from "./ActionBar";

describe("ActionBar", () => {
  it("holds the buttons, and what it says beside them", () => {
    render(
      <ActionBar status={<p>3 waiting</p>} testId="bar">
        <button type="button">Save</button>
      </ActionBar>,
    );
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveClass("action-bar");
    expect(bar.querySelector(".action-bar__status")).toHaveTextContent("3 waiting");
    expect(bar.querySelector(".action-bar__actions")).toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it("has no room for words when it has nothing to say", () => {
    render(
      <ActionBar testId="bar">
        <button type="button">Save</button>
      </ActionBar>,
    );
    expect(screen.getByTestId("bar").querySelector(".action-bar__status")).toBeNull();
    expect(screen.getByTestId("bar")).toHaveTextContent(/^Save$/);
  });
});
