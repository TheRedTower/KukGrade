import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyllabusScreen } from "./SyllabusScreen";
import type { EffectiveSyllabusRequirement, Rank, SyllabusItem } from "./api";

const mockRanks: Rank[] = [
  {
    id: 1,
    code: "WHITE",
    name: "White",
    order: 1,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 2,
    code: "YELLOW_STRIPE",
    name: "Yellow Stripe",
    order: 2,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 3,
    code: "YELLOW",
    name: "Yellow",
    order: 3,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 4,
    code: "BLUE_STRIPE",
    name: "Blue Stripe",
    order: 4,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 5,
    code: "BLUE",
    name: "Blue",
    order: 5,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
];

const mockCoreAreas: SyllabusItem[] = [
  {
    id: 101,
    code: "YEA_EUE",
    name: "Yea Eue",
    korean_name: "예의",
    category: "ETIQUETTE",
    category_display: "Etiquette",
    description: "",
    active: true,
  },
  {
    id: 102,
    code: "KI_CHO_JAH_KI",
    name: "Ki Cho Jah Ki",
    korean_name: "기초짜기",
    category: "FUNDAMENTALS",
    category_display: "Fundamentals",
    description: "",
    active: true,
  },
  {
    id: 103,
    code: "SOO_KI",
    name: "Soo Ki",
    korean_name: "수기",
    category: "HAND_TECHNIQUES",
    category_display: "Hand techniques",
    description: "",
    active: true,
  },
  {
    id: 104,
    code: "JOHK_SOOL",
    name: "Johk Sool",
    korean_name: "족술",
    category: "KICKING",
    category_display: "Kicking",
    description: "",
    active: true,
  },
  {
    id: 105,
    code: "NAHK_BUP",
    name: "Nahk Bup",
    korean_name: "낙법",
    category: "FALLING",
    category_display: "Falling",
    description: "",
    active: true,
  },
  {
    id: 106,
    code: "KYUK_PAH",
    name: "Kyuk Pah",
    korean_name: "격파",
    category: "BREAKING",
    category_display: "Breaking",
    description: "",
    active: true,
  },
  // A non-core item, present in the same catalogue response, must not leak
  // into the core grading areas strip.
  {
    id: 107,
    code: "KI_BOHN_SOO",
    name: "Ki Bohn Soo",
    korean_name: "기본수",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    description: "",
    active: true,
  },
];

function effectiveRow(
  overrides: Partial<EffectiveSyllabusRequirement>,
): EffectiveSyllabusRequirement {
  return {
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    item_korean_name: "기본수",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    required: true,
    sequence: 7,
    start_number: 1,
    end_number: 10,
    display_range: "1-10",
    notation: "",
    notes: "",
    introduced_rank_code: "YELLOW",
    introduced_rank_name: "Yellow",
    effective_since_rank_code: "YELLOW",
    effective_since_rank_name: "Yellow",
    is_new_at_rank: false,
    ...overrides,
  };
}

const mockYellowEffective: EffectiveSyllabusRequirement[] = [
  effectiveRow({
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    sequence: 7,
    display_range: "1-10",
    introduced_rank_code: "YELLOW",
    introduced_rank_name: "Yellow",
    effective_since_rank_code: "YELLOW",
    effective_since_rank_name: "Yellow",
    is_new_at_rank: true,
  }),
  effectiveRow({
    item_code: "KI_CHO_HYUNG",
    item_name: "Ki Cho Hyung",
    item_korean_name: "기초형",
    category: "FORM",
    category_display: "Form",
    sequence: 8,
    display_range: "1-6",
    introduced_rank_code: "YELLOW",
    introduced_rank_name: "Yellow",
    effective_since_rank_code: "YELLOW",
    effective_since_rank_name: "Yellow",
    is_new_at_rank: true,
  }),
];

const mockBlueStripeEffective: EffectiveSyllabusRequirement[] = [
  effectiveRow({
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    sequence: 7,
    display_range: "1-15",
    start_number: 1,
    end_number: 15,
    introduced_rank_code: "YELLOW_STRIPE",
    introduced_rank_name: "Yellow Stripe",
    effective_since_rank_code: "YELLOW",
    effective_since_rank_name: "Yellow",
    is_new_at_rank: false,
  }),
  effectiveRow({
    item_code: "SOHN_MOHK_SOO",
    item_name: "Sohn Mohk Soo",
    item_korean_name: "손목수",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    sequence: 9,
    display_range: "1-5",
    start_number: 1,
    end_number: 5,
    introduced_rank_code: "BLUE_STRIPE",
    introduced_rank_name: "Blue Stripe",
    effective_since_rank_code: "BLUE_STRIPE",
    effective_since_rank_name: "Blue Stripe",
    is_new_at_rank: true,
  }),
  effectiveRow({
    item_code: "CHO_GEUP_HYUNG",
    item_name: "Cho Geup Hyung",
    item_korean_name: "초급형",
    category: "FORM",
    category_display: "Form",
    sequence: 10,
    start_number: null,
    end_number: null,
    display_range: "",
    notation: "Part 1 of 2",
    notes: "Chart notation: (1/2).",
    introduced_rank_code: "BLUE_STRIPE",
    introduced_rank_name: "Blue Stripe",
    effective_since_rank_code: "BLUE_STRIPE",
    effective_since_rank_name: "Blue Stripe",
    is_new_at_rank: true,
  }),
];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

function stubFetch(effectiveByRank: Record<string, EffectiveSyllabusRequirement[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/ranks/")) {
        return Promise.resolve(jsonResponse(200, paginated(mockRanks)));
      }
      if (url.includes("/api/syllabus/items/")) {
        return Promise.resolve(jsonResponse(200, paginated(mockCoreAreas)));
      }
      if (url.includes("/api/syllabus/requirements/effective/")) {
        const match = /rank_code=([^&]+)/.exec(url);
        const rankCode = match ? match[1] : "";
        return Promise.resolve(
          jsonResponse(200, paginated(effectiveByRank[rankCode] ?? [])),
        );
      }
      return Promise.resolve(jsonResponse(200, paginated([])));
    }),
  );
}

