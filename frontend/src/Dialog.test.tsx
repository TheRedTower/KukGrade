import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

function renderDialog(props: { canClose?: boolean; closeOnBackdrop?: boolean } = {}) {
  const onClose = vi.fn();
  render(
    <Dialog title="Sure?" eyebrow="Record #4" closeLabel="Close the question" onClose={onClose} {...props}>
      <p>Details</p>
      <button type="button">Inside</button>
    </Dialog>,
  );
  return onClose;
}

describe("Dialog", () => {
  it("is a named modal dialog with its eyebrow and a labelled Close button", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Sure?" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Record #4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close the question" })).toBeInTheDocument();
  });

  it("closes on Close and on Escape", async () => {
    const onClose = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Close the question" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on a click outside the card but not on one inside it", async () => {
    const onClose = renderDialog();
    await userEvent.click(screen.getByText("Details"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a click outside from closing it where something would be lost", async () => {
    const onClose = renderDialog({ closeOnBackdrop: false });
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can leave out Close when it has its own Cancel", () => {
    render(
      <Dialog title="Delete it?" closeButton={false} onClose={() => {}}>
        <button type="button">Cancel</button>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("does nothing while it cannot close", async () => {
    const onClose = renderDialog({ canClose: false });
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Close the question" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
