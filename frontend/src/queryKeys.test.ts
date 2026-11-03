import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { keys, refresh } from "./queryKeys";

describe("query keys", () => {
  it("names every list under its family, so refreshing the family reaches it", () => {
    const family = keys.students.all();
    for (const key of [keys.students.list("x", 2), keys.students.detail(7), keys.students.eligible({ rank: "BLUE" })]) {
      expect(key.slice(0, family.length)).toEqual(family);
    }
  });

  it("reads a promotion's student, ledger and audit lists again", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    refresh.afterPromotion(queryClient, 10);

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["promotions", 10],
      ["promotionEligibility", 10],
      ["gradingCandidates", 10],
      ["students"],
      ["auditEvents"],
    ]);
  });

  it("reads a student's page, the lists and the audit log again after a change", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await refresh.afterStudentChange(queryClient, 4);

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["students", "detail", 4],
      ["students", "list"],
      ["auditEvents"],
    ]);
  });
});
