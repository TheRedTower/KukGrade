import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  CandidateAssessment,
  CandidateAssessmentItem,
  CandidateAssessmentItemResult,
  CandidateAssessmentSummary,
  GradingCandidate,
  GradingSession,
  StudentListItem,
} from "./api";
import {
  authUser,
  jsonResponse,
  assessmentSummaryFor,
  itemSaved,
  itemServed,
  sessionServed,
  CHOICES,
  stubFetch,
} from "./appTestSupport";

const mockSaveFile = vi.fn();
vi.mock("./saveFile", () => ({
  saveFile: (...args: unknown[]) => mockSaveFile(...args),
}));

// Candidate Assessment Workspace Screen (/gradings/:sessionId/assessments/:candidateId)
describe("Candidate Assessment Workspace Screen (/gradings/:sessionId/assessments/:candidateId)", () => {
  const mockSession: GradingSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-10-15",
    location: "Main Dojang",
    status: "OPEN",
    status_display: "Open",
    candidate_count: 0,
    completed_assessment_count: 0,
    awaiting_decision_count: 0,
    ...sessionServed("OPEN"),
    can_be_deleted: false,
    archived_at: null,
    can_be_archived: false,
    can_be_restored: false,
    can_download_summary: false,
    can_print_grading_sheets: false,
    notes: "",
  };

  const mockCandidate: GradingCandidate = {
    id: 101,
    session: 10,
    student: 1,
    student_display_name: "Alex Carter",
    student_first_name: "Alex",
    student_wksa_id: "KG-0264",
    from_rank: 1,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 2,
    testing_for_rank_name: "Yellow",
    age_band_display: "Junior (9–12)",
    status: "REGISTERED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  };

  const mockStudent: StudentListItem = {
    id: 1,
    first_name: "Alex",
    last_name: "Carter",
    wksa_id: "KG-0264",
    current_rank: 1,
    current_rank_code: "YELLOW_STRIPE",
    current_rank_name: "Yellow stripe belt",
    age_band: "AGE_9_TO_12",
    age_band_display: "Junior (9–12)",
    status: "ACTIVE",
    can_be_graded: true,
    next_rank: null,
    next_rank_name: null,
    status_display: "Active",
    current_grading: null,
  };

  const mockAssessment: CandidateAssessment = {
    id: 501,
    candidate: 101,
    candidate_student_name: "Alex Carter",
    status: "IN_PROGRESS",
    status_display: "In progress",
    generated_by_name: "KSN Casey Lane",
    overall: assessmentSummaryFor([]).overall,
    marks_open: true,
    can_start: false,
    can_delete: false,
    generated_at: "2026-09-18T10:00:00Z",
    started_at: "2026-09-18T10:05:00Z",
    completed_at: null,
    notes: "",
  };

  const mockItem1: CandidateAssessmentItem = {
    id: 1001,
    item_name: "Etiquette & Bowing",
    korean_name: "예의",
    category: "ETIQUETTE",
    category_display: "Etiquette",
    category_is_core: true,
    reason_required: true,
    can_clear: true,
    position: 1,
    required: true,
    display_range: "",
    requirement_notes: "Proper bow, respect for flags and instructors",
    notation: "",
    result: "MET",
    result_display: "Met",
    assessor_name: "KSN Casey Lane",
    assessed_at: "2026-09-18T10:10:00Z",
    comments: [],
    changes: [],
  };

  const mockItem2: CandidateAssessmentItem = {
    id: 1002,
    item_name: "Ap Cha Gi (Front Kick)",
    korean_name: "앞차기",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    reason_required: true,
    can_clear: true,
    position: 2,
    required: true,
    display_range: "",
    requirement_notes: "Full chamber, ball of foot contact",
    notation: "",
    result: "NOT_MET",
    result_display: "Not Met",
    assessor_name: "KSN Casey Lane",
    assessed_at: "2026-09-18T10:15:00Z",
    comments: [
      {
        id: 1,
        author_name: "Casey Reed",
        body: "Guard dropped on turn",
        created_at: "2026-09-18T10:20:00Z",
        after_lock: false,
      },
    ],
    changes: [],
  };

  const mockItem3: CandidateAssessmentItem = {
    id: 1003,
    item_name: "Yup Cha Gi (Side Kick)",
    korean_name: "옆차기",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    reason_required: false,
    can_clear: false,
    position: 3,
    required: true,
    display_range: "",
    requirement_notes: "Pivot on base foot, blade of foot strike",
    notation: "",
    result: "NOT_ASSESSED",
    result_display: "Not Assessed",
    assessor_name: "",
    assessed_at: null,
    comments: [],
    changes: [],
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10/assessments/101");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the single column run with band headers, rows and the mat bar", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    // Candidate header
    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(screen.getByText("KG-0264")).toBeVisible();
    expect(screen.getByText("Junior (9–12)")).toBeVisible();
    // The one way back: to the grading the candidate is in.
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Autumn Grading" })).toHaveAttribute(
      "href",
      "/gradings/10",
    );
    // The status pill also carries the start time, so match on the pill.
    expect(screen.getByTestId("caw-status-pill")).toHaveTextContent("In progress");

    // Mat bar carries the live count in place of the progress ledger
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.getByText("required assessed")).toBeVisible();
    expect(screen.getByText("1 met")).toBeVisible();
    expect(screen.getByText("1 not met")).toBeVisible();
    expect(screen.getByText("1 remaining")).toBeVisible();
    expect(screen.getByText("2 / 3").closest('[role="status"]')).not.toBeNull();

    // Each category has a sticky band header
    expect(screen.getByTestId("caw-cat-header-ETIQUETTE")).toBeVisible();
    expect(screen.getByTestId("caw-cat-header-KICKING")).toBeVisible();
    // A category has no Korean name of its own; its first item's must not
    // be borrowed for the whole band.
    expect(screen.getByTestId("caw-cat-header-KICKING")).not.toHaveTextContent("앞차기");

    // "Complete assessment" button is disabled because 1 required item remains
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeDisabled();
    expect(completeBtn).toHaveTextContent("Complete assessment (1 required remaining)");
  });

  // The syllabus screen shows a form's part as "Part 1 of 2"; scoring shows
  // the same wording in the range slot, not the raw "Chart notation: (...)."
  it("shows a form's chart notation as served wording while scoring", async () => {
    const formItem: CandidateAssessmentItem = {
      ...mockItem3,
      id: 1005,
      item_name: "Cho Geup Hyung",
      category: "FORM",
      category_display: "Forms",
      category_is_core: false,
      reason_required: false,
      can_clear: false,
      display_range: "",
      requirement_notes: "Chart notation: (1/2).",
      notation: "Part 1 of 2",
    };
    const items = [mockItem1, formItem];
    stubFetch(
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
          return jsonResponse(200, mockCandidate);
        }
        if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(items));
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, { count: 2, next: null, previous: null, results: items });
        }
        return jsonResponse(404, { detail: "Not found" });
      }),
    );

    render(<App />);

    expect(await screen.findByText("Cho Geup Hyung")).toBeVisible();
    expect(screen.getByText("Part 1 of 2")).toBeVisible();
    expect(screen.queryByText(/Chart notation/)).not.toBeInTheDocument();
    // Other requirement notes still print.
    expect(screen.getByText("Proper bow, respect for flags and instructors")).toBeVisible();
  });

  // The starting rank is the candidate's own snapshot. It used to come from a
  // substring search on the WKSA ID, whose first hit could be another student.
  it("shows the rank held at registration without searching for the student", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/students/")) {
        const otherStudent = { ...mockStudent, id: 2, wksa_id: "KG-02641", current_rank_name: "Red" };
        return jsonResponse(200, { count: 2, next: null, previous: null, results: [otherStudent, mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3] });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(screen.getByText("Yellow stripe")).toBeVisible();
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/students/"))).toBe(false);
  });

  // The completion review is its own route now, so it is reachable by a typed
  // URL rather than only through the scoring screen's gated button. It has to
  // refuse on its own rather than render an incomplete record.
  // A category with zero not-met is not necessarily all met: optional items may
  // legitimately be left unassessed, and saying "All met" would contradict the
  // item rows on the record about to be sealed.
  it("reports unassessed optional items rather than calling the category all met", async () => {
    const completedItemsAssessment: CandidateAssessment = {
      ...mockAssessment,
    };
    const allAssessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, {
          overall: {
            total: 3,
            required: 2,
            met: 2,
            not_met: 0,
            not_assessed: 1,
            required_met: 2,
            required_not_assessed: 0,
            all_required_assessed: true,
          },
          can_complete: true,
          categories: [
            {
              category: "ETIQUETTE",
              total: 2,
              required: 1,
              met: 1,
              not_met: 0,
              not_assessed: 1,
              required_met: 1,
              required_not_assessed: 0,
              all_required_assessed: true,
            },
          ],
        } satisfies CandidateAssessmentSummary);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [completedItemsAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, allAssessedItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // Etiquette is a core area, so it renders in the proof's core strip. Zero
    // not-met never implies every requirement was met: an optional item left
    // unassessed must say so rather than reading as a clean sweep.
    const cell = screen.getByTestId("acp-core-ETIQUETTE");
    expect(cell).toHaveTextContent("1 not assessed");
    expect(cell).toHaveTextContent("1 of 2 met");
  });

  // The rollup and the item rows are separate requests. If the rollup fails on
  // its own the screen must say so, not render every count as zero.
  // Comments carry positive observations as well as shortfalls (the
  // 2026-09-23 decision), so a comment on a MET requirement must appear on
  // the proof. The review this replaced rendered only the notes
  // attached to NOT_MET items, which made a praise note invisible at the last
  // moment it could be read and absent from the permanent record.
  it("renders every comment on the proof, not only on the failures", async () => {
    const metWithNote: CandidateAssessmentItem = {
      ...mockItem1,
      comments: [
        {
          id: 2,
          author_name: "Morgan Reed",
          body: "Bow was crisp and unhurried; best in the group.",
          created_at: "2026-09-18T10:20:00Z",
          after_lock: false,
        },
      ],
      changes: [],
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [metWithNote, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // The comment on the MET requirement is on the record, with its result and
    // the person who wrote it.
    const metNote = screen.getByTestId("acp-note-1001");
    expect(metNote).toHaveTextContent("Bow was crisp and unhurried");
    expect(metNote).toHaveTextContent("Met");
    expect(metNote).toHaveTextContent("Morgan Reed");

    // As is the comment on the NOT_MET one.
    expect(screen.getByTestId("acp-note-1002")).toHaveTextContent("Guard dropped on turn");
    expect(screen.getByTestId("acp-note-1002")).toHaveTextContent("Casey Reed");

    // The requirement with no comment contributes none.
    expect(screen.queryByTestId("acp-note-1003")).toBeNull();
  });

  it("puts every changed mark on the proof, with who changed it and why", async () => {
    const metWithNote: CandidateAssessmentItem = {
      ...mockItem1,
      comments: [
        {
          id: 3,
          author_name: "Master Park",
          body: "Confirmed on the recording.",
          created_at: "2026-09-19T09:00:00Z",
          after_lock: true,
        },
      ],
      changes: [
        {
          sequence: 1,
          from_result: "NOT_ASSESSED",
          from_result_display: "Not assessed",
          to_result: "NOT_MET",
          to_result_display: "Not met",
          changed_by_name: "Casey Reed",
          changed_at: "2026-09-18T10:00:00Z",
          reason: "",
          after_lock: false,
        },
        {
          sequence: 2,
          from_result: "NOT_MET",
          from_result_display: "Not met",
          to_result: "MET",
          to_result_display: "Met",
          changed_by_name: "Morgan Reed",
          changed_at: "2026-09-18T10:30:00Z",
          reason: "Repeated cleanly on the second attempt.",
          after_lock: false,
        },
      ],
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [metWithNote, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // The change after the first mark is on the record with its reason, who
    // made it, and the new mark; the first mark is not a change.
    const note = screen.getByTestId("acp-note-1001");
    expect(within(note).getByTestId("remark-change-1001-2")).toHaveTextContent(
      "Changed from Not met to Met: “Repeated cleanly on the second attempt.” — Morgan Reed",
    );
    expect(within(note).queryByTestId("remark-change-1001-1")).toBeNull();
    // A Master's remark after the lock says so; remarks read oldest first.
    expect(within(note).getByTestId("remark-comment-3")).toHaveTextContent("Master Park");
    expect(within(note).getByTestId("remark-comment-3")).toHaveTextContent("after the lock");
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((line) => line.dataset.testid),
    ).toEqual(["remark-change-1001-2", "remark-comment-3"]);
  });

  // A sealed record is the permanent document. It must show its seal and offer
  // no way to write to it — the assessment note is immutable after COMPLETED.
  // `grading_date` is a date-only string. Parsed as a timestamp it is read as
  // UTC midnight, so west of UTC the proof renders the day *before* the
  // grading — a permanent record misstating when it happened. This test runs
  // in America/Los_Angeles, where that off-by-one shows.
  it("renders a date-only grading date in local time, west of UTC", async () => {
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // mockSession.grading_date is 2026-10-15. UTC-midnight parsing would show
    // 14 Oct here. The date renders in both the identity block and the seal
    // line, so both must be right.
    expect(screen.getAllByText(/15 Oct 2026/)).toHaveLength(2);
    expect(screen.queryAllByText(/14 Oct 2026/)).toHaveLength(0);
  });
  it("shows a sealed record with its seal line applied and no write path", async () => {
    const sealed: CandidateAssessment = {
      ...mockAssessment,
      status: "COMPLETED",
      status_display: "Completed",
      completed_at: "2026-09-18T11:30:00Z",
      notes: "Strong throughout; guard discipline to revisit.",
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/site/"))
        return jsonResponse(200, { club_name: "Kuk Sool Won Testville", time_zone: "Europe/London" });
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [sealed] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    expect(screen.getByTestId("acp-stamp")).toHaveTextContent("Sealed");
    expect(screen.getByText(/^Kuk Sool Won Testville/, { selector: ".eyebrow--muted" })).toBeVisible();
    expect(screen.getByTestId("acp-seal-applied")).toBeVisible();
    expect(screen.getByTestId("acp-sealed-panel")).toBeVisible();

    // The assessment note is rendered as the record, not as an input.
    expect(screen.getByTestId("acp-sealed-note")).toHaveTextContent("Strong throughout; guard discipline to revisit.");
    expect(screen.queryByLabelText("Assessment note")).toBeNull();
    expect(screen.queryByTestId("confirm-complete-assessment-btn")).toBeNull();
    expect(screen.queryByTestId("acp-proofread-checkbox")).toBeNull();
  });

  it("offers a way back to correct a mark on a sealed record only while the session is open", async () => {
    const sealed: CandidateAssessment = {
      ...mockAssessment,
      status: "COMPLETED",
      status_display: "Completed",
      completed_at: "2026-09-18T11:30:00Z",
    };
    const proofItems = [mockItem1, mockItem2, { ...mockItem3, result: "MET" as const }];

    function sealedRecordFetch(sessionStatus: GradingSession["status"]) {
      return vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/")) {
          return jsonResponse(200, { ...mockSession, status: sessionStatus });
        }
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
          return jsonResponse(200, mockCandidate);
        }
        if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, {
            count: 1,
            next: null,
            previous: null,
            results: [{ ...sealed, marks_open: sessionStatus === "OPEN" }],
          });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
    }

    stubFetch(sealedRecordFetch("LOCKED"));
    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
    const lockedView = render(<App />);
    await screen.findByRole("heading", { name: "Assessment record" });
    expect(screen.queryByTestId("acp-correct-link")).toBeNull();
    lockedView.unmount();

    stubFetch(sealedRecordFetch("OPEN"));
    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
    render(<App />);
    const link = await screen.findByTestId("acp-correct-link");

    expect(link).toHaveAttribute("href", "/gradings/10/assessments/101");
  });

  describe("the history link on an assessment record", () => {
    function recordFetch(viewer: Record<string, unknown>) {
      const sealed: CandidateAssessment = {
        ...mockAssessment,
        status: "COMPLETED",
        status_display: "Completed",
        completed_at: "2026-09-18T11:30:00Z",
        marks_open: false,
        can_start: false,
      };
      const proofItems = [mockItem1, mockItem2, { ...mockItem3, result: "MET" as const }];
      return vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, viewer);
        if (url.includes("/api/gradings/sessions/10/"))
          return jsonResponse(200, { ...mockSession, status: "LOCKED", ...sessionServed("LOCKED") });
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
        if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, { count: 1, next: null, previous: null, results: [sealed] });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
    }

    it("opens that registration's history for someone who may read the audit log", async () => {
      stubFetch(recordFetch({ ...authUser, can_read_audit_log: true }));
      window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

      render(<App />);

      expect(await screen.findByTestId("acp-history-link")).toHaveAttribute("href", "/audit?subject=candidate:101");
    });

    it("is not offered to someone who may not", async () => {
      stubFetch(recordFetch({ ...authUser, can_read_audit_log: false }));
      window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

      render(<App />);

      await screen.findByRole("heading", { name: "Assessment record" });
      expect(screen.queryByTestId("acp-history-link")).toBeNull();
    });
  });

  describe("downloading a sealed record", () => {
    function recordFetch(candidate: Record<string, unknown>, exported: () => Response) {
      const sealed: CandidateAssessment = {
        ...mockAssessment,
        status: "COMPLETED",
        status_display: "Completed",
        completed_at: "2026-09-18T11:30:00Z",
        marks_open: false,
        can_start: false,
      };
      const proofItems = [mockItem1, mockItem2, { ...mockItem3, result: "MET" as const }];
      const fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/exports/records/") && init?.method === "POST") return exported();
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/"))
          return jsonResponse(200, { ...mockSession, status: "LOCKED", ...sessionServed("LOCKED") });
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url))
          return jsonResponse(200, { ...mockCandidate, ...candidate });
        if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, { count: 1, next: null, previous: null, results: [sealed] });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, { count: 3, next: null, previous: null, results: proofItems });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
      return fetch;
    }
    const madePdf = () =>
      new Response("%PDF", {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            "attachment; filename*=utf-8''2027-03-20%20Autumn%20Grading%20%E2%80%93%20Record%20%E2%80%93%20Alex%20Carter.pdf",
        },
      });

    beforeEach(() => mockSaveFile.mockReset());

    it("saves this candidate's record as a PDF under the server's name", async () => {
      const fetch = recordFetch({ can_download_record: true }, madePdf);
      stubFetch(fetch);
      window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
      const user = userEvent.setup();

      render(<App />);
      await user.click(await screen.findByRole("button", { name: "Download PDF" }));

      expect(await screen.findByText("2027-03-20 Autumn Grading – Record – Alex Carter.pdf")).toBeVisible();
      expect(mockSaveFile).toHaveBeenCalledWith(
        expect.anything(),
        "2027-03-20 Autumn Grading – Record – Alex Carter.pdf",
      );
      const [, init] = fetch.mock.calls.find(([url]) => String(url).includes("/exports/records/"))!;
      expect(JSON.parse(String(init.body))).toEqual({ candidates: [101] });
    });

    it("says why when the record cannot be downloaded", async () => {
      stubFetch(
        recordFetch({ can_download_record: true }, () =>
          jsonResponse(400, {
            error: {
              code: "invalid",
              message: "Invalid input.",
              fields: { "101": ["Their assessment is not sealed yet."] },
            },
          }),
        ),
      );
      window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
      const user = userEvent.setup();

      render(<App />);
      await user.click(await screen.findByRole("button", { name: "Download PDF" }));

      const refusal = await screen.findByTestId("pdf-refusal");
      expect(refusal).toHaveTextContent("Alex Carter: Their assessment is not sealed yet.");
      expect(mockSaveFile).not.toHaveBeenCalled();
    });

    it("is not offered until the server says the record can be downloaded", async () => {
      stubFetch(recordFetch({ can_download_record: false }, madePdf));
      window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

      render(<App />);

      await screen.findByRole("heading", { name: "Assessment record" });
      expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    });
  });

  // A scored requirement in any category belongs on the permanent record.
  // Rendering only Techniques and Forms would silently drop a Weapons or Other
  // requirement that was actually assessed during the grading.
  it("gives every non-core category its own ledger on the proof", async () => {
    const weaponsItem: CandidateAssessmentItem = {
      ...mockItem3,
      id: 1004,
      item_name: "Jung Bong basics",
      korean_name: "중봉",
      category: "WEAPONS",
      category_display: "Weapons",
      category_is_core: false,
      reason_required: true,
      can_clear: true,
      position: 4,
      display_range: "1–5",
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:25:00Z",
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    // A form's part lives in its chart notation, served as wording.
    const formItem: CandidateAssessmentItem = {
      ...mockItem3,
      id: 1005,
      item_name: "Cho Geup Hyung",
      korean_name: "",
      category: "FORM",
      category_display: "Forms",
      category_is_core: false,
      reason_required: true,
      can_clear: true,
      position: 5,
      display_range: "",
      requirement_notes: "Chart notation: (1/2).",
      notation: "Part 1 of 2",
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:30:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3, weaponsItem, formItem];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(proofItems));
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, { count: 5, next: null, previous: null, results: proofItems });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // Weapons is not a core area, so it gets its own ledger under its served
    // display name rather than being dropped.
    const weapons = screen.getByTestId("acp-ledger-WEAPONS");
    expect(weapons).toHaveTextContent("Jung Bong basics");
    expect(weapons).toHaveTextContent("1–5");
    expect(screen.getByRole("heading", { name: "Weapons" })).toBeVisible();

    // The form's part shows where a range does, never as the raw seed text.
    const forms = screen.getByTestId("acp-ledger-FORM");
    expect(forms).toHaveTextContent("Part 1 of 2");
    expect(forms).not.toHaveTextContent("Chart notation");

    // Kicking is a core area and stays in the strip, not in a ledger.
    expect(screen.getByTestId("acp-core-KICKING")).toBeVisible();
    expect(screen.queryByTestId("acp-ledger-KICKING")).toBeNull();
  });
  it("reports a failed rollup instead of rendering zero counts", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(500, { detail: "Server error" });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    expect(await screen.findByTestId("caw-failed", {}, { timeout: 5000 })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("scoring is paused");
    expect(screen.queryByTestId("caw-complete-assessment-btn")).toBeNull();
    expect(screen.queryByText("0 / 0")).toBeNull();
  });

  // The served rollup is only refetched once a score settles, so mid-PATCH
  // `stats` still describes the pre-edit assessment. Clearing the last required
  // result must not leave the completion route reachable in that window.
  it("locks completion while a score change is still in flight", async () => {
    const user = userEvent.setup();
    const scoredItems = [mockItem1, mockItem2, { ...mockItem3, result: "MET" as const }];
    let resolvePatch: ((value: Response) => void) | undefined;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        // Never settles: holds the screen in the in-flight window under test.
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor(scoredItems));
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: scoredItems,
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeEnabled();

    await user.click(screen.getByTestId("btn-clear-1001"));
    await user.type(screen.getByTestId("caw-reason-input-1001"), "Wrong item.{Enter}");

    await waitFor(() => expect(completeBtn).toBeDisabled());
    expect(completeBtn).toHaveTextContent("Saving…");

    resolvePatch?.(jsonResponse(200, { ...mockItem1, result: "NOT_ASSESSED" }) as Response);
  });
  describe("comments on an item", () => {
    function commentMock(refuse = false) {
      const items: CandidateAssessmentItem[] = [mockItem1, mockItem2, mockItem3];
      const posts: string[] = [];
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
        if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor(items));
        if (/assessment-items\/(\d+)\/comments\/$/.test(url) && init?.method === "POST") {
          const body = JSON.parse(String(init.body)).body as string;
          posts.push(body);
          if (refuse) {
            return jsonResponse(400, {
              error: { code: "validation_error", message: "Items can only be commented on in an open session." },
            });
          }
          const comment = {
            id: 900 + posts.length,
            author_name: "Lee Coach",
            body,
            created_at: "2026-09-18T11:00:00Z",
            after_lock: false,
          };
          const id = Number(url.match(/assessment-items\/(\d+)\//)?.[1]);
          const at = items.findIndex((item) => item.id === id);
          items[at] = { ...items[at], comments: [...items[at].comments, comment] };
          return jsonResponse(201, comment);
        }
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, { count: 3, next: null, previous: null, results: items });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
      stubFetch(fetchMock);
      return { posts };
    }

    describe("who may comment", () => {
      function stateMock(options: {
        assessment?: Partial<CandidateAssessment>;
        session?: Partial<GradingSession>;
        candidate?: Partial<typeof mockCandidate>;
      }) {
        const posts: string[] = [];
        stubFetch(
          vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (/assessment-items\/(\d+)\/comments\/$/.test(url) && init?.method === "POST") {
              const body = JSON.parse(String(init.body)).body as string;
              posts.push(body);
              return jsonResponse(201, { id: 901, author_name: "Lee Coach", body, created_at: "2026-09-18T11:00:00Z" });
            }
            if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
            if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
            if (url.includes("/api/gradings/sessions/10/")) {
              return jsonResponse(200, { ...mockSession, ...options.session });
            }
            if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
              return jsonResponse(200, { ...mockCandidate, ...options.candidate });
            }
            if (url.includes("/summary/"))
              return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
            if (url.includes("/api/gradings/assessments/")) {
              return jsonResponse(200, {
                count: 1,
                next: null,
                previous: null,
                results: [{ ...mockAssessment, ...options.assessment }],
              });
            }
            if (url.includes("/api/gradings/assessment-items/")) {
              return jsonResponse(200, {
                count: 3,
                next: null,
                previous: null,
                results: [mockItem1, mockItem2, mockItem3],
              });
            }
            return jsonResponse(404, { detail: "Not found" });
          }),
        );
        return { posts };
      }

      it("lets a reviewer comment on a completed assessment while the session is open", async () => {
        const { posts } = stateMock({ assessment: { status: "COMPLETED", status_display: "Completed" } });
        const user = userEvent.setup();
        render(<App />);
        await screen.findByRole("heading", { name: "Alex Carter" });

        await user.click(screen.getByTestId("btn-comment-1003"));
        await user.type(screen.getByTestId("caw-comment-input-1003"), "Seen again on review.{Enter}");

        await waitFor(() => expect(posts).toEqual(["Seen again on review."]));
      });

      it.each([
        [
          "the session is locked",
          {
            session: { status: "LOCKED" as const, status_display: "Locked" },
            assessment: { status: "COMPLETED" as const, status_display: "Completed" },
          },
        ],
        [
          "the assessment has not been started",
          { assessment: { status: "NOT_STARTED" as const, status_display: "Not started", marks_open: false } },
        ],
        [
          "the candidate has withdrawn",
          {
            candidate: { status: "WITHDRAWN" as const },
            assessment: { status: "COMPLETED" as const, status_display: "Completed" },
          },
        ],
      ])("offers no comment box when %s", async (_why, options) => {
        stateMock({ ...options, assessment: { marks_open: false, ...options.assessment } });
        render(<App />);
        await screen.findByRole("heading", { name: "Alex Carter" });

        expect(screen.queryByTestId("btn-comment-1001")).toBeNull();
      });

      it.each([
        [true, "offers"],
        [false, "does not offer"],
      ])("with can_delete %s, %s Delete assessment: the server decides", async (canDelete) => {
        // A final decision is never erased, so the server says false once one is recorded.
        stateMock({ assessment: { can_delete: canDelete } });
        render(<App />);
        await screen.findByRole("heading", { name: "Alex Carter" });

        expect(screen.queryByTestId("caw-delete-assessment-btn") !== null).toBe(canDelete);
      });

      it("holds the text still while a comment is saving, so nothing typed meanwhile is lost", async () => {
        let release: ((response: Response) => void) | undefined;
        stubFetch(
          vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (/assessment-items\/(\d+)\/comments\/$/.test(url) && init?.method === "POST") {
              return new Promise<Response>((resolve) => {
                release = resolve;
              });
            }
            if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
            if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
            if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
            if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
            if (url.includes("/summary/"))
              return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
            if (url.includes("/api/gradings/assessments/")) {
              return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
            }
            if (url.includes("/api/gradings/assessment-items/")) {
              return jsonResponse(200, {
                count: 3,
                next: null,
                previous: null,
                results: [mockItem1, mockItem2, mockItem3],
              });
            }
            return jsonResponse(404, { detail: "Not found" });
          }),
        );
        const user = userEvent.setup();
        render(<App />);
        await screen.findByRole("heading", { name: "Alex Carter" });

        await user.click(screen.getByTestId("btn-comment-1003"));
        const box = screen.getByTestId("caw-comment-input-1003");
        await user.type(box, "Sent text");
        await user.click(screen.getByTestId("btn-comment-save-1003"));
        await waitFor(() => expect(box).toHaveAttribute("readonly"));
        await user.type(box, " typed while saving");

        expect(box).toHaveValue("Sent text");
        release?.(
          jsonResponse(201, {
            id: 901,
            author_name: "Lee Coach",
            body: "Sent text",
            created_at: "2026-09-18T11:00:00Z",
            after_lock: false,
          }) as Response,
        );
        await waitFor(() => expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull());
      });
    });

    it("adds a comment on purpose and shows it with who wrote it", async () => {
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "Pivot was late but clean.");
      await user.click(screen.getByTestId("btn-comment-save-1003"));

      expect(await screen.findByText(/Pivot was late but clean\./)).toBeVisible();
      expect(within(screen.getByTestId("caw-item-1003")).getByText(/Lee Coach/)).toBeVisible();
      expect(posts).toEqual(["Pivot was late but clean."]);
      expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull();
    });

    it("lets a second person add a comment to a marked item that already has one, and keeps the mark", async () => {
      // 1002 is Not met, marked by casey, with casey's comment already on it.
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const row = screen.getByTestId("caw-item-1002");
      expect(within(row).getByText(/Guard dropped on turn/)).toBeVisible();

      await user.click(screen.getByTestId("btn-comment-1002"));
      await user.type(screen.getByTestId("caw-comment-input-1002"), "Also lost balance on the landing.{Enter}");

      // Both observations stand, each with who wrote it.
      expect(await within(row).findByText(/Also lost balance on the landing\./)).toBeVisible();
      expect(within(row).getByText(/Guard dropped on turn/)).toBeVisible();
      expect(within(row).getByText(/Casey Reed/)).toBeVisible();
      expect(within(row).getByText(/Lee Coach/)).toBeVisible();
      // The comment did not touch the mark or who made it.
      expect(posts).toEqual(["Also lost balance on the landing."]);
      expect(screen.getByTestId("btn-not-met-1002")).toHaveAttribute("aria-pressed", "true");
      // The chosen mark carries its tone, so it is drawn red, not as a plain pressed button.
      expect(screen.getByTestId("btn-not-met-1002")).toHaveAttribute("data-tone", "danger");
      expect(screen.getByTestId("btn-met-1002")).not.toHaveAttribute("data-tone");
      expect(row).toHaveTextContent("KSN Casey Lane");
    });

    it("adds nothing when the box is left or dismissed without saving", async () => {
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "Half a thought");
      // Leaving the box saves nothing and keeps what was typed.
      await user.click(screen.getByRole("heading", { name: "Alex Carter" }));
      expect(posts).toEqual([]);
      expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("Half a thought");

      // Escape inside the box drops the draft without saving it.
      await user.click(screen.getByTestId("caw-comment-input-1003"));
      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull();
      await user.click(screen.getByTestId("btn-comment-1003"));
      expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("");
      expect(posts).toEqual([]);
    });

    it("saves the comment when Enter is pressed, and Shift+Enter starts a new line", async () => {
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "Line one{Shift>}{Enter}{/Shift}Line two");
      expect(posts).toEqual([]);
      expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("Line one\nLine two");

      await user.keyboard("{Enter}");

      await waitFor(() => expect(posts).toEqual(["Line one\nLine two"]));
      expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull();
    });

    it("does nothing on Enter when the comment is empty", async () => {
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "{Enter}{Enter}");

      expect(posts).toEqual([]);
      expect(screen.getByTestId("caw-comment-input-1003")).toBeVisible();
    });

    it("on a phone, Enter adds a new line and only the button saves", async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      try {
        const { posts } = commentMock();
        const user = userEvent.setup();
        render(<App />);
        await screen.findByRole("heading", { name: "Alex Carter" });

        await user.click(screen.getByTestId("btn-comment-1003"));
        await user.type(screen.getByTestId("caw-comment-input-1003"), "First{Enter}Second");

        expect(posts).toEqual([]);
        expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("First\nSecond");

        await user.click(screen.getByTestId("btn-comment-save-1003"));

        await waitFor(() => expect(posts).toEqual(["First\nSecond"]));
      } finally {
        window.matchMedia = original;
      }
    });

    it("does not refetch the items while scores are still saving, so a comment cannot undo a score", async () => {
      let releasePatch: ((response: Response) => void) | undefined;
      let itemFetches = 0;
      stubFetch(
        vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (/assessment-items\/1003\/$/.test(url) && init?.method === "PATCH") {
            return new Promise<Response>((resolve) => {
              releasePatch = resolve;
            });
          }
          if (/assessment-items\/(\d+)\/comments\/$/.test(url) && init?.method === "POST") {
            const body = JSON.parse(String(init.body)).body as string;
            return jsonResponse(201, { id: 901, author_name: "Lee Coach", body, created_at: "2026-09-18T11:00:00Z" });
          }
          if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
          if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
          if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
          if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
          if (url.includes("/summary/"))
            return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
          if (url.includes("/api/gradings/assessments/")) {
            return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
          }
          if (url.includes("/api/gradings/assessment-items/")) {
            itemFetches += 1;
            // The server has not seen the score yet: item 1003 is still unmarked.
            return jsonResponse(200, {
              count: 3,
              next: null,
              previous: null,
              results: [mockItem1, mockItem2, mockItem3],
            });
          }
          return jsonResponse(404, { detail: "Not found" });
        }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const fetchesBefore = itemFetches;

      await user.click(screen.getByTestId("btn-met-1003"));
      await waitFor(() => expect(releasePatch).toBeDefined());
      await user.click(screen.getByTestId("btn-comment-1002"));
      await user.type(screen.getByTestId("caw-comment-input-1002"), "Noted while saving.{Enter}");
      expect(await screen.findByText(/Noted while saving\./)).toBeVisible();

      expect(itemFetches).toBe(fetchesBefore);
      expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("data-tone", "success");

      releasePatch?.(jsonResponse(200, { ...mockItem3, result: "MET", result_display: "Met" }) as Response);
      await waitFor(() => expect(itemFetches).toBeGreaterThan(fetchesBefore));
    });

    it("will not save an empty comment", async () => {
      commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      expect(screen.getByTestId("btn-comment-save-1003")).toBeDisabled();
      await user.type(screen.getByTestId("caw-comment-input-1003"), "   ");

      expect(screen.getByTestId("btn-comment-save-1003")).toBeDisabled();
    });

    it("says why when a comment is refused, and keeps what was typed", async () => {
      const { posts } = commentMock(true);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "A long, careful observation.");
      await user.click(screen.getByTestId("btn-comment-save-1003"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Items can only be commented on in an open session.");
      // Nothing is lost: the box is still open with the text, ready to correct or retry.
      expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("A long, careful observation.");
      expect(posts).toEqual(["A long, careful observation."]);
    });

    it("can retry a comment that failed, and then saves it once", async () => {
      let failures = 1;
      const posts: string[] = [];
      const base = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/assessment-items\/(\d+)\/comments\/$/.test(url) && init?.method === "POST") {
          const body = JSON.parse(String(init.body)).body as string;
          posts.push(body);
          if (failures-- > 0)
            return jsonResponse(500, { error: { code: "server_error", message: "Something went wrong." } });
          return jsonResponse(201, { id: 901, author_name: "Lee Coach", body, created_at: "2026-09-18T11:00:00Z" });
        }
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
        if (url.includes("/summary/"))
          return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
        if (url.includes("/api/gradings/assessments/")) {
          return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, {
            count: 3,
            next: null,
            previous: null,
            results: [mockItem1, mockItem2, mockItem3],
          });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
      stubFetch(base);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "Worth keeping.");
      await user.click(screen.getByTestId("btn-comment-save-1003"));
      await screen.findByRole("alert");
      expect(screen.getByTestId("caw-comment-input-1003")).toHaveValue("Worth keeping.");

      await user.click(screen.getByTestId("btn-comment-save-1003"));

      await waitFor(() => expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull());
      expect(posts).toEqual(["Worth keeping.", "Worth keeping."]);
    });

    it("saves once however many times Enter is pressed while it is saving", async () => {
      const { posts } = commentMock();
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-comment-1003"));
      await user.type(screen.getByTestId("caw-comment-input-1003"), "Once only.");
      await user.keyboard("{Enter}{Enter}{Enter}");

      await waitFor(() => expect(screen.queryByTestId("caw-comment-input-1003")).toBeNull());
      expect(posts).toEqual(["Once only."]);
    });
  });

  // The rollup is served, not recounted here. The summary below
  // deliberately disagrees with the items so a client-side recount would give
  // a visibly different answer.
  it("renders served counts rather than recounting the item rows", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, {
          overall: {
            total: 9,
            required: 7,
            met: 5,
            not_met: 1,
            not_assessed: 3,
            required_met: 5,
            required_not_assessed: 1,
            all_required_assessed: false,
          },
          can_complete: false,
          categories: [],
        } satisfies CandidateAssessmentSummary);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // Served: 6 of 7 required assessed. Recounting the three rows would say 2 of 3.
    expect(screen.getByText("6 / 7")).toBeVisible();
    expect(screen.getByText("5 met")).toBeVisible();
    expect(screen.getByText("1 not met")).toBeVisible();
    expect(screen.getByText("1 remaining")).toBeVisible();

    // Completion stays locked on the server's all_required_assessed, not on a
    // local tally of the rows that happen to be loaded.
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeDisabled();
    expect(completeBtn).toHaveTextContent("Complete assessment (1 required remaining)");
  });

  it("refuses the completion review route while required items remain unassessed", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    expect(await screen.findByTestId("caw-review-unavailable")).toBeVisible();
    expect(screen.getByText(/1 required item remains unassessed/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Assessment record" })).toBeNull();
    expect(screen.getByRole("link", { name: /Return to scoring/ })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/101",
    );
  });

  // Several item saves can be in flight at once. Each PATCH is held
  // until the test releases it, and the "server" keeps the saved state, so a
  // refetch shows what was really stored.
  // `withCounts`: a save answers with the assessment's counts as it left them,
  // as the real server now does; off, it answers with the item alone.
  function scoringServer(initial: CandidateAssessmentItem[], withCounts = false) {
    const items = new Map(initial.map((item) => [item.id, { ...item }]));
    const pending: {
      itemId: number;
      result: string;
      reason: string | undefined;
      save: () => void;
      refuse: () => void;
    }[] = [];
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const write = url.match(/\/api\/gradings\/assessment-items\/(\d+)\/$/);
      if (write && init?.method === "PATCH") {
        const itemId = Number(write[1]);
        const body = JSON.parse(String(init.body)) as {
          result: CandidateAssessmentItemResult;
          reason?: string;
        };
        return new Promise<Response>((respond) => {
          pending.push({
            itemId,
            result: body.result,
            reason: body.reason,
            save: () => {
              const saved = itemSaved(items.get(itemId)!, body.result);
              items.set(itemId, saved);
              respond(
                jsonResponse(
                  200,
                  withCounts ? { ...saved, assessment_summary: assessmentSummaryFor([...items.values()]) } : saved,
                ),
              );
            },
            refuse: () => respond(jsonResponse(400, { error: { code: "validation_error", message: "Refused." } })),
          });
        });
      }
      if (url.includes("/api/auth/me/")) return Promise.resolve(jsonResponse(200, authUser));
      if (url.includes("/api/choices/")) return Promise.resolve(jsonResponse(200, CHOICES));
      if (url.includes("/api/gradings/sessions/10/")) return Promise.resolve(jsonResponse(200, mockSession));
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return Promise.resolve(jsonResponse(200, mockCandidate));
      }
      const current = [...items.values()];
      if (url.includes("/summary/")) return Promise.resolve(jsonResponse(200, assessmentSummaryFor(current)));
      if (url.includes("/api/gradings/assessments/")) {
        return Promise.resolve(jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] }));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return Promise.resolve(
          jsonResponse(200, { count: current.length, next: null, previous: null, results: current }),
        );
      }
      return Promise.resolve(jsonResponse(404, { detail: "Not found" }));
    });
    return { fetchMock, pending };
  }

  // An item with no mark yet, so the first mark needs no reason.
  const unmarked = (item: CandidateAssessmentItem): CandidateAssessmentItem =>
    itemServed({
      ...item,
      result: "NOT_ASSESSED",
      result_display: "Not Assessed",
      assessor_name: "",
      assessed_at: null,
    });

  it("rolls back only the item whose save failed", async () => {
    const server = scoringServer([unmarked(mockItem1), mockItem2, mockItem3]);
    stubFetch(server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-met-1001"));
    await user.click(screen.getByTestId("btn-met-1003"));
    await waitFor(() => expect(server.pending).toHaveLength(2));
    server.pending[0].refuse();

    await waitFor(() => expect(screen.getByTestId("btn-met-1001")).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("btn-not-met-1001")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "true");

    server.pending[1].save();
    await waitFor(() =>
      expect(server.fetchMock.mock.calls.filter(([url]) => String(url).includes("/summary/")).length).toBeGreaterThan(
        1,
      ),
    );
    expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("btn-met-1001")).toHaveAttribute("aria-pressed", "false");
  });

  it("sends a second change to the same item only after the first lands", async () => {
    const server = scoringServer([mockItem1, mockItem2, mockItem3]);
    stubFetch(server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-met-1003"));
    // The mark is already there as far as the screen goes, so changing it
    // asks why; the change waits for the first write to land.
    await user.click(screen.getByTestId("btn-not-met-1003"));
    await user.type(screen.getByTestId("caw-reason-input-1003"), "Changed my mind.{Enter}");
    await waitFor(() => expect(server.pending).toHaveLength(1));
    expect(server.pending[0].reason).toBeUndefined();
    // The reason stays on screen, held, until the server has the change.
    expect(screen.getByTestId("caw-reason-input-1003")).toHaveAttribute("readonly");

    server.pending[0].save();
    await waitFor(() => expect(server.pending).toHaveLength(2));
    expect(server.pending[1].result).toBe("NOT_MET");
    expect(server.pending[1].reason).toBe("Changed my mind.");
    server.pending[1].save();

    await waitFor(() => expect(screen.getByTestId("btn-not-met-1003")).toHaveAttribute("aria-pressed", "true"));
  });

  describe("changing a mark", () => {
    it("asks why before switching a mark, writes nothing until it is given, and sends it with the change", async () => {
      const server = scoringServer([mockItem1, mockItem2, mockItem3]);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      // 1001 is Met. Choosing Not met asks first.
      await user.click(screen.getByTestId("btn-not-met-1001"));
      const prompt = screen.getByTestId("caw-change-prompt-1001");
      expect(prompt).toHaveTextContent("Changing Met to Not met");
      expect(screen.getByTestId("btn-reason-save-1001")).toBeDisabled();
      expect(server.pending).toHaveLength(0);

      // Backing out writes nothing and leaves the mark alone.
      await user.click(screen.getByTestId("btn-reason-cancel-1001"));
      expect(screen.getByTestId("btn-met-1001")).toHaveAttribute("aria-pressed", "true");
      expect(server.pending).toHaveLength(0);

      await user.click(screen.getByTestId("btn-not-met-1001"));
      await user.type(screen.getByTestId("caw-reason-input-1001"), "Saw it again on review.");
      await user.click(screen.getByTestId("btn-reason-save-1001"));
      await waitFor(() => expect(server.pending).toHaveLength(1));
      expect(server.pending[0]).toMatchObject({ itemId: 1001, result: "NOT_MET", reason: "Saw it again on review." });
      server.pending[0].save();

      await waitFor(() => expect(screen.queryByTestId("caw-change-prompt-1001")).toBeNull());
      expect(screen.getByTestId("btn-not-met-1001")).toHaveAttribute("aria-pressed", "true");
    });

    it("asks why when an item is marked again after it was cleared", async () => {
      // 1003 was marked and then cleared: its next mark is a later change, so
      // the screen asks rather than sending a mark the server would refuse.
      const cleared: CandidateAssessmentItem = itemServed({
        ...mockItem3,
        changes: [
          {
            sequence: 1,
            from_result: "NOT_ASSESSED",
            from_result_display: "Not assessed",
            to_result: "MET",
            to_result_display: "Met",
            changed_by_name: "Casey Reed",
            changed_at: "2026-09-18T10:00:00Z",
            reason: "",
            after_lock: false,
          },
          {
            sequence: 2,
            from_result: "MET",
            from_result_display: "Met",
            to_result: "NOT_ASSESSED",
            to_result_display: "Not assessed",
            changed_by_name: "Casey Reed",
            changed_at: "2026-09-18T10:05:00Z",
            reason: "Wrong item.",
            after_lock: false,
          },
        ],
      });
      const server = scoringServer([mockItem1, mockItem2, cleared]);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-met-1003"));

      expect(screen.getByTestId("caw-change-prompt-1003")).toHaveTextContent("again, after it was cleared");
      expect(server.pending).toHaveLength(0);
      await user.type(screen.getByTestId("caw-reason-input-1003"), "The right item, now seen.{Enter}");
      await waitFor(() => expect(server.pending).toHaveLength(1));
      expect(server.pending[0]).toMatchObject({ itemId: 1003, result: "MET", reason: "The right item, now seen." });
    });

    it("keeps the reason, and says why, when the change is refused", async () => {
      const server = scoringServer([mockItem1, mockItem2, mockItem3]);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-not-met-1001"));
      await user.type(screen.getByTestId("caw-reason-input-1001"), "A careful reason.{Enter}");
      await waitFor(() => expect(server.pending).toHaveLength(1));
      server.pending[0].refuse();

      expect(await screen.findByRole("alert")).toHaveTextContent("Refused.");
      expect(screen.getByTestId("caw-reason-input-1001")).toHaveValue("A careful reason.");
      expect(screen.getByTestId("caw-reason-input-1001")).not.toHaveAttribute("readonly");
    });

    it("shows every change after the first, with who, when and why", async () => {
      const changed: CandidateAssessmentItem = {
        ...mockItem2,
        changes: [
          {
            sequence: 1,
            from_result: "NOT_ASSESSED",
            from_result_display: "Not assessed",
            to_result: "MET",
            to_result_display: "Met",
            changed_by_name: "Casey Reed",
            changed_at: "2026-09-18T10:00:00Z",
            reason: "",
            after_lock: false,
          },
          {
            sequence: 2,
            from_result: "MET",
            from_result_display: "Met",
            to_result: "NOT_MET",
            to_result_display: "Not met",
            changed_by_name: "Lee Coach",
            changed_at: "2026-09-19T09:30:00Z",
            reason: "Dropped the guard on the replay.",
            after_lock: false,
          },
        ],
      };
      const server = scoringServer([mockItem1, changed, mockItem3]);
      stubFetch(server.fetchMock);
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      const row = screen.getByTestId("caw-item-1002");
      expect(within(row).getByTestId("remark-change-1002-2")).toHaveTextContent(
        "Changed from Met to Not met: “Dropped the guard on the replay.” — Lee Coach",
      );
      // The first mark is the attribution already shown, not a "change".
      expect(within(row).queryByTestId("remark-change-1002-1")).toBeNull();
    });

    it("says so, and brings back the real mark, when another person marked the item first", async () => {
      const user = userEvent.setup();
      let fetchedItems = 0;
      stubFetch(
        vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === "PATCH") {
            return jsonResponse(400, { error: { code: "validation_error", message: "Say why the mark is changing." } });
          }
          if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
          if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
          if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
          if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
          if (url.includes("/summary/"))
            return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
          if (url.includes("/api/gradings/assessments/")) {
            return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
          }
          if (url.includes("/api/gradings/assessment-items/")) {
            fetchedItems += 1;
            // This screen loaded 1003 as unmarked; someone else has marked it since.
            const items =
              fetchedItems === 1
                ? [mockItem1, mockItem2, mockItem3]
                : [mockItem1, mockItem2, { ...mockItem3, result: "NOT_MET" as const, assessor_name: "PSBN Lee Moss" }];
            return jsonResponse(200, { count: 3, next: null, previous: null, results: items });
          }
          return jsonResponse(404, { detail: "Not found" });
        }),
      );
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-met-1003"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Say why the mark is changing.");
      await waitFor(() => expect(screen.getByTestId("btn-not-met-1003")).toHaveAttribute("aria-pressed", "true"));
      expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "false");
    });

    it("finishing one item's change does not close the prompt open on another", async () => {
      const server = scoringServer([mockItem1, mockItem2, mockItem3]);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-not-met-1001"));
      await user.type(screen.getByTestId("caw-reason-input-1001"), "First.{Enter}");
      await waitFor(() => expect(server.pending).toHaveLength(1));
      // Move on to another item while the first is still being saved.
      await user.click(screen.getByTestId("btn-met-1002"));
      expect(screen.getByTestId("caw-change-prompt-1002")).toBeVisible();

      server.pending[0].save();
      await new Promise((settle) => setTimeout(settle, 100));

      expect(screen.getByTestId("caw-change-prompt-1002")).toBeVisible();
    });

    it("lets a completed assessment's mark be corrected with a reason", async () => {
      const completed = { ...mockAssessment, status: "COMPLETED" as const, status_display: "Completed" };
      const patches: Record<string, unknown>[] = [];
      stubFetch(
        vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === "PATCH") {
            patches.push(JSON.parse(String(init.body)));
            return jsonResponse(200, { ...mockItem1, result: "NOT_MET" });
          }
          if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
          if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
          if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
          if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
          if (url.includes("/summary/"))
            return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
          if (url.includes("/api/gradings/assessments/")) {
            return jsonResponse(200, { count: 1, next: null, previous: null, results: [completed] });
          }
          if (url.includes("/api/gradings/assessment-items/")) {
            return jsonResponse(200, {
              count: 3,
              next: null,
              previous: null,
              results: [mockItem1, mockItem2, mockItem3],
            });
          }
          return jsonResponse(404, { detail: "Not found" });
        }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-not-met-1001"));
      await user.type(screen.getByTestId("caw-reason-input-1001"), "Spotted on review.{Enter}");

      await waitFor(() => expect(patches).toEqual([{ result: "NOT_MET", reason: "Spotted on review." }]));
    });
  });

  describe("after the session is locked", () => {
    function lockedMock(marksOpen: boolean) {
      const patches: Record<string, unknown>[] = [];
      const completed = {
        ...mockAssessment,
        status: "COMPLETED" as const,
        status_display: "Completed",
        marks_open: marksOpen,
        can_start: false,
      };
      stubFetch(
        vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === "PATCH") {
            patches.push(JSON.parse(String(init.body)));
            return jsonResponse(200, { ...mockItem1, result: "NOT_MET" });
          }
          if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
          if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
          if (url.includes("/api/gradings/sessions/10/")) {
            return jsonResponse(200, {
              ...mockSession,
              status: "LOCKED",
              status_display: "Locked",
              ...sessionServed("LOCKED"),
            });
          }
          if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) return jsonResponse(200, mockCandidate);
          if (url.includes("/summary/"))
            return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
          if (url.includes("/api/gradings/assessments/")) {
            return jsonResponse(200, { count: 1, next: null, previous: null, results: [completed] });
          }
          if (url.includes("/api/gradings/assessment-items/")) {
            const served = [mockItem1, mockItem2, mockItem3].map((item) =>
              itemServed(item, { locked: true, completed: true }),
            );
            return jsonResponse(200, { count: 3, next: null, previous: null, results: served });
          }
          return jsonResponse(404, { detail: "Not found" });
        }),
      );
      return { patches };
    }

    it("lets the authorised Master correct a mark, saying why, and explains the rule", async () => {
      const { patches } = lockedMock(true);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      expect(screen.getByTestId("caw-locked-correction-note")).toHaveTextContent("authorised Master");
      await user.click(screen.getByTestId("btn-not-met-1001"));
      await user.type(screen.getByTestId("caw-reason-input-1001"), "Seen again on the recording.{Enter}");

      await waitFor(() => expect(patches).toEqual([{ result: "NOT_MET", reason: "Seen again on the recording." }]));
    });

    it("asks for a reason even for the first mark on an item left unmarked", async () => {
      const { patches } = lockedMock(true);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-met-1003"));

      expect(screen.getByTestId("caw-change-prompt-1003")).toBeVisible();
      expect(patches).toEqual([]);
    });

    it("shows no marking controls to anyone else", async () => {
      lockedMock(false);
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      expect(screen.queryByTestId("caw-locked-correction-note")).toBeNull();
      expect(screen.getByTestId("btn-met-1001")).toBeDisabled();
      expect(screen.getByTestId("btn-not-met-1001")).toBeDisabled();
      expect(screen.queryByTestId("btn-comment-1001")).toBeNull();
    });
  });

  describe("the counts a save brings back", () => {
    const summaryReads = (server: ReturnType<typeof scoringServer>) =>
      server.fetchMock.mock.calls.filter(([url]) => String(url).includes("/summary/")).length;

    it("uses them for a lone mark instead of asking for the counts again", async () => {
      const server = scoringServer([unmarked(mockItem1), mockItem2, mockItem3], true);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const readsBefore = summaryReads(server);

      await user.click(screen.getByTestId("btn-met-1001"));
      await waitFor(() => expect(server.pending).toHaveLength(1));
      server.pending[0].save();

      // The list is read again as before; the counts are not, and are right.
      await waitFor(() =>
        expect(
          server.fetchMock.mock.calls.filter(([url]) => String(url).includes("/assessment-items/?")).length,
        ).toBeGreaterThan(1),
      );
      await waitFor(() => expect(screen.getByTestId("btn-met-1001")).toHaveAttribute("aria-pressed", "true"));
      expect(summaryReads(server)).toBe(readsBefore);
    });

    it("reads them again when two marks overlapped, since the last answer may predate the other save", async () => {
      const server = scoringServer([unmarked(mockItem1), mockItem2, unmarked(mockItem3)], true);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const readsBefore = summaryReads(server);
      const listReads = () =>
        server.fetchMock.mock.calls.filter(([url]) => String(url).includes("/assessment-items/?")).length;
      const listBefore = listReads();

      await user.click(screen.getByTestId("btn-met-1001"));
      await user.click(screen.getByTestId("btn-met-1003"));
      await waitFor(() => expect(server.pending).toHaveLength(2));
      // Both answers land in the same moment: the last one still has to notice it is last.
      server.pending[0].save();
      server.pending[1].save();

      await waitFor(() => expect(summaryReads(server)).toBeGreaterThan(readsBefore));
      await waitFor(() => expect(listReads()).toBeGreaterThan(listBefore));
    });

    it("is not overwritten by an older read of the counts that was still on its way", async () => {
      const server = scoringServer([unmarked(mockItem1), unmarked(mockItem2), unmarked(mockItem3)], true);
      // From the first overlap on, a read of the counts is answered late, with
      // the counts as they were when it was asked.
      let holding = false;
      let release: (() => void) | undefined;
      stubFetch(
        vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const answer = server.fetchMock(input, init) as Promise<Response>;
          if (holding && String(input).includes("/summary/") && !release) {
            return new Promise<Response>((resolve) => {
              release = () => void answer.then(resolve);
            });
          }
          return answer;
        }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      holding = true;
      await user.click(screen.getByTestId("btn-met-1001"));
      await user.click(screen.getByTestId("btn-met-1003"));
      await waitFor(() => expect(server.pending).toHaveLength(2));
      server.pending[0].save();
      server.pending[1].save();
      // The overlap sends a read of the counts, which is now held back.
      await waitFor(() => expect(release).toBeDefined());

      // A lone mark is saved meanwhile, and its counts are the newest.
      await user.click(screen.getByTestId("btn-met-1002"));
      await waitFor(() => expect(server.pending).toHaveLength(3));
      server.pending[2].save();
      await waitFor(() => expect(screen.getByText("3 met")).toBeVisible());

      // The old read arrives at last, and must not put its two over the three.
      release?.();
      await new Promise((settle) => setTimeout(settle, 100));
      expect(screen.getByText("3 met")).toBeVisible();
    });

    it("reads them again when the save failed", async () => {
      const server = scoringServer([unmarked(mockItem1), mockItem2, mockItem3], true);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const readsBefore = summaryReads(server);

      await user.click(screen.getByTestId("btn-met-1001"));
      await waitFor(() => expect(server.pending).toHaveLength(1));
      server.pending[0].refuse();

      await waitFor(() => expect(summaryReads(server)).toBeGreaterThan(readsBefore));
    });

    it("reads them again from a server that answers with the item alone", async () => {
      const server = scoringServer([unmarked(mockItem1), mockItem2, mockItem3]);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });
      const readsBefore = summaryReads(server);

      await user.click(screen.getByTestId("btn-met-1001"));
      await waitFor(() => expect(server.pending).toHaveLength(1));
      server.pending[0].save();

      await waitFor(() => expect(summaryReads(server)).toBeGreaterThan(readsBefore));
    });

    it("keeps the item in the list free of the counts that came with it", async () => {
      const server = scoringServer([unmarked(mockItem1), mockItem2, mockItem3], true);
      stubFetch(server.fetchMock);
      const user = userEvent.setup();
      const { container } = render(<App />);
      await screen.findByRole("heading", { name: "Alex Carter" });

      await user.click(screen.getByTestId("btn-met-1001"));
      await waitFor(() => expect(server.pending).toHaveLength(1));
      server.pending[0].save();

      await waitFor(() => expect(screen.getByTestId("btn-met-1001")).toHaveAttribute("aria-pressed", "true"));
      expect(container.textContent).not.toContain("assessment_summary");
    });
  });

  it("holds completion until every item save has landed", async () => {
    const server = scoringServer([mockItem1, mockItem2, { ...mockItem3, result: "MET" }]);
    stubFetch(server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });
    const complete = screen.getByTestId("caw-complete-assessment-btn");
    await waitFor(() => expect(complete).toBeEnabled());

    await user.click(screen.getByTestId("btn-not-met-1001"));
    await user.type(screen.getByTestId("caw-reason-input-1001"), "First look was wrong.{Enter}");
    await user.click(screen.getByTestId("btn-met-1002"));
    await user.type(screen.getByTestId("caw-reason-input-1002"), "Second look was wrong.{Enter}");
    await waitFor(() => expect(server.pending).toHaveLength(2));
    server.pending[1].save();
    // Long enough for that save, and any refetch it triggers, to settle.
    await new Promise((settle) => setTimeout(settle, 150));
    expect(screen.getByTestId("btn-met-1002")).toHaveAttribute("aria-pressed", "true");
    expect(complete).toBeDisabled();

    server.pending[0].save();
    await waitFor(() => expect(complete).toBeEnabled());
  });

  it("updates item evaluation via segmented controls with immediate auto-save", async () => {
    let patchedItemId: number | null = null;
    let patchedBody: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/1003/") && init?.method === "PATCH") {
        patchedItemId = 1003;
        patchedBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...mockItem3,
          result: (patchedBody?.result as CandidateAssessmentItemResult) ?? "MET",
          assessor: authUser.id,
          assessor_name: `KSN ${authUser.full_name}`,
          assessed_at: "2026-09-18T10:20:00Z",
        });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // Item 1003 (Yup Cha Gi) is currently NOT_ASSESSED. Click "Met"
    const metBtn = screen.getByTestId("btn-met-1003");
    await user.click(metBtn);

    // Verify PATCH was made
    expect(patchedItemId).toBe(1003);
    expect(patchedBody).toEqual({ result: "MET" });
  });

  // The `candidate_item_assessor_matches_result` constraint nulls
  // `assessor` and `assessed_at` when a result returns to NOT_ASSESSED, and
  // that attribution cannot be restored. Clearing therefore asks for a reason
  // inline and names what it erases, instead of sitting as a third verdict
  // button; the change and the reason are kept.
  it("asks why before clearing, names the attribution it erases, and sends the reason", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse(200, { ...mockItem1, result: "NOT_ASSESSED" });
      }
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // There is no third verdict target: NOT_ASSESSED is an undo, not a peer.
    expect(screen.queryByTestId("btn-not-assessed-1001")).toBeNull();

    // Item 1003 is unassessed, so there is nothing to clear on it.
    expect(screen.queryByTestId("btn-clear-1003")).toBeNull();

    await user.click(screen.getByTestId("btn-clear-1001"));

    const prompt = screen.getByTestId("caw-change-prompt-1001");
    expect(prompt).toHaveTextContent("KSN Casey Lane");
    expect(prompt).toHaveTextContent("removes the record of who assessed it");
    expect(prompt).toHaveTextContent("The change and your reason are kept");
    expect(screen.getByTestId("btn-reason-save-1001")).toBeDisabled();
    expect(patches).toEqual([]);

    // Backing out writes nothing.
    await user.click(screen.getByTestId("btn-reason-cancel-1001"));
    expect(screen.queryByTestId("caw-change-prompt-1001")).toBeNull();
    expect(patches).toEqual([]);

    await user.click(screen.getByTestId("btn-clear-1001"));
    await user.type(screen.getByTestId("caw-reason-input-1001"), "Entered against the wrong item.");
    await user.click(screen.getByTestId("btn-reason-save-1001"));
    await waitFor(() =>
      expect(patches).toEqual([{ result: "NOT_ASSESSED", reason: "Entered against the wrong item." }]),
    );
  });

  // The previous screen showed assessor and time only on not-met rows, so
  // "who marked this, and when" was invisible across most of the record.
  // Opening the prompt unmounts the `Clear` button that was focused. If focus
  // is not moved deliberately it falls back to the document, dropping a
  // keyboard user out of a prompt they just opened.
  it("moves focus into the reason box and back out on cancel", async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-clear-1001"));

    // Focus lands in the reason box, not on the document.
    await waitFor(() => expect(screen.getByTestId("caw-reason-input-1001")).toHaveFocus());

    // Escape backs out, and focus returns to the control that opened it.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByTestId("btn-clear-1001")).toHaveFocus());
  });
  it("renders assessor attribution on met rows, not only on failures", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // 1001 is MET, 1002 is NOT_MET: both carry their assessor.
    expect(screen.getByTestId("caw-item-1001")).toHaveTextContent("KSN Casey Lane");
    expect(screen.getByTestId("caw-item-1002")).toHaveTextContent("KSN Casey Lane");
    // 1003 is unassessed, so it has no attribution to show.
    expect(screen.getByTestId("caw-item-1003")).not.toHaveTextContent("KSN Casey Lane");
  });

  // A COMPLETED assessment is corrected in place while the session is open (no
  // reopening), but never emptied: a required item cannot be cleared, which is
  // the affordance that would erase attribution. Comments stay open too.
  it("lets a completed assessment's marks be corrected but not cleared, and still lets people comment", async () => {
    const completed = { ...mockAssessment, status: "COMPLETED" as const, status_display: "Completed" };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [completed] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3].map((item) => itemServed(item, { completed: true })),
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    expect(screen.getByTestId("btn-met-1001")).toBeEnabled();
    expect(screen.getByTestId("btn-not-met-1001")).toBeEnabled();
    // Item 1001 is required, so a completed assessment cannot empty it.
    expect(screen.queryByTestId("btn-clear-1001")).toBeNull();
    expect(screen.getByTestId("btn-comment-1001")).toBeVisible();
    expect(screen.getByTestId("caw-view-review-btn")).toBeVisible();
  });
  it("renders every category in one continuous run, not behind a rail", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // No rail, no filtering: every requirement is in the same scroll, so all
    // three rows are on screen at once.
    expect(screen.getByText("Etiquette & Bowing")).toBeVisible();
    expect(screen.getByText("Ap Cha Gi (Front Kick)")).toBeVisible();
    expect(screen.getByText("Yup Cha Gi (Side Kick)")).toBeVisible();
    expect(screen.queryByTestId("caw-cat-tab-ETIQUETTE")).toBeNull();

    // Each band header carries its own progress, which is what the rail's
    // remaining-count badges were for.
    const etiquette = screen.getByTestId("caw-cat-header-ETIQUETTE");
    expect(etiquette).toHaveTextContent("Etiquette");
    expect(etiquette).toHaveTextContent("1 of 1 required");

    const kicking = screen.getByTestId("caw-cat-header-KICKING");
    expect(kicking).toHaveTextContent("1 of 2 required");
  });

  it("transitions to the completion proof and seals the record", async () => {
    // Assessment with all 3 items assessed (2 Met, 1 Not Met, 0 Not Assessed)
    const completedItemsAssessment: CandidateAssessment = {
      ...mockAssessment,
    };
    const allAssessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    let completedPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/501/") && init?.method === "PATCH") {
        completedPayload = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...completedItemsAssessment,
          status: "COMPLETED",
          status_display: "Completed",
          notes: (completedPayload?.notes as string) ?? "",
          completed_at: "2026-09-18T10:30:00Z",
        });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [completedItemsAssessment],
        });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, allAssessedItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, allAssessedItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // "Complete assessment" is ready and enabled
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeEnabled();
    expect(completeBtn).toHaveTextContent("Complete assessment");

    // Click to enter review mode
    await user.click(completeBtn);

    // The proof sheet renders as the document the record becomes
    expect(await screen.findByRole("heading", { name: "Assessment record" })).toBeVisible();
    expect(screen.getByTestId("acp-stamp")).toHaveTextContent("Unsealed draft");
    expect(screen.getByText("Alex Carter")).toBeVisible();
    expect(screen.getByTestId("acp-note-1002")).toHaveTextContent("Guard dropped on turn");

    // The seal line stays blank until the record is sealed.
    expect(screen.queryByTestId("acp-seal-applied")).toBeNull();
    expect(screen.getByText("Applied when the record is sealed")).toBeVisible();

    const notesInput = screen.getByLabelText("Assessment note");
    await user.type(notesInput, "Strong etiquette and balance, focus on guard discipline during spinning kicks.");

    // Sealing is gated on an explicit proofread acknowledgement.
    const confirmBtn = screen.getByTestId("confirm-complete-assessment-btn");
    expect(confirmBtn).toBeDisabled();
    await user.click(screen.getByTestId("acp-proofread-checkbox"));
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    // Verify completion payload
    await waitFor(() => {
      expect(completedPayload).toEqual({
        status: "COMPLETED",
        notes: "Strong etiquette and balance, focus on guard discipline during spinning kicks.",
      });
    });

    // Navigates back to session roster
    expect(window.location.pathname).toBe("/gradings/10");
  });

  // Completion review is a route now, so "Return to scoring" unmounts it. The
  // in-page review it replaced kept typed notes across that round trip, so the
  // draft has to outlive the unmount.
  it("keeps draft assessment notes when returning to scoring and back", async () => {
    const completedItemsAssessment: CandidateAssessment = {
      ...mockAssessment,
    };
    const allAssessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_name: `KSN ${authUser.full_name}`,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [completedItemsAssessment],
        });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, allAssessedItem3]));
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, allAssessedItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);

    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });
    await user.click(screen.getByTestId("caw-complete-assessment-btn"));

    await screen.findByRole("heading", { name: "Assessment record" });
    await user.type(screen.getByLabelText("Assessment note"), "Guard discipline needs work before the next grading.");

    // Back to scoring to correct something, then into the review again
    await user.click(screen.getByRole("link", { name: "Return to scoring" }));
    await screen.findByRole("heading", { name: "Alex Carter" });
    await user.click(screen.getByTestId("caw-complete-assessment-btn"));

    await screen.findByRole("heading", { name: "Assessment record" });
    expect(screen.getByLabelText("Assessment note")).toHaveValue(
      "Guard discipline needs work before the next grading.",
    );
  });

  it("handles NOT_STARTED assessment by offering start button", async () => {
    const notStartedAssessment: CandidateAssessment = {
      ...mockAssessment,
      status: "NOT_STARTED",
      status_display: "Not started",
      started_at: null,
      can_start: true,
    };

    let startPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/api/gradings/assessments/501/") && init?.method === "PATCH") {
        startPayload = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...notStartedAssessment,
          status: "IN_PROGRESS",
          status_display: "In progress",
          started_at: "2026-09-18T10:15:00Z",
        });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [notStartedAssessment],
        });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(
          200,
          assessmentSummaryFor([
            { ...mockItem1, result: "NOT_ASSESSED" },
            { ...mockItem2, result: "NOT_ASSESSED" },
            mockItem3,
          ]),
        );
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [
            { ...mockItem1, result: "NOT_ASSESSED", assessor: null, assessor_name: "", assessed_at: null },
            { ...mockItem2, result: "NOT_ASSESSED", assessor: null, assessor_name: "", assessed_at: null },
            mockItem3,
          ],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    stubFetch(fetchMock);
    const user = userEvent.setup();

    render(<App />);

    // Prompt banner is displayed
    expect(await screen.findByTestId("caw-not-started-banner")).toBeVisible();
    expect(screen.getByText("Assessment ready to begin")).toBeVisible();

    // Start assessment button
    const startBtn = screen.getByTestId("start-assessment-btn");
    await user.click(startBtn);

    expect(startPayload).toEqual({ status: "IN_PROGRESS" });
  });

  it.each(["DRAFT", "OPEN"] as const)(
    "prepares a missing assessment snapshot before offering start (%s)",
    async (sessionStatus) => {
      const draftSession = {
        ...mockSession,
        status: sessionStatus,
        status_display: sessionStatus === "DRAFT" ? "Draft" : "Open",
        candidate_count: 0,
        completed_assessment_count: 0,
        awaiting_decision_count: 0,
        ...sessionServed(sessionStatus),
        can_be_deleted: false,
        archived_at: null,
        can_be_archived: false,
        can_be_restored: false,
        can_download_summary: false,
        can_print_grading_sheets: false,
      } satisfies GradingSession;
      const generatedAssessment: CandidateAssessment = {
        ...mockAssessment,
        status: "NOT_STARTED",
        status_display: "Not started",
        started_at: null,
        can_start: sessionStatus === "OPEN",
      };
      let generationRequested = false;

      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, draftSession);
        if (url.includes("/api/gradings/candidates/101/generate-assessment/") && init?.method === "POST") {
          generationRequested = true;
          return jsonResponse(201, generatedAssessment);
        }
        if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
          // Served with the roster's own word on preparing a form.
          return jsonResponse(200, { ...mockCandidate, can_prepare_assessment: true });
        }
        if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
          return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
        }
        if (url.includes("/summary/")) {
          return jsonResponse(200, assessmentSummaryFor([mockItem1, mockItem2, mockItem3]));
        }
        if (url.includes("/api/gradings/assessment-items/")) {
          return jsonResponse(200, {
            count: 3,
            next: null,
            previous: null,
            results: [mockItem1, mockItem2, mockItem3],
          });
        }
        return jsonResponse(404, { detail: "Not found" });
      });
      stubFetch(fetchMock);
      const user = userEvent.setup();

      render(<App />);

      expect(await screen.findByTestId("caw-missing-assessment-banner")).toBeVisible();
      expect(screen.queryByTestId("caw-not-started-banner")).not.toBeInTheDocument();

      await user.click(screen.getByTestId("generate-assessment-btn"));

      await waitFor(() => expect(generationRequested).toBe(true));
      expect(await screen.findByTestId("caw-not-started-banner")).toBeVisible();
    },
  );
});
