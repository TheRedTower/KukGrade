import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { QueueList } from "./QueueList";

describe("QueueList", () => {
  it("opens each queue's own list, with how many wait in it", () => {
    render(
      <MemoryRouter>
        <QueueList
          label="To sort"
          queues={[
            { to: "/imports/1/people/new", label: "New people", count: 4, hint: "Not yet in KukGrade" },
            { to: "/imports/1/people/later", label: "Later", count: 0 },
          ]}
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole("list", { name: "To sort" });
    const queues = within(list).getAllByRole("link");
    expect(queues).toHaveLength(2);
    expect(queues[0]).toHaveAttribute("href", "/imports/1/people/new");
    expect(queues[0]).toHaveTextContent("New people");
    expect(queues[0]).toHaveTextContent("Not yet in KukGrade");
    expect(within(queues[0]).getByText("4")).toHaveAttribute("data-tone", "info");
  });

  it("still shows an empty queue, so the whole of the work is in view", () => {
    render(
      <MemoryRouter>
        <QueueList label="To sort" queues={[{ to: "/later", label: "Later", count: 0 }]} />
      </MemoryRouter>,
    );
    const queue = screen.getByRole("link", { name: /Later/ });
    expect(within(queue).getByText("0")).toHaveAttribute("data-tone", "neutral");
  });
});
