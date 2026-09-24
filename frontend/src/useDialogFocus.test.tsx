import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDialogFocus } from "./useDialogFocus";

function TestDialog({
  onClose,
  canClose = true,
}: {
  onClose: () => void;
  canClose?: boolean;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose,
  });

  return (
    <div ref={dialogRef} role="dialog" aria-label="Test dialog" tabIndex={-1}>
      <input aria-label="First field" data-dialog-autofocus />
      <button type="button">Last action</button>
    </div>
  );
}

function DialogHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open dialog
      </button>
      {isOpen && <TestDialog onClose={() => setIsOpen(false)} />}
    </>
  );
}

describe("useDialogFocus", () => {
  it("moves and traps focus, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);

    const firstField = screen.getByRole("textbox", { name: "First field" });
    const lastAction = screen.getByRole("button", { name: "Last action" });
    expect(firstField).toHaveFocus();
    expect(document.body).toHaveStyle({ overflow: "hidden" });

    await user.tab({ shift: true });
    expect(lastAction).toHaveFocus();

    await user.tab();
    expect(firstField).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("does not close when closing is temporarily disabled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestDialog onClose={onClose} canClose={false} />);

    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Test dialog" })).toBeInTheDocument();
  });
});