describe("SyllabusScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header, filters, belt rail, core areas and the two cumulative ledgers", async () => {
    stubFetch({ YELLOW: mockYellowEffective });

    render(<SyllabusScreen />);

    // Header
    expect(await screen.findByRole("heading", { name: "Syllabus" })).toBeVisible();
    expect(screen.getByText("Teaching and grading requirements")).toBeVisible();

    // Filters
    expect(screen.getByLabelText("Curriculum")).toHaveValue("JUNIOR_LITTLE_DRAGON");
    expect(screen.getByLabelText("Age group")).toHaveValue("AGE_9_TO_12");
    await waitFor(() => {
      expect(screen.getByLabelText("Testing for")).toHaveValue("YELLOW");
    });

    // Belt track
    expect(screen.getByRole("region", { name: "Belt Rank Chapters" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yellow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Rank title, subtitle and the "everything examinable" note
    expect(screen.getByRole("heading", { name: "Yellow", level: 2 })).toBeVisible();
    expect(screen.getByText("Junior ages 9 – 12")).toBeVisible();
    expect(screen.getByText("Everything examinable through Yellow.")).toBeVisible();

    // Next rank button
    expect(screen.getByRole("button", { name: "Next rank: Blue Stripe →" })).toBeVisible();

    // Core grading areas: only the six core-category items, from the API
    expect(screen.getByRole("heading", { name: "Core grading areas" })).toBeVisible();
    for (const name of ["Yea Eue", "Ki Cho Jah Ki", "Soo Ki", "Johk Sool", "Nahk Bup", "Kyuk Pah"]) {
      expect(await screen.findByText(name)).toBeVisible();
    }
    // Techniques ledger
    const techniquesTable = await screen.findByRole("table", { name: "Techniques for this rank" });
    expect(within(techniquesTable).getByText("Ki Bohn Soo")).toBeVisible();
    expect(within(techniquesTable).getByText("1-10")).toBeVisible();
    // The non-core "Ki Bohn Soo" item from the same items-catalogue response
    // must appear only in the ledger below, not duplicated into the core
    // grading areas strip.
    expect(screen.getAllByText("Ki Bohn Soo")).toHaveLength(1);
    expect(within(techniquesTable).getByText("NEW")).toBeVisible();

    // Forms ledger
    const formsTable = screen.getByRole("table", { name: "Forms for this rank" });
    expect(within(formsTable).getByText("Ki Cho Hyung")).toBeVisible();
    expect(within(formsTable).getByText("1-6")).toBeVisible();

    // Footer
    expect(
      screen.getByText("Past assessments retain their generated wording."),
    ).toBeVisible();
    expect(
      screen.getByText("Preliminary reference: WKSA curriculum chart, 2014"),
    ).toBeVisible();
  });

  it("shows carried-forward provenance and part notation for the Blue Stripe worked example", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    render(<SyllabusScreen />);

    const blueStripeBtn = await screen.findByRole("button", { name: "Blue Stripe" });
    await user.click(blueStripeBtn);

    const techniquesTable = await screen.findByRole("table", { name: "Techniques for this rank" });
    // Ki Bohn Soo: extended at Yellow, not new at Blue Stripe.
    const kiBohnSooRow = within(techniquesTable).getByText("1-15").closest("tr");
    expect(kiBohnSooRow).not.toBeNull();
    expect(
      within(kiBohnSooRow as HTMLElement).getByText("From Yellow Stripe, extended at Yellow"),
    ).toBeVisible();
    expect(within(kiBohnSooRow as HTMLElement).queryByText("NEW")).not.toBeInTheDocument();
    // Sohn Mohk Soo: introduced and effective at Blue Stripe itself.
    const sohnMohkSooRow = within(techniquesTable).getByText("Sohn Mohk Soo").closest("tr");
    expect(sohnMohkSooRow).not.toBeNull();
    expect(within(sohnMohkSooRow as HTMLElement).getByText("NEW")).toBeVisible();

    const formsTable = screen.getByRole("table", { name: "Forms for this rank" });
    expect(within(formsTable).getByText("Part 1 of 2")).toBeVisible();
  });

  it("switches rank when belt button or testing for selector is changed", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    render(<SyllabusScreen />);

    const blueStripeBtn = await screen.findByRole("button", { name: "Blue Stripe" });
    await user.click(blueStripeBtn);

    expect(blueStripeBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Testing for")).toHaveValue("BLUE_STRIPE");
    expect(await screen.findByRole("heading", { name: "Blue Stripe", level: 2 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next rank: Blue →" })).toBeVisible();

    const techniquesTable = await screen.findByRole("table", { name: "Techniques for this rank" });
    expect(within(techniquesTable).getByText("Sohn Mohk Soo")).toBeVisible();
  });

  it("advances to next rank when clicking 'Next rank: ... →'", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    render(<SyllabusScreen />);

    const nextRankBtn = await screen.findByRole("button", {
      name: "Next rank: Blue Stripe →",
    });
    await user.click(nextRankBtn);

    expect(await screen.findByRole("heading", { name: "Blue Stripe", level: 2 })).toBeVisible();
    expect(screen.getByLabelText("Testing for")).toHaveValue("BLUE_STRIPE");
  });

  it("synchronizes curriculum track and age band selections", async () => {
    const user = userEvent.setup();
    stubFetch({});

    render(<SyllabusScreen />);

    // Initial values
    const curriculumSelect = await screen.findByLabelText("Curriculum");
    const ageSelect = screen.getByLabelText("Age group");
    expect(curriculumSelect).toHaveValue("JUNIOR_LITTLE_DRAGON");
    expect(ageSelect).toHaveValue("AGE_9_TO_12");

    // Change Curriculum to Adult & Youth
    await user.selectOptions(curriculumSelect, "ADULT_YOUTH");
    expect(ageSelect).toHaveValue("AGE_18_AND_OVER");
    expect(screen.getByText("Adult ages 18+")).toBeVisible();

    // Change Age group to 8 and under
    await user.selectOptions(ageSelect, "AGE_8_AND_UNDER");
    expect(curriculumSelect).toHaveValue("JUNIOR_LITTLE_DRAGON");
    expect(screen.getByText("Little Dragon ages 8 and under")).toBeVisible();
  });

  it("renders empty state when rank has no cumulative requirements", async () => {
    stubFetch({});

    render(<SyllabusScreen />);

    expect(
      await screen.findByText("No techniques are listed for this rank in the current syllabus."),
    ).toBeVisible();
    expect(
      screen.getByText("No forms are listed for this rank in the current syllabus."),
    ).toBeVisible();
  });

  it("renders error banner when the effective-requirements fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(jsonResponse(200, paginated(mockRanks)));
        }
        if (url.includes("/api/syllabus/items/")) {
          return Promise.resolve(jsonResponse(200, paginated(mockCoreAreas)));
        }
        return Promise.reject(new Error("Network connection lost"));
      }),
    );

    render(<SyllabusScreen />);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText("Network connection lost")).toBeVisible();
  });
});
