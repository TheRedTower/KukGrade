import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditScreen } from "./AuditScreen";
import type { AuditEvent } from "./api";

const mockGetAuditEvents = vi.fn();
const mockGetAuditSubject = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getAuditEvents: (...args: unknown[]) => mockGetAuditEvents(...args),
    getAuditSubject: (...args: unknown[]) => mockGetAuditSubject(...args),
    // The server's names for the filters; the screen keeps no list of its own.
    getAuditLabels: async () => ({
      actions: [
        { value: "OUTCOME_FINALISED", label: "Outcome finalised" },
        { value: "SESSION_CREATED", label: "Grading session created" },
      ],
      entities: [
        { value: "CandidateOutcome", label: "Outcome" },
        { value: "GradingSession", label: "Grading session" },
      ],
    }),
  };
});

const auditEvent: AuditEvent = {
  id: 42,
  occurred_at: "2026-09-20T14:35:00Z",
  action: "OUTCOME_FINALISED",
  action_display: "Outcome finalised",
  entity_type: "CandidateOutcome",
  entity_type_display: "Outcome",
  subject_name: "",
  entity_id: "103",
  actor_email: "master.kim@kuksoolwon.test",
  actor_name: "In Hyuk Kim",
  summary: "Finalised Carlos Rivera's grading outcome as Pass.",
  tone: "success",
  outcome_display: "Pass",
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

  it("shows a student's current name beside an event that holds only their ID", async () => {
    mockGetAuditEvents.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{ ...auditEvent, summary: "Student 123-4-001 created.", subject_name: "Alex Kim" }],
    });
    renderScreen();

    expect(await screen.findByText("Student 123-4-001 created. (Alex Kim)")).toBeVisible();
  });

  it("says whose history it is, by name, and asks the server for exactly that history", async () => {
    mockGetAuditSubject.mockResolvedValue({
      kind: "session",
      id: "3",
      session_id: null,
      name: "Spring Grading (25 October 2026)",
      exists: true,
    });
    renderScreen("/audit?subject=session:3");

    const banner = await screen.findByTestId("audit-subject");
    expect(await within(banner).findByText(/History of Spring Grading \(25 October 2026\)/)).toBeVisible();
    expect(within(banner).getByRole("link", { name: /Open the record/ })).toHaveAttribute("href", "/gradings/3");
    expect(mockGetAuditSubject).toHaveBeenCalledWith("session:3");
    await waitFor(() =>
      expect(mockGetAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ subject: "session:3" })),
    );
  });

  it("opens a registration inside the grading it belongs to", async () => {
    mockGetAuditSubject.mockResolvedValue({
      kind: "candidate",
      id: "9",
      session_id: 3,
      name: "Alex Kim - Spring Grading",
      exists: true,
    });
    renderScreen("/audit?subject=candidate:9");

    const banner = await screen.findByTestId("audit-subject");
    expect(await within(banner).findByRole("link", { name: /Open the record/ })).toHaveAttribute(
      "href",
      "/gradings/3/assessments/9/review",
    );
  });

  it("says so when the record the history is of no longer exists", async () => {
    mockGetAuditSubject.mockResolvedValue({ kind: "student", id: "9", session_id: null, name: "", exists: false });
    renderScreen("/audit?subject=student:9");

    expect(await screen.findByText(/History of a record that no longer exists/)).toBeVisible();
  });

  it("shows no history banner on the whole log, and clearing the filters leaves a history", async () => {
    mockGetAuditSubject.mockResolvedValue({ kind: "user", id: "u", session_id: null, name: "Riley Khan", exists: true });
    const user = userEvent.setup();
    renderScreen("/audit?subject=user:u");
    await screen.findByTestId("audit-subject");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(screen.queryByTestId("audit-subject")).toBeNull());
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
    // The internal action code is not shown; the summary says what happened.
    expect(within(dialog).queryByText("OUTCOME_FINALISED")).not.toBeInTheDocument();
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
    // The choices are the server's, so they arrive with their own request.
    await screen.findByRole("option", { name: "Outcome finalised" });

    await user.selectOptions(screen.getByLabelText("Action"), "OUTCOME_FINALISED");
    await user.selectOptions(screen.getByLabelText("Record type"), "CandidateOutcome");
    fireEvent.change(screen.getByLabelText("Date from"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Date to"), { target: { value: "2026-09-30" } });
    await user.type(screen.getByLabelText("Search student name, record number or summary"), "Carlos");
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

  it("shows one record's events when opened from that record's link", async () => {
    const user = userEvent.setup();
    renderScreen("/audit?entity_type=GradingSession&entity_id=10");

    await screen.findByText(auditEvent.summary);
    expect(mockGetAuditEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity_type: "GradingSession", entity_id: "10" }),
    );
    expect(screen.getByText(/for Grading session #10/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(mockGetAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ entity_id: undefined }),
      );
    });
  });
});
