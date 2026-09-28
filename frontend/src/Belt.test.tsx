import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";

import { BeltSwatch, RankBelt } from "./Belt";
import type { Rank } from "./api";

const mockGetRanks = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, getRanks: (...args: unknown[]) => mockGetRanks(...args) };
});

const blueStripe: Rank = {
  id: 4,
  code: "BLUE_STRIPE",
  name: "Blue Stripe",
  order: 4,
  category: "COLOURED_BELT",
  category_display: "Coloured belt",
  belt_colour: "YELLOW",
  stripe_colour: "BLUE",
  active: true,
  next_rank: 5,
};

describe("BeltSwatch", () => {
  it("draws the belt colour with a band in the stripe colour", () => {
    const { container } = render(<BeltSwatch rank={blueStripe} />);

    const belt = container.querySelector(".belt");
    expect(belt).toHaveClass("belt-yellow");
    expect(belt?.querySelector(".belt-stripe")).toHaveClass("belt-blue");
  });

  it("draws no band for a rank without a stripe", () => {
    const { container } = render(
      <BeltSwatch rank={{ ...blueStripe, belt_colour: "BLUE", stripe_colour: "" }} />,
    );

    expect(container.querySelector(".belt")).toHaveClass("belt-blue");
    expect(container.querySelector(".belt-stripe")).toBeNull();
  });
});

describe("RankBelt", () => {
  it("draws the served belt for a rank id", async () => {
    mockGetRanks.mockResolvedValue({ count: 1, next: null, previous: null, results: [blueStripe] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RankBelt rankId={4} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(container.querySelector(".belt")).toHaveClass("belt-yellow"));
    expect(container.querySelector(".belt-stripe")).toHaveClass("belt-blue");
  });
});
