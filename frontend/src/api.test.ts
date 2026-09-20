import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  bulkGenerateCandidateAssessments,
  bulkStartCandidateAssessments,
  bulkUpdateCandidateStatus,
  createManagedUser,
  getAllCandidateAssessmentItems,
  getAllGradingCandidates,
  getAuditEvents,
  getCurrentUser,
  getManagedUsers,
  loginUser,
  resetManagedUserPassword,
  updateManagedUser,
  updateManagedUserAuthority,
  withdrawLockedCandidate,
} from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function nonJsonResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API error envelope", () => {
  it("exposes per-field validation messages to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "The request contained invalid data.",
            fields: {
              title: ["This field may not be blank."],
              grading_date: ["This field is required."],
            },
          },
        }),
      ),
    );

    const error = await loginUser("a@example.com", "pw").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation_error");
    expect(error.messagesFor("title")).toEqual([
      "This field may not be blank.",
    ]);
    expect(error.messagesFor("grading_date")).toEqual([
      "This field is required.",
    ]);
  });

  it("returns an empty list for a field with no errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { code: "validation_error", message: "x", fields: {} },
        }),
      ),
    );

    const error = await loginUser("a@example.com", "pw").catch((e) => e);

    expect(error.messagesFor("anything")).toEqual([]);
  });

  it("surfaces serializer-level errors as non-field messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "Unable to log in with the provided credentials.",
            fields: {
              non_field_errors: [
                "Unable to log in with the provided credentials.",
              ],
            },
          },
        }),
      ),
    );

    const error = await loginUser("a@example.com", "wrong").catch((e) => e);

    expect(error.nonFieldMessages).toEqual([
      "Unable to log in with the provided credentials.",
    ]);
    // A lone message is promoted to `message`, so a toast needs no digging.
    expect(error.message).toBe(
      "Unable to log in with the provided credentials.",
    );
  });

  it("carries the code for permission errors and leaves fields undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: {
            code: "permission_denied",
            message: "Final grading decision authority is required.",
          },
        }),
      ),
    );

    const error = await getCurrentUser().catch((e) => e);

    expect(error.code).toBe("permission_denied");
    expect(error.fields).toBeUndefined();
    expect(error.messagesFor("anything")).toEqual([]);
  });

  it("falls back to a status message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(502)));

    const error = await getCurrentUser().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toBe("API request failed with status 502");
    expect(error.fields).toBeUndefined();
  });
});

describe("API pagination", () => {
  it("collects every page for complete workflow views", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("page=2")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: "http://localhost:8000/api/gradings/candidates/?page=1",
          results: [{ id: 2 }],
        });
      }
      return jsonResponse(200, {
        count: 2,
        next: "http://localhost:8000/api/gradings/candidates/?page=2",
        previous: null,
        results: [{ id: 1 }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await getAllGradingCandidates({ session: 10 });

    expect(response.results.map((candidate) => candidate.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("uses the shared page-size parameter for audit events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getAuditEvents({ page_size: 6 });

    expect(String(fetchMock.mock.calls[0][0])).toContain("page_size=6");
  });

  it("serialises audit browsing filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getAuditEvents({
      page: 2,
      action: "OUTCOME_FINALISED",
      entity_type: "CandidateOutcome",
      entity_id: "103",
      actor: "master-id",
      occurred_from: "2026-09-01",
      occurred_to: "2026-09-30",
      search: "Carlos Rivera",
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      action: "OUTCOME_FINALISED",
      entity_type: "CandidateOutcome",
      entity_id: "103",
      actor: "master-id",
      occurred_from: "2026-09-01",
      occurred_to: "2026-09-30",
      search: "Carlos Rivera",
    });
  });

  it("uses page pagination when collecting assessment items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getAllCandidateAssessmentItems({ assessment: 42 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("assessment=42");
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=200");
    expect(url).not.toContain("limit=");
  });
});

describe("user management API", () => {
  it("serialises list filters and account-management writes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { count: 0, next: null, previous: null, results: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "new-user" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "target" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "target" }))
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await getManagedUsers({
      search: "kim",
      role: "instructor",
      is_active: false,
      page: 2,
      page_size: 10,
    });
    await createManagedUser({
      email: "new@example.com",
      password: "Temporary-Password-2026!",
      role: "instructor",
    });
    await updateManagedUser("target", { first_name: "Updated", is_active: false });
    await updateManagedUserAuthority("target", { can_promote_student: true });
    await resetManagedUserPassword("target", "Replacement-Password-2026!");

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      search: "kim",
      role: "instructor",
      is_active: "false",
      page: "2",
      page_size: "10",
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PATCH" });
    expect(String(fetchMock.mock.calls[3][0])).toContain("/target/authority/");
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ can_promote_student: true }),
    });
    expect(String(fetchMock.mock.calls[4][0])).toContain("/target/set-password/");
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ password: "Replacement-Password-2026!" }),
    });
  });
});

describe("bulk grading operations", () => {
  it("prepares the selected candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { created: [], errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bulkGenerateCandidateAssessments([11, 12]);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/gradings/candidates/bulk-generate-assessments/",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ candidates: [11, 12] }),
    });
  });

  it("starts the selected prepared assessments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { started: [], errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bulkStartCandidateAssessments([21, 22]);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/gradings/assessments/bulk-start/",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ assessments: [21, 22] }),
    });
  });

  it("marks selected no-shows and submits reasoned locked withdrawal", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { updated: [], errors: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 22, status: "WITHDRAWN" }));
    vi.stubGlobal("fetch", fetchMock);

    await bulkUpdateCandidateStatus([21, 22], "WITHDRAWN");
    await withdrawLockedCandidate(22, {
      withdrawal_reason: "INJURY",
      withdrawal_note: "Unable to continue safely.",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/gradings/candidates/bulk-update-status/",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ candidates: [21, 22], status: "WITHDRAWN" }),
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/api/gradings/candidates/22/withdraw/",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        withdrawal_reason: "INJURY",
        withdrawal_note: "Unable to continue safely.",
      }),
    });
  });
});
