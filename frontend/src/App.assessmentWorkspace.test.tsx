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
} from "./appTestSupport";

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
    can_be_deleted: false,
    notes: "",
  };

  const mockCandidate: GradingCandidate = {
    id: 101,
    session: 10,
    student: 1,
    student_display_name: "Alex Carter",
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
    status_display: "Active",
    current_grading: null,
  };

  const mockAssessment: CandidateAssessment = {
    id: 501,
    candidate: 101,
    candidate_student_name: "Alex Carter",
    status: "IN_PROGRESS",
    status_display: "In progress",
    generated_by_email: "casey@example.com",
    overall: assessmentSummaryFor([]).overall,
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
    position: 1,
    required: true,
    display_range: "",
    requirement_notes: "Proper bow, respect for flags and instructors",
    notation: "",
    result: "MET",
    result_display: "Met",
    assessor_email: "casey@example.com",
    assessed_at: "2026-09-18T10:10:00Z",
    assessor_notes: "",
  };

  const mockItem2: CandidateAssessmentItem = {
    id: 1002,
    item_name: "Ap Cha Gi (Front Kick)",
    korean_name: "앞차기",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    position: 2,
    required: true,
    display_range: "",
    requirement_notes: "Full chamber, ball of foot contact",
    notation: "",
    result: "NOT_MET",
    result_display: "Not Met",
    assessor_email: "casey@example.com",
    assessed_at: "2026-09-18T10:15:00Z",
    assessor_notes: "Guard dropped on turn",
  };

  const mockItem3: CandidateAssessmentItem = {
    id: 1003,
    item_name: "Yup Cha Gi (Side Kick)",
    korean_name: "옆차기",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    position: 3,
    required: true,
    display_range: "",
    requirement_notes: "Pivot on base foot, blade of foot strike",
    notation: "",
    result: "NOT_ASSESSED",
    result_display: "Not Assessed",
    assessor_email: "",
    assessed_at: null,
    assessor_notes: "",
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
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Candidate header
    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(screen.getByText("KG-0264")).toBeVisible();
    expect(screen.getByText("Junior (9–12)")).toBeVisible();
    // The status pill also carries the start time in 1A, so match on the pill.
    expect(screen.getByTestId("caw-status-pill")).toHaveTextContent("In progress");

    // Mat bar (FDR-042) carries the live count in place of the progress ledger
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.getByText("required assessed")).toBeVisible();
    expect(screen.getByText("1 met")).toBeVisible();
    expect(screen.getByText("1 not met")).toBeVisible();
    expect(screen.getByText("1 remaining")).toBeVisible();
    expect(screen.getByText("2 / 3").closest('[role="status"]')).not.toBeNull();

    // Sticky band headers replace the category sub-rail
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
      display_range: "",
      requirement_notes: "Chart notation: (1/2).",
      notation: "Part 1 of 2",
    };
    const items = [mockItem1, formItem];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

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
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
      }
      if (url.includes("/summary/")) {
        return jsonResponse(200, {
          overall: {
            total: 3, required: 2, met: 2, not_met: 0, not_assessed: 1,
            required_met: 2, required_not_assessed: 0, all_required_assessed: true,
          },
          categories: [
            {
              category: "ETIQUETTE",
              total: 2, required: 1, met: 1, not_met: 0, not_assessed: 1,
              required_met: 1, required_not_assessed: 0, all_required_assessed: true,
            },
          ],
        } satisfies CandidateAssessmentSummary);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [completedItemsAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3, next: null, previous: null,
          results: [mockItem1, mockItem2, allAssessedItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

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
  // FDR-043: `assessor_notes` carries positive observations as well as
  // shortfalls since the 2026-09-23 decision, so a note on a MET requirement
  // must appear on the proof. The review this replaced rendered only the notes
  // attached to NOT_MET items, which made a praise note invisible at the last
  // moment it could be read and absent from the permanent record.
  it("renders every recorded item note on the proof, not only the failures", async () => {
    const metWithNote: CandidateAssessmentItem = {
      ...mockItem1,
      assessor_notes: "Bow was crisp and unhurried; best in the group.",
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [metWithNote, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    // The note on the MET requirement is on the record, with its result.
    const metNote = screen.getByTestId("acp-note-1001");
    expect(metNote).toHaveTextContent("Bow was crisp and unhurried");
    expect(metNote).toHaveTextContent("Met");
    expect(metNote).toHaveTextContent("casey@example.com");

    // As is the note on the NOT_MET one.
    expect(screen.getByTestId("acp-note-1002")).toHaveTextContent("Guard dropped on turn");

    // The requirement with no note recorded contributes none.
    expect(screen.queryByTestId("acp-note-1003")).toBeNull();
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
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

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
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/site/")) return jsonResponse(200, { club_name: "Kuk Sool Won Testville" });
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
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    await screen.findByRole("heading", { name: "Assessment record" });

    expect(screen.getByTestId("acp-stamp")).toHaveTextContent("Sealed");
    expect(screen.getByText(/^Kuk Sool Won Testville/, { selector: ".acp-org" })).toBeVisible();
    expect(screen.getByTestId("acp-seal-applied")).toBeVisible();
    expect(screen.getByTestId("acp-sealed-panel")).toBeVisible();

    // The assessment note is rendered as the record, not as an input.
    expect(screen.getByTestId("acp-sealed-note")).toHaveTextContent(
      "Strong throughout; guard discipline to revisit.",
    );
    expect(screen.queryByLabelText("Assessment note")).toBeNull();
    expect(screen.queryByTestId("confirm-complete-assessment-btn")).toBeNull();
    expect(screen.queryByTestId("acp-proofread-checkbox")).toBeNull();
  });

  it("reopens a sealed record for correction only while the session is open", async () => {
    const sealed: CandidateAssessment = {
      ...mockAssessment,
      status: "COMPLETED",
      status_display: "Completed",
      completed_at: "2026-09-18T11:30:00Z",
    };
    const proofItems = [mockItem1, mockItem2, { ...mockItem3, result: "MET" as const }];

    function sealedRecordFetch(sessionStatus: GradingSession["status"]) {
      return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
        if (url.includes("/reopen/") && init?.method === "POST") {
          return jsonResponse(200, { ...sealed, status: "IN_PROGRESS", completed_at: null });
        }
        if (url.includes("/api/gradings/sessions/10/")) {
          return jsonResponse(200, { ...mockSession, status: sessionStatus });
        }
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
    }

    const lockedFetch = sealedRecordFetch("LOCKED");
    vi.stubGlobal("fetch", lockedFetch);
    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
    const lockedView = render(<App />);
    await screen.findByRole("heading", { name: "Assessment record" });
    expect(screen.queryByTestId("acp-reopen-btn")).toBeNull();
    lockedView.unmount();

    const openFetch = sealedRecordFetch("OPEN");
    vi.stubGlobal("fetch", openFetch);
    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("acp-reopen-btn"));

    await waitFor(() => {
      expect(
        openFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/gradings/assessments/501/reopen/") &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(window.location.pathname).toBe("/gradings/10/assessments/101"));
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
      position: 4,
      display_range: "1–5",
      result: "MET",
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:25:00Z",
    };
    const assessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_email: authUser.email,
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
      position: 5,
      display_range: "",
      requirement_notes: "Chart notation: (1/2).",
      notation: "Part 1 of 2",
      result: "MET",
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:30:00Z",
    };
    const proofItems = [mockItem1, mockItem2, assessedItem3, weaponsItem, formItem];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

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
          count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByTestId("caw-load-error", {}, { timeout: 5000 })).toBeVisible();
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
          count: 3, next: null, previous: null, results: scoredItems,
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeEnabled();

    await user.click(screen.getByTestId("btn-clear-1001"));
    await user.click(screen.getByTestId("btn-clear-confirm-1001"));

    await waitFor(() => expect(completeBtn).toBeDisabled());
    expect(completeBtn).toHaveTextContent("Saving...");

    resolvePatch?.(jsonResponse(200, { ...mockItem1, result: "NOT_ASSESSED" }) as Response);
  });
  // FDR-046: the rollup is served, not recounted here. The summary below
  // deliberately disagrees with the items so a client-side recount would give
  // a visibly different answer.
  it("renders served counts rather than recounting the item rows", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", fetchMock);

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

  // KG-A18: several item saves can be in flight at once. Each PATCH is held
  // until the test releases it, and the "server" keeps the saved state, so a
  // refetch shows what was really stored.
  function scoringServer(initial: CandidateAssessmentItem[]) {
    const items = new Map(initial.map((item) => [item.id, { ...item }]));
    const pending: { itemId: number; result: string; save: () => void; refuse: () => void }[] = [];
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const write = url.match(/\/api\/gradings\/assessment-items\/(\d+)\/$/);
      if (write && init?.method === "PATCH") {
        const itemId = Number(write[1]);
        const body = JSON.parse(String(init.body)) as { result: CandidateAssessmentItemResult };
        return new Promise<Response>((respond) => {
          pending.push({
            itemId,
            result: body.result,
            save: () => {
              const saved = { ...items.get(itemId)!, result: body.result };
              items.set(itemId, saved);
              respond(jsonResponse(200, saved));
            },
            refuse: () =>
              respond(jsonResponse(400, { error: { code: "validation_error", message: "Refused." } })),
          });
        });
      }
      if (url.includes("/api/auth/me/")) return Promise.resolve(jsonResponse(200, authUser));
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
        return Promise.resolve(jsonResponse(200, { count: current.length, next: null, previous: null, results: current }));
      }
      return Promise.resolve(jsonResponse(404, { detail: "Not found" }));
    });
    return { fetchMock, pending };
  }

  it("rolls back only the item whose save failed", async () => {
    const server = scoringServer([mockItem1, mockItem2, mockItem3]);
    vi.stubGlobal("fetch", server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-met-1002"));
    await user.click(screen.getByTestId("btn-met-1003"));
    await waitFor(() => expect(server.pending).toHaveLength(2));
    server.pending[0].refuse();

    await waitFor(() => expect(screen.getByTestId("btn-not-met-1002")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "true");

    server.pending[1].save();
    await waitFor(() => expect(server.fetchMock.mock.calls.filter(([url]) => String(url).includes("/summary/")).length).toBeGreaterThan(1));
    expect(screen.getByTestId("btn-met-1003")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("btn-not-met-1002")).toHaveAttribute("aria-pressed", "true");
  });

  it("sends a second change to the same item only after the first lands", async () => {
    const server = scoringServer([mockItem1, mockItem2, mockItem3]);
    vi.stubGlobal("fetch", server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-met-1003"));
    await user.click(screen.getByTestId("btn-not-met-1003"));
    await waitFor(() => expect(server.pending).toHaveLength(1));
    expect(screen.getByTestId("btn-not-met-1003")).toHaveAttribute("aria-pressed", "true");

    server.pending[0].save();
    await waitFor(() => expect(server.pending).toHaveLength(2));
    expect(server.pending[1].result).toBe("NOT_MET");
    server.pending[1].save();

    await waitFor(() =>
      expect(screen.getByTestId("btn-not-met-1003")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("holds completion until every item save has landed", async () => {
    const server = scoringServer([mockItem1, mockItem2, { ...mockItem3, result: "MET" }]);
    vi.stubGlobal("fetch", server.fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Alex Carter" });
    const complete = screen.getByTestId("caw-complete-assessment-btn");
    await waitFor(() => expect(complete).toBeEnabled());

    await user.click(screen.getByTestId("btn-not-met-1001"));
    await user.click(screen.getByTestId("btn-met-1002"));
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
          assessor_email: authUser.email,
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
    vi.stubGlobal("fetch", fetchMock);
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

  // FDR-045: the `candidate_item_assessor_matches_result` constraint nulls
  // `assessor` and `assessed_at` when a result returns to NOT_ASSESSED, and
  // that attribution cannot be restored. Clearing therefore confirms inline
  // and names what it erases, instead of sitting as a third verdict button.
  it("confirms a clear inline and names the attribution it erases", async () => {
    const user = userEvent.setup();
    let patchCount = 0;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patchCount += 1;
        return jsonResponse(200, { ...mockItem1, result: "NOT_ASSESSED" });
      }
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
          count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // There is no third verdict target: NOT_ASSESSED is an undo, not a peer.
    expect(screen.queryByTestId("btn-not-assessed-1001")).toBeNull();

    // Item 1003 is unassessed, so there is nothing to clear on it.
    expect(screen.queryByTestId("btn-clear-1003")).toBeNull();

    await user.click(screen.getByTestId("btn-clear-1001"));

    const confirm = screen.getByTestId("caw-clear-confirm-1001");
    expect(confirm).toHaveTextContent("casey@example.com");
    expect(confirm).toHaveTextContent("removes the record of who assessed it");
    expect(confirm).toHaveTextContent("that cannot be restored");
    expect(patchCount).toBe(0);

    // Backing out writes nothing.
    await user.click(within(confirm).getByRole("button", { name: "Keep" }));
    expect(screen.queryByTestId("caw-clear-confirm-1001")).toBeNull();
    expect(patchCount).toBe(0);

    await user.click(screen.getByTestId("btn-clear-1001"));
    await user.click(screen.getByTestId("btn-clear-confirm-1001"));
    await waitFor(() => expect(patchCount).toBe(1));
  });

  // The previous screen showed assessor and time only on not-met rows, so
  // "who marked this, and when" was invisible across most of the record.
  // Opening the confirmation unmounts the `Clear` button that was focused. If
  // focus is not moved deliberately it falls back to the document, dropping a
  // keyboard user out of a destructive prompt they just opened.
  it("moves focus into the clear confirmation and back out on cancel", async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
          count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    await user.click(screen.getByTestId("btn-clear-1001"));

    // Focus lands on the safe action, not on the document.
    const confirm = screen.getByTestId("caw-clear-confirm-1001");
    const keep = within(confirm).getByRole("button", { name: "Keep" });
    await waitFor(() => expect(keep).toHaveFocus());

    // Escape backs out, and focus returns to the control that opened it.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByTestId("btn-clear-1001")).toHaveFocus());
  });
  it("renders assessor attribution on met rows, not only on failures", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
          count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // 1001 is MET, 1002 is NOT_MET: both carry their assessor.
    expect(screen.getByTestId("caw-item-1001")).toHaveTextContent("casey@example.com");
    expect(screen.getByTestId("caw-item-1002")).toHaveTextContent("casey@example.com");
    // 1003 is unassessed, so it has no attribution to show.
    expect(screen.getByTestId("caw-item-1003")).not.toHaveTextContent("casey@example.com");
  });

  // A COMPLETED assessment is immutable: it must offer no way to score or to
  // clear, which is the affordance that would erase attribution.
  it("offers no scoring or clear affordance once the assessment is completed", async () => {
    const completed = { ...mockAssessment, status: "COMPLETED" as const, status_display: "Completed" };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
          count: 3, next: null, previous: null, results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    expect(screen.getByTestId("btn-met-1003")).toBeDisabled();
    expect(screen.getByTestId("btn-not-met-1003")).toBeDisabled();
    expect(screen.queryByTestId("btn-clear-1001")).toBeNull();
    expect(screen.queryByTestId("btn-note-1001")).toBeNull();
    expect(screen.getByTestId("caw-view-review-btn")).toBeVisible();
  });
  it("renders every category in one continuous run, not behind a rail", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

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

  it("transitions to the completion proof (SCR-027) and seals the record", async () => {
    // Assessment with all 3 items assessed (2 Met, 1 Not Met, 0 Not Assessed)
    const completedItemsAssessment: CandidateAssessment = {
      ...mockAssessment,
    };
    const allAssessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    let completedPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // "Complete assessment" is ready and enabled
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeEnabled();
    expect(completeBtn).toHaveTextContent("Complete assessment →");

    // Click to enter review mode
    await user.click(completeBtn);

    // The proof sheet renders as the document the record becomes (SCR-027)
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
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });
    await user.click(screen.getByTestId("caw-complete-assessment-btn"));

    await screen.findByRole("heading", { name: "Assessment record" });
    await user.type(
      screen.getByLabelText("Assessment note"),
      "Guard discipline needs work before the next grading.",
    );

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
    };

    let startPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
            { ...mockItem1, result: "NOT_ASSESSED", assessor: null, assessor_email: "", assessed_at: null },
            { ...mockItem2, result: "NOT_ASSESSED", assessor: null, assessor_email: "", assessed_at: null },
            mockItem3,
          ],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
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

  it.each(["DRAFT", "OPEN"] as const)("prepares a missing assessment snapshot before offering start (%s)", async (sessionStatus) => {
    const draftSession = {
      ...mockSession,
      status: sessionStatus,
      status_display: sessionStatus === "DRAFT" ? "Draft" : "Open",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
    } satisfies GradingSession;
    const generatedAssessment: CandidateAssessment = {
      ...mockAssessment,
      status: "NOT_STARTED",
      status_display: "Not started",
      started_at: null,
    };
    let generationRequested = false;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, draftSession);
      if (
        url.includes("/api/gradings/candidates/101/generate-assessment/") &&
        init?.method === "POST"
      ) {
        generationRequested = true;
        return jsonResponse(201, generatedAssessment);
      }
      if (/\/api\/gradings\/candidates\/\d+\/$/.test(url)) {
        return jsonResponse(200, mockCandidate);
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
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByTestId("caw-missing-assessment-banner")).toBeVisible();
    expect(screen.queryByTestId("caw-not-started-banner")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("generate-assessment-btn"));

    await waitFor(() => expect(generationRequested).toBe(true));
    expect(await screen.findByTestId("caw-not-started-banner")).toBeVisible();
  });
});
