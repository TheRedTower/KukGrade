import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("links every crumb but the last, which is the current page", () => {
    render(
      <MemoryRouter>
        <Breadcrumbs items={[{ label: "Gradings", to: "/gradings" }, { label: "Autumn", to: "/gradings/1" }, { label: "Promotion ledger" }]} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(nav).toBeVisible();
    expect(screen.getByRole("link", { name: "Gradings" })).toHaveAttribute("href", "/gradings");
    expect(screen.getByRole("link", { name: "Autumn" })).toHaveAttribute("href", "/gradings/1");
    expect(screen.queryByRole("link", { name: "Promotion ledger" })).toBeNull();
    expect(screen.getByText("Promotion ledger")).toHaveAttribute("aria-current", "page");
  });
});
