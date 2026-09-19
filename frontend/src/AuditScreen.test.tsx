import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditScreen } from "./AuditScreen";
import type { AuditEvent } from "./api";

const mockGetAuditEvents = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getAuditEvents: (...args: unknown[]) => mockGetAuditEvents(...args),
  };
});

const auditEvent: AuditEvent = {
  id: 42,
  occurred_at: "2026-09-20T14:35:00Z",
  action: "OUTCOME_FINALISED",
  action_display: "Outcome finalised",
  entity_type: "CandidateOutcome",
  entity_id: "103",
  actor: "e7659aa9-dace-4baf-8c64-f335804902bc",
  actor_email: "master.kim@kuksoolwon.test",
  actor_name: "In Hyuk Kim",
  summary: "Finalised Carlos Rivera's grading outcome as Pass.",
  metadata: { result: "PASS", previous_result: null },
};

function renderScreen(initialEntry = "/audit") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/audit" element={<AuditScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuditScreen", () => {
  beforeEach(() => {
    mockGetAuditEvents.mockReset();
    mockGetAuditEvents.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [auditEvent],
    });
  });

  it("shows the immutable event ledger and inspectable event detail", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText(auditEvent.summary)).toBeInTheDocument();
    expect(screen.getByText("In Hyuk Kim")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();

    const viewButton = screen.getByRole("button", { name: "View Outcome finalised event" });
    await user.click(viewButton);

    const dialog = screen.getByRole("dialog", { name: "Outcome finalised" });
    expect(within(dialog).getByText("OUTCOME_FINALISED")).toBeInTheDocument();
    expect(within(dialog).getByText(/"result": "PASS"/)).toBeInTheDocument();
    const closeButton = within(dialog).getByRole("button", { name: "Close event details" });
    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(viewButton).toHaveFocus();
  });

  it("applies action, entity, date, and search filters", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(auditEvent.summary);

    await user.selectOptions(screen.getByLabelText("Action"), "OUTCOME_FINALISED");
    await user.selectOptions(screen.getByLabelText("Entity type"), "CandidateOutcome");
    fireEvent.change(screen.getByLabelText("Date from"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Date to"), { target: { value: "2026-09-30" } });
    await user.type(screen.getByLabelText("Search entity ID or summary"), "Carlos");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mockGetAuditEvents).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 10,
        action: "OUTCOME_FINALISED",
        entity_type: "CandidateOutcome",
        occurred_from: "2026-09-01",
        occurred_to: "2026-09-30",
        search: "Carlos",
      });
    });
  });

  it("requests the next page and reports the visible range", async () => {
    const user = userEvent.setup();
    mockGetAuditEvents.mockResolvedValue({
      count: 25,
      next: "/api/audit-events/?page=2",
      previous: null,
      results: [auditEvent],
    });
    renderScreen();

    expect(await screen.findByText("Showing 1–10 of 25 events")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(mockGetAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, page_size: 10 }),
      );
    });
    expect(screen.getByText("Showing 11–20 of 25 events")).toBeInTheDocument();
  });

  it("provides an empty state and can clear active filters", async () => {
    const user = userEvent.setup();
    mockGetAuditEvents.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    renderScreen("/audit?action=STUDENT_UPDATED");

    expect(await screen.findByText("No audit events found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(mockGetAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: undefined, page: 1 }),
      );
    });
  });
});
