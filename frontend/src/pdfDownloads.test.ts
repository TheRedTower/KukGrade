import { describe, expect, it } from "vitest";

import { ApiError, fileNameOf } from "./api";
import { refusalOf } from "./pdfDownloads";

describe("the name a PDF is saved under", () => {
  it("is the server's own, decoded", () => {
    expect(
      fileNameOf("attachment; filename*=utf-8''2027-03-20%20October%20%E2%80%93%20Juniors%20-%20Summary.pdf", "x.pdf"),
    ).toBe("2027-03-20 October – Juniors - Summary.pdf");
  });

  it("reads a plain file name when that is all there is", () => {
    expect(fileNameOf('attachment; filename="Summary.pdf"', "x.pdf")).toBe("Summary.pdf");
  });

  it("falls back when the server names nothing, or names it badly", () => {
    expect(fileNameOf(null, "Records.pdf")).toBe("Records.pdf");
    expect(fileNameOf("attachment; filename*=utf-8''%E2%80", "Records.pdf")).toBe("Records.pdf");
  });
});

describe("why nothing was downloaded", () => {
  const names: Record<number, string> = { 31: "Mia Okafor" };
  const nameOf = (id: number) => names[id];

  it("names each candidate the server refused, with its reason", () => {
    const error = new ApiError("Invalid input.", 400, "invalid", {
      "31": ["Their assessment is not sealed yet."],
      "99": ["Not registered in this grading."],
    });

    expect(refusalOf(error, nameOf)).toEqual({
      reason: "Some of the candidates chosen cannot be included:",
      candidates: [
        { name: "Mia Okafor", why: "Their assessment is not sealed yet." },
        { name: "A candidate no longer on this list", why: "Not registered in this grading." },
      ],
      help: "Take them out of the selection, or try again once they are ready.",
      action: "REFRESH_LIST",
    });
  });

  it("says the page is out of date when the session has moved on", () => {
    const error = new ApiError("Invalid input.", 400, "invalid", {
      session: ["Grading sheets are printed before a grading is locked."],
    });

    expect(refusalOf(error, nameOf)).toMatchObject({
      reason: "Grading sheets are printed before a grading is locked.",
      candidates: [],
      action: "REFRESH_PAGE",
    });
  });

  it("shows any other refusal as the server words it", () => {
    const error = new ApiError("Choose at most 60 candidates at a time.", 400);

    expect(refusalOf(error, nameOf)).toMatchObject({
      reason: "Choose at most 60 candidates at a time.",
      action: "CLOSE",
    });
  });

  it("offers to try again when the PDF could not be made", () => {
    expect(refusalOf(new ApiError("Server error.", 500), nameOf)).toMatchObject({
      help: "Try again in a moment. If it keeps happening, tell whoever looks after KukGrade.",
      action: "TRY_AGAIN",
    });
  });
});
