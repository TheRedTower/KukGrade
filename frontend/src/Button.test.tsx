import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { buttonClass } from "./buttonClass";

describe("Button", () => {
  it("is a button of type button, in the secondary look unless told otherwise", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("btn", "btn--secondary");
  });

  it("takes its variant, size and width from props and keeps a caller's own class", () => {
    render(
      <Button variant="danger" small block className="extra" type="submit">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("btn", "btn--danger", "btn--sm", "btn--block", "extra");
  });

  it("gives a link the same classes", () => {
    expect(buttonClass({ variant: "primary" })).toBe("btn btn--primary");
  });
});
