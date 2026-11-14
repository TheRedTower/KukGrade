import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError, NETWORK_ERROR, errorMessage } from "./api";
import { requiredErrors, splitServerErrors, useServerForm } from "./forms";

const shown = ["first_name", "wksa_id"];
const invalid = (fields: ConstructorParameters<typeof ApiError>[3], message = "Some details need correcting.") =>
  new ApiError(message, 400, "validation_error", fields);

describe("splitServerErrors", () => {
  it("puts a message beside the field it is about", () => {
    const result = splitServerErrors(invalid({ wksa_id: ["Taken."] }), shown, "Failed.");
    expect(result).toEqual({ fields: { wksa_id: ["Taken."] }, banner: null });
  });

  it("puts what no shown field can carry in the banner", () => {
    const result = splitServerErrors(
      invalid({ non_field_errors: ["Limit reached."], hidden_field: ["Not shown."], first_name: ["Required."] }),
      shown,
      "Failed.",
    );
    expect(result.fields).toEqual({ first_name: ["Required."] });
    expect(result.banner).toBe("Limit reached. Not shown.");
  });

  it("says the server's own message when it named no fields", () => {
    expect(splitServerErrors(new ApiError("You may not.", 403), shown, "Failed.").banner).toBe("You may not.");
  });

  it("reports a request that never reached the server as a network error", () => {
    expect(splitServerErrors(new TypeError("Failed to fetch"), shown, "Failed.")).toEqual({
      fields: {},
      banner: NETWORK_ERROR,
    });
    expect(errorMessage(new TypeError("Failed to fetch"), "Failed.")).toBe(NETWORK_ERROR);
    expect(errorMessage(new TypeError("Load failed"), "Failed.")).toBe(NETWORK_ERROR);
  });
});

describe("useServerForm", () => {
  it("shows every message a field has, not only the first", () => {
    const { result } = renderHook(() => useServerForm(["email"]));
    act(() => result.current.setClientErrors({ email: ["Enter an email.", "Use your club address."] }));
    expect(result.current.errorFor("email")).toBe("Enter an email. Use your club address.");
    expect(result.current.errorFor("name")).toBeNull();
  });
});

describe("requiredErrors", () => {
  it("names each needed field left empty, and only those", () => {
    expect(
      requiredErrors({
        first_name: ["  ", "First name"],
        last_name: ["Carter", "Last name"],
        current_rank: [null, "Current rank"],
        date_of_birth: ["2012-04-24", "Date of birth"],
      }),
    ).toEqual({
      first_name: ["First name is required."],
      current_rank: ["Current rank is required."],
    });
  });
});
