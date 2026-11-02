import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "./Alert";

describe("Alert", () => {
  it("announces an error at once and a confirmation politely", () => {
    render(
      <>
        <Alert>It broke</Alert>
        <Alert tone="success">Saved</Alert>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("It broke");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("takes its tone class, a title and a caller's own class", () => {
    render(
      <Alert tone="warning" title="Careful" className="extra">
        Look twice
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert", "alert--warning", "extra");
    expect(alert).toHaveTextContent("CarefulLook twice");
  });

  it("closes only when it can be dismissed", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Alert>Plain</Alert>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Alert onDismiss={onDismiss}>Plain</Alert>);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
