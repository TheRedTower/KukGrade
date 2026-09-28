import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAssessmentNotesDraft } from "./candidateAssessmentData";

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
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

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
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const review = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    act(() => review.result.current.setDraft("Sealed note"));
    act(() => review.result.current.clearDraft());
    review.unmount();

    const returned = renderHook(() => useAssessmentNotesDraft(101), { wrapper });
    expect(returned.result.current.draft).toBeNull();
  });
});
