import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NoShowDialog } from "./GradingAttendanceDialogs";

const candidates = [
  { id: 1, name: "Alex Carter", wksaId: "UK-5001" },
  { id: 2, name: "Sam Lee", wksaId: "UK-5002" },
];

describe("attendance dialog focus", () => {
  it("keeps the user's place when the screen behind it re-renders", async () => {
    const user = userEvent.setup();
    // The session screen passes a fresh inline onClose on every render.
    const { rerender } = render(
      <NoShowDialog candidates={candidates} pending={false} error={null} onClose={() => {}} onConfirm={() => {}} />,
    );
    const second = screen.getByRole("checkbox", { name: /Sam Lee/ });
    await user.click(second);
    expect(second).toHaveFocus();

    rerender(
      <NoShowDialog candidates={candidates} pending={false} error={null} onClose={() => {}} onConfirm={() => {}} />,
    );

    expect(second).toHaveFocus();
  });

  it("closes on Escape, but not while its request is in flight", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <NoShowDialog candidates={candidates} pending={true} error={null} onClose={onClose} onConfirm={() => {}} />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

    rerender(
      <NoShowDialog candidates={candidates} pending={false} error={null} onClose={onClose} onConfirm={() => {}} />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
