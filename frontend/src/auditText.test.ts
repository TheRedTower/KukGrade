import { describe, expect, it } from "vitest";

import { eventSummary } from "./auditText";

describe("eventSummary", () => {
  it("adds the student's current name to a summary that holds only their ID", () => {
    expect(eventSummary({ summary: "Student 123-4-001 created.", subject_name: "Alex Kim" })).toBe(
      "Student 123-4-001 created. (Alex Kim)",
    );
  });

  it("shows an older summary that already has the name as it is", () => {
    expect(eventSummary({ summary: "Student Alex Kim (123-4-001) created.", subject_name: "Alex Kim" })).toBe(
      "Student Alex Kim (123-4-001) created.",
    );
  });

  it("shows the summary alone when the student is gone or the event is about no student", () => {
    expect(eventSummary({ summary: "Student 123-4-001 created.", subject_name: "" })).toBe("Student 123-4-001 created.");
  });
});
