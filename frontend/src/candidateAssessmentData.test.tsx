import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetDeletedAssessment, useAssessmentNotesDraft } from "./candidateAssessmentData";

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("forgetDeletedAssessment", () => {
  it("drops the assessment's own data and refetches what its deletion changed", () => {
    const queryClient = new QueryClient();
    const seed = (queryKey: unknown[]) => queryClient.setQueryData(queryKey, { seeded: true });
    seed(["candidateAssessments", "byCandidate", 7]);
    seed(["candidateAssessmentItems", 70]);
    seed(["candidateAssessmentSummary", 70]);
    seed(["assessmentNotesDraft", 70]);
    seed(["candidateAssessmentItems", 71]);
    for (const shared of ["candidateOutcomes", "promotions", "students", "gradingSessions"]) {
      seed([shared, 1]);
    }

    forgetDeletedAssessment(queryClient, { assessmentId: 70, candidateId: 7 });

    expect(queryClient.getQueryData(["candidateAssessments", "byCandidate", 7])).toBeUndefined();
    expect(queryClient.getQueryData(["candidateAssessmentItems", 70])).toBeUndefined();
    expect(queryClient.getQueryData(["candidateAssessmentSummary", 70])).toBeUndefined();
    expect(queryClient.getQueryData(["assessmentNotesDraft", 70])).toBeUndefined();
    // Another assessment's data is left alone.
    expect(queryClient.getQueryData(["candidateAssessmentItems", 71])).toEqual({ seeded: true });
    // A deletion can remove an outcome and promotion and revert a rank.
    for (const shared of ["candidateOutcomes", "promotions", "students", "gradingSessions"]) {
      expect(queryClient.getQueryState([shared, 1])?.isInvalidated).toBe(true);
    }
  });
});

describe("useAssessmentNotesDraft", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The completion screen unmounts while the instructor goes back to fix a
  // score, and nothing observes the draft in the meantime. It must still be
  // there however long that correction takes.
  it("keeps the draft across a long round trip to the scoring screen", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const wrapper = wrapperFor(queryClient);

    const review = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    act(() => review.result.current.setDraft("Strong forms, guard still low."));
    review.unmount();

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });

    const returned = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    expect(returned.result.current.draft).toBe("Strong forms, guard still low.");
  });

  it("forgets the draft once cleared", () => {
    const queryClient = new QueryClient();
    const wrapper = wrapperFor(queryClient);

    const review = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    act(() => review.result.current.setDraft("Sealed note"));
    act(() => review.result.current.clearDraft());
    review.unmount();

    const returned = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    expect(returned.result.current.draft).toBeNull();
  });

  it("belongs to one assessment, so another shows its own draft", () => {
    const queryClient = new QueryClient();
    const { result, rerender } = renderHook(
      ({ assessmentId }: { assessmentId: number }) => useAssessmentNotesDraft(assessmentId),
      { initialProps: { assessmentId: 70 }, wrapper: wrapperFor(queryClient) },
    );

    act(() => result.current.setDraft("Strong stances"));
    expect(result.current.draft).toBe("Strong stances");

    // A regenerated assessment is a new record; the old draft does not follow.
    rerender({ assessmentId: 71 });
    expect(result.current.draft).toBeNull();

    rerender({ assessmentId: 70 });
    expect(result.current.draft).toBe("Strong stances");
  });
});
