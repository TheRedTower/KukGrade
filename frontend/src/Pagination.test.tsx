import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "./Pagination";

function renderPager(page: number, totalPages: number, count = totalPages * 10) {
  const onPage = vi.fn();
  render(
    <Pagination label="Pages" noun={["event", "events"]} page={page} pageSize={10} count={count} onPage={onPage} />,
  );
  return onPage;
}

describe("Pagination", () => {
  it("shows the summary and no buttons when there is one page", () => {
    renderPager(1, 1, 7);
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("Showing 1–7 of 7 events");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says which rows a later page shows, the last one short", () => {
    renderPager(3, 3, 23);
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("Showing 21–23 of 23 events");
  });

  it("shows nothing for an empty list", () => {
    renderPager(1, 1, 0);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
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
