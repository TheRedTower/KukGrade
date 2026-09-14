import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getCurrentUser, loginUser } from "./api";

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
