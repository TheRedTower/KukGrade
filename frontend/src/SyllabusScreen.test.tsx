import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyllabusScreen } from "./SyllabusScreen";
import type { AgeBand, EffectiveSyllabusRequirement, Rank } from "./api";

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SyllabusScreen />
    </QueryClientProvider>,
  );
}

const mockAgeBands: AgeBand[] = [
  { code: "AGE_8_AND_UNDER", name: "8 and under", description: "Little Dragon ages 8 and under", programme: "JUNIOR", programme_display: "Junior & Little Dragon" },
  { code: "AGE_9_TO_12", name: "9-12", description: "Junior ages 9-12", programme: "JUNIOR", programme_display: "Junior & Little Dragon" },
  { code: "AGE_13_TO_17", name: "13-17", description: "Youth ages 13-17", programme: "ADULT", programme_display: "Adult & Youth" },
  { code: "AGE_18_AND_OVER", name: "18+", description: "Adult ages 18+", programme: "ADULT", programme_display: "Adult & Youth" },
];

const mockRanks: Rank[] = [
  {
    id: 1,
    code: "WHITE",
    name: "White",
    order: 1,
    belt_colour: "WHITE",
    stripe_colour: "",
    stripe_count: 0,
    next_rank: 2,
    has_syllabus: true,
  },
  {
    id: 2,
    code: "YELLOW_STRIPE",
    name: "Yellow Stripe",
    order: 2,
    belt_colour: "WHITE",
    stripe_colour: "YELLOW",
    stripe_count: 1,
    next_rank: 3,
    has_syllabus: true,
  },
  {
    id: 3,
    code: "YELLOW",
    name: "Yellow",
    order: 3,
    belt_colour: "YELLOW",
    stripe_colour: "",
    stripe_count: 0,
    next_rank: 4,
    has_syllabus: true,
  },
  {
    id: 4,
    code: "BLUE_STRIPE",
    name: "Blue Stripe",
    order: 4,
    belt_colour: "YELLOW",
    stripe_colour: "BLUE",
    stripe_count: 1,
    next_rank: 5,
    has_syllabus: true,
  },
  {
    id: 5,
    code: "BLUE",
    name: "Blue",
    order: 5,
    belt_colour: "BLUE",
    stripe_colour: "",
    stripe_count: 0,
    next_rank: 6,
    has_syllabus: true,
  },
  {
    id: 6,
    code: "JKN",
    name: "JKN",
    order: 12,
    belt_colour: "BLACK",
    stripe_colour: "",
    stripe_count: 0,
    next_rank: null,
    has_syllabus: true,
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
    category_is_core: false,
    required: true,
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

// The six universal areas, served in the same response as everything else.
const coreAreas: EffectiveSyllabusRequirement[] = [
  ["YEA_EUE", "Yea Eue", "예의", "ETIQUETTE", "Etiquette"],
  ["KI_CHO_JAH_KI", "Ki Cho Jah Ki", "기초짜기", "FUNDAMENTALS", "Fundamentals"],
  ["SOO_KI", "Soo Ki", "수기", "HAND_TECHNIQUES", "Hand techniques"],
  ["JOHK_SOOL", "Johk Sool", "족술", "KICKING", "Kicking"],
  ["NAHK_BUP", "Nahk Bup", "낙법", "FALLING", "Falling"],
  ["KYUK_PAH", "Kyuk Pah", "격파", "BREAKING", "Breaking"],
].map(([item_code, item_name, item_korean_name, category, category_display]) =>
  effectiveRow({
    item_code,
    item_name,
    item_korean_name,
    category,
    category_display,
    category_is_core: true,
    display_range: "",
    introduced_rank_code: "YELLOW_STRIPE",
    introduced_rank_name: "Yellow Stripe",
  }),
);

const mockYellowEffective: EffectiveSyllabusRequirement[] = [
  ...coreAreas,
  effectiveRow({
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    display_range: "1-10",
    is_new_at_rank: true,
  }),
  effectiveRow({
    item_code: "KI_CHO_HYUNG",
    item_name: "Ki Cho Hyung",
    item_korean_name: "기초형",
    category: "FORM",
    category_display: "Form",
    category_is_core: false,
    display_range: "1-6",
    is_new_at_rank: true,
  }),
];

const mockBlueStripeEffective: EffectiveSyllabusRequirement[] = [
  ...coreAreas,
  effectiveRow({
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    display_range: "1-15",
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
    display_range: "1-5",
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
    category_is_core: false,
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

const mockJknEffective: EffectiveSyllabusRequirement[] = [
  ...coreAreas,
  effectiveRow({ item_code: "SOHN_PPAE_KI", item_name: "Sohn Ppae Ki", display_range: "1-5" }),
  effectiveRow({
    item_code: "GUHM_MOO_HYUNG",
    item_name: "Guhm Moo Hyung",
    item_korean_name: "검무형",
    category: "FORM",
    category_display: "Form",
    category_is_core: false,
    display_range: "",
    introduced_rank_code: "JKN",
    introduced_rank_name: "JKN",
    effective_since_rank_code: "JKN",
    effective_since_rank_name: "JKN",
    is_new_at_rank: true,
  }),
  ...[
    ["SWORD_TECHS", "Sword Techs", "기초검", "1-5"],
    ["BOHNG_DOL_LI_KI", "Bohng Dol-li-ki", "봉돌리기", "1-15"],
  ].map(([item_code, item_name, item_korean_name, display_range]) =>
    effectiveRow({
      item_code,
      item_name,
      item_korean_name,
      category: "WEAPONS",
      category_display: "Weapons",
      category_is_core: false,
      display_range,
      introduced_rank_code: "JKN",
      introduced_rank_name: "JKN",
      effective_since_rank_code: "JKN",
      effective_since_rank_name: "JKN",
      is_new_at_rank: true,
    }),
  ),
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

function stubFetch(
  effectiveByRank: Record<string, EffectiveSyllabusRequirement[]>,
  { effectiveFails = false, ranks = mockRanks }: { effectiveFails?: boolean; ranks?: Rank[] } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/syllabus/age-bands/")) {
        return Promise.resolve(jsonResponse(200, paginated(mockAgeBands)));
      }
      if (url.includes("/api/ranks/")) {
        return Promise.resolve(jsonResponse(200, paginated(ranks)));
      }
      if (url.includes("/api/syllabus/requirements/effective/")) {
        if (effectiveFails) {
          return Promise.reject(new Error("Network connection lost"));
        }
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

  // Which categories are core areas is the server's to say (audit F-31): a
  // category the browser has never heard of follows the served flag.
  it("places rows by the served core flag, not by a category list of its own", async () => {
    stubFetch({
      YELLOW: [
        ...coreAreas,
        effectiveRow({
          item_code: "NEW_CORE_AREA",
          item_name: "New Core Area",
          category: "OTHER",
          category_display: "Other",
          category_is_core: true,
          display_range: "",
        }),
        ...mockYellowEffective.filter((row) => !row.category_is_core),
      ],
    });

    renderScreen();

    const coreHeading = await screen.findByRole("heading", { name: "Core grading areas" });
    const coreStrip = coreHeading.closest("section, div") as HTMLElement;
    expect(within(coreStrip.parentElement as HTMLElement).getByText("New Core Area")).toBeVisible();
    expect(screen.queryByRole("table", { name: "Other for this rank" })).not.toBeInTheDocument();
  });

  it("renders header, filters, belt rail, core areas and a cumulative ledger per category", async () => {
    stubFetch({ YELLOW: mockYellowEffective });

    renderScreen();

    // Header
    expect(await screen.findByRole("heading", { name: "Syllabus" })).toBeVisible();
    expect(screen.getByText("Teaching and grading requirements")).toBeVisible();

    // Filters
    expect(await screen.findByRole("option", { name: "Junior & Little Dragon" })).toBeInTheDocument();
    expect(screen.getByLabelText("Curriculum")).toHaveValue("JUNIOR");
    expect(screen.getByLabelText("Age group")).toHaveValue("AGE_8_AND_UNDER");
    await waitFor(() => {
      expect(screen.getByLabelText("Testing for")).toHaveValue("YELLOW");
    });

    // Belt track
    expect(screen.getByRole("region", { name: "Ranks" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yellow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Rank title, subtitle and the "everything examinable" note
    expect(screen.getByRole("heading", { name: "Yellow", level: 2 })).toBeVisible();
    expect(screen.getByText("Little Dragon ages 8 and under")).toBeVisible();
    expect(
      await screen.findByText("Everything examinable through Yellow, all assessed at every grading."),
    ).toBeVisible();

    // Next rank button
    expect(screen.getByRole("button", { name: "Next rank: Blue Stripe →" })).toBeVisible();

    // Core grading areas: the core-category rows of the same response
    expect(screen.getByRole("heading", { name: "Core grading areas" })).toBeVisible();
    for (const name of ["Yea Eue", "Ki Cho Jah Ki", "Soo Ki", "Johk Sool", "Nahk Bup", "Kyuk Pah"]) {
      expect(screen.getByText(name)).toBeVisible();
    }

    // One ledger per remaining category, headed by its served label
    const techniquesTable = screen.getByRole("table", { name: "Technique set for this rank" });
    expect(within(techniquesTable).getByText("Ki Bohn Soo")).toBeVisible();
    expect(within(techniquesTable).getByText("1-10")).toBeVisible();
    expect(within(techniquesTable).getByText("NEW")).toBeVisible();
    // Neither a core area in the ledger nor a technique in the core strip.
    expect(screen.getAllByText("Ki Bohn Soo")).toHaveLength(1);
    expect(within(techniquesTable).queryByText("Yea Eue")).not.toBeInTheDocument();

    const formsTable = screen.getByRole("table", { name: "Form for this rank" });
    expect(within(formsTable).getByText("Ki Cho Hyung")).toBeVisible();
    expect(within(formsTable).getByText("1-6")).toBeVisible();

    // No weapons are listed before black belt, so no weapons ledger.
    expect(screen.queryByRole("table", { name: "Weapons for this rank" })).not.toBeInTheDocument();

    // Footer
    expect(
      screen.getByText("Past assessments keep the wording they were graded on."),
    ).toBeVisible();
    expect(
      screen.getByText("Preliminary reference: WKSA curriculum chart, 2014"),
    ).toBeVisible();
  });

  it("shows carried-forward provenance and part notation for the Blue Stripe worked example", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    renderScreen();

    const blueStripeBtn = await screen.findByRole("button", { name: "Blue Stripe" });
    await user.click(blueStripeBtn);

    const techniquesTable = await screen.findByRole("table", {
      name: "Technique set for this rank",
    });
    await waitFor(() => {
      expect(within(techniquesTable).getByText("1-15")).toBeVisible();
    });
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

    const formsTable = screen.getByRole("table", { name: "Form for this rank" });
    expect(within(formsTable).getByText("Part 1 of 2")).toBeVisible();
  });

  it("lists weapons in their own ledger where the rank has them", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, JKN: mockJknEffective });

    renderScreen();

    await user.click(await screen.findByRole("button", { name: "JKN" }));

    const weaponsTable = await screen.findByRole("table", { name: "Weapons for this rank" });
    expect(within(weaponsTable).getByText("Sword Techs")).toBeVisible();
    expect(within(weaponsTable).getByText("1-5")).toBeVisible();
    expect(within(weaponsTable).getByText("Bohng Dol-li-ki")).toBeVisible();
    expect(within(weaponsTable).getByText("1-15")).toBeVisible();
    // Ledgers follow the served order: techniques, forms, then weapons.
    expect(
      screen.getAllByRole("table").map((table) => table.getAttribute("aria-label")),
    ).toEqual([
      "Technique set for this rank",
      "Form for this rank",
      "Weapons for this rank",
    ]);
  });

  it("switches rank when belt button or testing for selector is changed", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    renderScreen();

    const blueStripeBtn = await screen.findByRole("button", { name: "Blue Stripe" });
    await user.click(blueStripeBtn);

    expect(blueStripeBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Testing for")).toHaveValue("BLUE_STRIPE");
    expect(await screen.findByRole("heading", { name: "Blue Stripe", level: 2 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next rank: Blue →" })).toBeVisible();

    const techniquesTable = await screen.findByRole("table", {
      name: "Technique set for this rank",
    });
    expect(await within(techniquesTable).findByText("Sohn Mohk Soo")).toBeVisible();
  });

  it("advances to next rank when clicking 'Next rank: ... →'", async () => {
    const user = userEvent.setup();
    stubFetch({ YELLOW: mockYellowEffective, BLUE_STRIPE: mockBlueStripeEffective });

    renderScreen();

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

    renderScreen();

    // Initial values
    const curriculumSelect = await screen.findByLabelText("Curriculum");
    const ageSelect = screen.getByLabelText("Age group");
    await screen.findByRole("option", { name: "Adult & Youth" });
    expect(curriculumSelect).toHaveValue("JUNIOR");
    expect(ageSelect).toHaveValue("AGE_8_AND_UNDER");

    // Change Curriculum to Adult & Youth
    await user.selectOptions(curriculumSelect, "ADULT");
    expect(ageSelect).toHaveValue("AGE_18_AND_OVER");
    expect(screen.getByText("Adult ages 18+")).toBeVisible();

    // Change Age group to 8 and under
    await user.selectOptions(ageSelect, "AGE_8_AND_UNDER");
    expect(curriculumSelect).toHaveValue("JUNIOR");
    expect(screen.getByText("Little Dragon ages 8 and under")).toBeVisible();
  });

  it("leaves out the ranks whose syllabus is not recorded yet", async () => {
    const jkn = mockRanks.find((rank) => rank.code === "JKN");
    const notRecorded: Rank = {
      id: 99,
      code: "KSN",
      name: "Kyo Sa Nim",
      order: 13,
      belt_colour: "BLACK",
      stripe_colour: "",
      stripe_count: 0,
      next_rank: null,
      has_syllabus: false,
    };
    stubFetch({ YELLOW: mockYellowEffective }, { ranks: [...mockRanks.map((rank) => (rank === jkn ? { ...rank, next_rank: 99 } : rank)), notRecorded] });

    renderScreen();

    await screen.findByRole("button", { name: "Blue Stripe" });
    expect(screen.queryByRole("button", { name: "Kyo Sa Nim" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Kyo Sa Nim" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JKN" })).toBeInTheDocument();
  });

  it("says so when no syllabus is recorded for the rank, rather than showing earlier ranks' content", async () => {
    stubFetch({});

    renderScreen();

    expect(
      await screen.findByText(
        "No syllabus is recorded for Yellow in this age group yet, so nobody can be assessed for it.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Core grading areas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Everything examinable through/)).not.toBeInTheDocument();
  });

  it("renders error banner when the effective-requirements fetch fails", async () => {
    stubFetch({}, { effectiveFails: true });

    renderScreen();

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText("Network connection lost")).toBeVisible();
    // A failed load is not "no syllabus recorded".
    expect(screen.queryByText(/No syllabus is recorded/)).not.toBeInTheDocument();
  });
});
