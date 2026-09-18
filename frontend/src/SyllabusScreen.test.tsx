import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyllabusScreen } from "./SyllabusScreen";
import type { Rank, SyllabusRequirement } from "./api";

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

const mockYellowRequirements: SyllabusRequirement[] = [
  {
    id: 101,
    rank: 3,
    rank_code: "YELLOW",
    rank_name: "Yellow",
    rank_order: 3,
    age_band: "AGE_9_TO_12",
    item: 1,
    item_code: "YEA_EUE",
    item_name: "Yea Eue",
    item_korean_name: "예의",
    category: "ETIQUETTE",
    category_display: "Etiquette",
    start_number: null,
    end_number: null,
    display_range: "",
    sequence: 1,
    required: true,
    active: true,
    notes: "",
  },
  {
    id: 102,
    rank: 3,
    rank_code: "YELLOW",
    rank_name: "Yellow",
    rank_order: 3,
    age_band: "AGE_9_TO_12",
    item: 7,
    item_code: "KI_BOHN_SOO",
    item_name: "Ki Bohn Soo",
    item_korean_name: "기본수",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    start_number: 1,
    end_number: 10,
    display_range: "1-10",
    sequence: 7,
    required: true,
    active: true,
    notes: "Basic defence techniques",
  },
  {
    id: 103,
    rank: 3,
    rank_code: "YELLOW",
    rank_name: "Yellow",
    rank_order: 3,
    age_band: "AGE_9_TO_12",
    item: 8,
    item_code: "KI_CHO_HYUNG",
    item_name: "Ki Cho Hyung",
    item_korean_name: "기초형",
    category: "FORM",
    category_display: "Form",
    start_number: 1,
    end_number: 6,
    display_range: "1-6",
    sequence: 8,
    required: true,
    active: true,
    notes: "",
  },
];

const mockBlueStripeRequirements: SyllabusRequirement[] = [
  {
    id: 201,
    rank: 4,
    rank_code: "BLUE_STRIPE",
    rank_name: "Blue Stripe",
    rank_order: 4,
    age_band: "AGE_9_TO_12",
    item: 15,
    item_code: "SOHN_MOHK_SOO",
    item_name: "Sohn Mohk Soo",
    item_korean_name: "손목수",
    category: "TECHNIQUE_SET",
    category_display: "Technique set",
    start_number: 1,
    end_number: 11,
    display_range: "1-11",
    sequence: 7,
    required: true,
    active: true,
    notes: "",
  },
];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("SyllabusScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders syllabus header, filters, belt rail, core areas and requirements table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        if (url.includes("/api/syllabus/requirements/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockYellowRequirements.length,
              next: null,
              previous: null,
              results: mockYellowRequirements,
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, {}));
      }),
    );

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

    // Rank title and subtitle
    expect(screen.getByRole("heading", { name: "Yellow", level: 2 })).toBeVisible();
    expect(screen.getByText("Junior ages 9 – 12")).toBeVisible();

    // Next rank button
    expect(screen.getByRole("button", { name: "Next rank: Blue Stripe →" })).toBeVisible();

    // Core grading areas
    expect(screen.getByRole("heading", { name: "Core grading areas" })).toBeVisible();
    expect(screen.getByText("Yea Eue")).toBeVisible();
    expect(screen.getByText("Ki Cho Jah Ki")).toBeVisible();
    expect(screen.getByText("Soo Ki")).toBeVisible();
    expect(screen.getByText("Johk Sool")).toBeVisible();
    expect(screen.getByText("Nahk Bup")).toBeVisible();
    expect(screen.getByText("Kyuk Pah")).toBeVisible();

    // Syllabus requirements table
    expect(screen.getByRole("heading", { name: "Syllabus requirements" })).toBeVisible();
    const table = screen.getByRole("table", {
      name: "Syllabus requirements for this rank",
    });
    expect(within(table).getByText("Ki Bohn Soo")).toBeVisible();
    expect(within(table).getByText("기본수")).toBeVisible();
    expect(within(table).getByText("1-10")).toBeVisible();
    expect(within(table).getByText("Ki Cho Hyung")).toBeVisible();
    expect(within(table).getAllByText("Required")).toHaveLength(2);

    // Footer
    expect(
      screen.getByText("Past assessments retain their generated wording."),
    ).toBeVisible();
    expect(
      screen.getByText("Preliminary reference: WKSA curriculum chart, 2014"),
    ).toBeVisible();
  });

  it("switches rank when belt button or testing for selector is changed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        if (url.includes("rank_code=BLUE_STRIPE")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockBlueStripeRequirements.length,
              next: null,
              previous: null,
              results: mockBlueStripeRequirements,
            }),
          );
        }
        if (url.includes("rank_code=YELLOW")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockYellowRequirements.length,
              next: null,
              previous: null,
              results: mockYellowRequirements,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
        );
      }),
    );

    render(<SyllabusScreen />);

    // Click Blue Stripe in belt rail
    const blueStripeBtn = await screen.findByRole("button", {
      name: "Blue Stripe",
    });
    await user.click(blueStripeBtn);

    expect(blueStripeBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Testing for")).toHaveValue("BLUE_STRIPE");
    expect(await screen.findByRole("heading", { name: "Blue Stripe", level: 2 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next rank: Blue →" })).toBeVisible();

    // Table now displays Blue Stripe requirements
    expect(await screen.findByText("Sohn Mohk Soo")).toBeVisible();
    expect(screen.getByText("1-11")).toBeVisible();
  });

  it("advances to next rank when clicking 'Next rank: ... →'", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        if (url.includes("rank_code=BLUE_STRIPE")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockBlueStripeRequirements.length,
              next: null,
              previous: null,
              results: mockBlueStripeRequirements,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            count: mockYellowRequirements.length,
            next: null,
            previous: null,
            results: mockYellowRequirements,
          }),
        );
      }),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
        );
      }),
    );

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

  it("renders empty state when rank has no requirements in catalogue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        // White belt has 0 requirements
        return Promise.resolve(
          jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
        );
      }),
    );

    render(<SyllabusScreen />);

    expect(
      await screen.findByText(
        "No specific technique or form requirements are listed for this rank in the current syllabus.",
      ),
    ).toBeVisible();
  });

  it("renders error banner when requirement fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ranks/")) {
          return Promise.resolve(
            jsonResponse(200, {
              count: mockRanks.length,
              next: null,
              previous: null,
              results: mockRanks,
            }),
          );
        }
        return Promise.reject(new Error("Network connection lost"));
      }),
    );

    render(<SyllabusScreen />);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText("Network connection lost")).toBeVisible();
  });
});
