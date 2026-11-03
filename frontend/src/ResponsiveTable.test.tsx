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
  it("names its empty box, and keeps a flush table's look", () => {
    render(<ResponsiveTable flush empty="Nothing yet." label="Sessions" rows={[]} rowKey={(row: { id: number }) => row.id} columns={[]} />);
    const box = screen.getByRole("group", { name: "Sessions" });
    expect(box).toHaveTextContent("Nothing yet.");
    expect(box).toHaveClass("rtable--flush", "rtable__empty");
  });

  it("shows a row's detail under it, across every column, only while it is open", () => {
    render(
      <ResponsiveTable
        label="Sessions"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "name", header: "Session", primary: true, render: (row) => row.name },
          { key: "place", header: "Place", render: (row) => row.place },
        ]}
        detail={(row) => (row.id === 2 ? <p>Editing {row.name}</p> : null)}
      />,
    );
    const body = screen.getAllByRole("rowgroup")[1];
    const tableRows = within(body).getAllByRole("row");
    expect(tableRows).toHaveLength(3);
    expect(tableRows[2]).toHaveTextContent("Editing Summer");
    expect(within(tableRows[2]).getByRole("cell")).toHaveAttribute("colspan", "2");
  });

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
