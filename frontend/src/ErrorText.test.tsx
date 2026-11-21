import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorText } from "./ErrorText";

describe("ErrorText", () => {
  it("is announced at once and carries the id a control points at", () => {
    render(
      <ErrorText field id="name-error">
        Enter a name
      </ErrorText>,
    );
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Enter a name");
    expect(error).toHaveAttribute("id", "name-error");
    expect(error).toHaveClass("error-text", "error-text--field");
  });

  it("can be another element and keeps a caller's class", () => {
    render(
      <ul>
        <ErrorText as="li" className="extra">
          Could not load
        </ErrorText>
      </ul>,
    );
    const item = screen.getByRole("alert");
    expect(item.tagName).toBe("LI");
    expect(item).toHaveClass("error-text", "extra");
  });
});
