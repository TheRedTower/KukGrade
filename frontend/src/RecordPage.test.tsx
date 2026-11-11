import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";

function idAt(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={children} path="/things/:id" />
      </Routes>
    </MemoryRouter>
  );
  return renderHook(() => useIdParam(), { wrapper }).result.current;
}

const settled = { isPending: false, isError: false, error: null };

describe("useIdParam", () => {
  it("reads a whole number above nought, and nothing else", () => {
    expect(idAt("/things/7")).toBe(7);
    expect(idAt("/things/12abc")).toBeNull();
    expect(idAt("/things/0")).toBeNull();
    expect(idAt("/things/-3")).toBeNull();
    expect(idAt("/things/1.5")).toBeNull();
  });
});

describe("recordStatus", () => {
  it("is missing for a bad id or a record the server does not have", () => {
    expect(recordStatus(null, settled)).toBe("missing");
    expect(recordStatus(3, { isPending: false, isError: true, error: new ApiError("Not found.", 404) })).toBe("missing");
  });

  it("is failed for any other refusal, loading until it arrives, and null once it has", () => {
    expect(recordStatus(3, { isPending: false, isError: true, error: new ApiError("Server error.", 500) })).toBe("failed");
    expect(recordStatus(3, { isPending: true, isError: false, error: null })).toBe("loading");
    expect(recordStatus(3, settled)).toBeNull();
  });
});

describe("RecordPage", () => {
  const back = { to: "/things", label: "Things" };
  const renderPage = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

  it("says what is loading", () => {
    renderPage(<RecordPage back={back} label="Thing" missing="Thing not found" status="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading thing…");
  });

  it("says a missing record was not found, with the way back", () => {
    renderPage(<RecordPage back={back} label="Thing" missing="Thing not found" status="missing" />);
    expect(screen.getByRole("heading", { level: 1, name: "Thing not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Things" })).toHaveAttribute("href", "/things");
  });

  it("gives the server's reason when it could not be loaded, and tries again", async () => {
    const onRetry = vi.fn();
    renderPage(
      <RecordPage
        back={back}
        error={new ApiError("The server is busy.", 503)}
        label="Thing"
        missing="Thing not found"
        status="failed"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The server is busy.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says it in its own words when the server gives none", () => {
    renderPage(<RecordPage back={back} failed="Nothing could be read." label="Thing" missing="Thing not found" status="failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing could be read.");
  });
});
