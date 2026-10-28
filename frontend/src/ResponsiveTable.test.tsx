import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResponsiveTable } from "./ResponsiveTable";

const rows = [
  { id: 1, name: "Autumn", place: "Dojang" },
  { id: 2, name: "Summer", place: "Hall" },
];

function renderTable() {
  render(
    <ResponsiveTable
      label="Sessions"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { key: "place", header: "Place", render: (row) => row.place },
        { key: "name", header: "Session", primary: true, render: (row) => row.name },
        { key: "act", header: "Open it", actions: true, render: (row) => <button type="button">Open {row.name}</button> },
      ]}
    />,
  );
}

describe("ResponsiveTable", () => {
  it("is a real table with named columns and a row per item", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Sessions" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Place",
      "Session",
      "Open it",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("button", { name: "Open Summer" })).toBeInTheDocument();
  });

  it("labels each plain cell for the card layout, and leaves the title and buttons unlabelled", () => {
    renderTable();
    const [place, name, actions] = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(place).toHaveAttribute("data-label", "Place");
    expect(name).toHaveAttribute("data-primary");
    expect(name).not.toHaveAttribute("data-label");
    expect(actions).toHaveAttribute("data-actions");
    expect(actions).not.toHaveAttribute("data-label");
  });
});
