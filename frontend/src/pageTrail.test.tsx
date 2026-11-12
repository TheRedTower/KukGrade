import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";
import { PageTrailProvider } from "./PageTrailProvider";
import { readTrail, writeTrail } from "./pageTrail";

// Two ways into one record, and the page above it.
function Pages({ at }: { at: string }) {
  return (
    <MemoryRouter initialEntries={[at]}>
      <PageTrailProvider>
        <Routes>
          <Route
            path="/board"
            element={
              <>
                <PageHeader back={{ to: "/session", label: "The session" }} title="Final decisions" titleId="t" />
                <Link to="/record">Open the record</Link>
                <Link to="/board?focus=2">Another candidate</Link>
              </>
            }
          />
          <Route
            path="/student"
            element={
              <>
                <PageHeader title="Isla Brennan" titleId="t" />
                <Link to="/record">Open the record</Link>
              </>
            }
          />
          <Route
            path="/record"
            element={<PageHeader back={{ to: "/scoring", label: "Back to scoring" }} title="Record" titleId="t" />}
          />
        </Routes>
      </PageTrailProvider>
    </MemoryRouter>
  );
}

const back = () => screen.getByRole("link", { name: /^(?!Open|Another)/ });

beforeEach(() => sessionStorage.clear());

describe("the back link", () => {
  it("goes to the page above when the page was opened directly", () => {
    render(<Pages at="/record" />);
    expect(back()).toHaveTextContent("Back to scoring");
    expect(back()).toHaveAttribute("href", "/scoring");
  });

  it("goes back to the page the record was opened from, by its title", async () => {
    const user = userEvent.setup();
    render(<Pages at="/student" />);
    await user.click(screen.getByRole("link", { name: "Open the record" }));
    expect(back()).toHaveTextContent("Isla Brennan");
    expect(back()).toHaveAttribute("href", "/student");
  });

  it("keeps the filters of the page it returns to, and a filter change keeps the way back", async () => {
    const user = userEvent.setup();
    render(<Pages at="/board" />);
    await user.click(screen.getByRole("link", { name: "Another candidate" }));
    // Still the board, with another filter: its own way back is unchanged.
    expect(back()).toHaveTextContent("The session");
    await user.click(screen.getByRole("link", { name: "Open the record" }));
    expect(back()).toHaveTextContent("Final decisions");
    expect(back()).toHaveAttribute("href", "/board?focus=2");
  });

  it("does not make the page it returns to point back at the record", async () => {
    const user = userEvent.setup();
    render(<Pages at="/board" />);
    await user.click(screen.getByRole("link", { name: "Open the record" }));
    // No browser history here, so the back link is followed as a link.
    await user.click(back());
    expect(screen.getByRole("heading", { name: "Final decisions" })).toBeVisible();
    expect(back()).toHaveTextContent("The session");
  });
});

describe("the trail kept for a reload", () => {
  it("keeps the latest steps and drops the oldest", () => {
    const many = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`k${i}`, { path: `/p${i}`, label: `P${i}` }]),
    );
    writeTrail(many);
    const kept = readTrail();
    expect(Object.keys(kept)).toHaveLength(100);
    expect(kept.k119).toEqual({ path: "/p119", label: "P119" });
    expect(kept.k0).toBeUndefined();
  });

  it("reads nothing from a damaged store", () => {
    sessionStorage.setItem("kukgrade.pageTrail", "{not json");
    expect(readTrail()).toEqual({});
  });
});
