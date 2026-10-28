import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "./Pagination";

function renderPager(page: number, totalPages: number) {
  const onPage = vi.fn();
  render(<Pagination label="Pages" page={page} totalPages={totalPages} onPage={onPage} summary="Showing 1–10" />);
  return onPage;
}

describe("Pagination", () => {
  it("shows the summary and no buttons when there is one page", () => {
    renderPager(1, 1);
    expect(screen.getByText("Showing 1–10")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks the current page and moves with Previous, Next and a page number", async () => {
    const onPage = renderPager(2, 5);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(screen.getByRole("button", { name: "Page 4" }));
    expect(onPage.mock.calls.map(([page]) => page)).toEqual([1, 3, 4]);
  });

  it("disables Previous on the first page and Next on the last", () => {
    renderPager(1, 3);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("leaves out the middle of a long run of pages", () => {
    renderPager(1, 20);
    expect(screen.getByRole("button", { name: "Page 20" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Page 10" })).not.toBeInTheDocument();
  });
});
