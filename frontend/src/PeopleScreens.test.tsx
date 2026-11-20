import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser, CHOICES, page, SITE } from "./appTestSupport";
import { person } from "./importTestFixtures";
import { PeopleScreen } from "./PeopleScreen";
import { PersonScreen } from "./PersonScreen";
import { PersonSplitScreen } from "./PersonSplitScreen";
import { PersonStudentScreen } from "./PersonStudentScreen";

// Made-up people throughout.

const api = vi.hoisted(() => ({
  getHistoricalPeople: vi.fn(),
  getAllHistoricalPeople: vi.fn(),
  getHistoricalPeopleSummary: vi.fn(),
  getHistoricalPerson: vi.fn(),
  linkHistoricalPerson: vi.fn(),
  markNotAStudent: vi.fn(),
  leavePersonForLater: vi.fn(),
  reopenHistoricalPerson: vi.fn(),
  splitHistoricalPerson: vi.fn(),
  mergeHistoricalPeople: vi.fn(),
  confirmHistoricalPeople: vi.fn(),
  getStudents: vi.fn(),
  getChoices: vi.fn(),
  getSiteSettings: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  const mocked = Object.fromEntries(
    Object.keys(api).map((name) => [name, (...args: unknown[]) => api[name as keyof typeof api](...args)]),
  );
  return { ...actual, ...mocked };
});

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("./auth", () => ({
  useAuth: () => ({ user: auth.user, status: "authenticated" }),
}));

const COUNTS = {
  people: 9,
  sorted: 3,
  proposed: 5,
  linked: 2,
  not_a_student: 1,
  later: 1,
  ready: 2,
  needs_a_look: 2,
  no_student: 1,
};

const mia = person();
const theo = person({
  id: 202,
  name: "Theo Lane",
  spellings: ["Theo L"],
  queue: "NEEDS_A_LOOK",
  suggestion: "choose",
  candidates: [
    { ...mia.candidates[0], student: 40, full_name: "Theo Barker", current_rank_name: "Blue" },
    { ...mia.candidates[0], student: 41, full_name: "Theo Lane", current_rank_name: "White" },
  ],
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<PeopleScreen />} path="/imports/people" />
          <Route element={<PersonScreen />} path="/imports/people/:id" />
          <Route element={<PersonSplitScreen />} path="/imports/people/:id/split" />
          <Route element={<PersonStudentScreen />} path="/imports/people/:id/student" />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  auth.user = { ...authUser, ...ADMINISTRATOR_CAPABILITIES };
  api.getChoices.mockResolvedValue(CHOICES);
  api.getSiteSettings.mockResolvedValue(SITE);
  api.getHistoricalPeopleSummary.mockResolvedValue(COUNTS);
  api.getHistoricalPeople.mockResolvedValue(page([mia, theo]));
  api.getHistoricalPerson.mockImplementation(async (id: number) => (id === theo.id ? theo : mia));
});

describe("The people to sort", () => {
  it("shows how many are sorted, a queue for each decision still to make, and the ones decided", async () => {
    renderAt("/imports/people?batch=7");

    expect(await screen.findByText("3 of 9 people sorted")).toBeVisible();
    expect(api.getHistoricalPeopleSummary).toHaveBeenCalledWith({ batch: 7 });
    const waiting = screen.getByRole("list", { name: "Still to sort" });
    expect(
      within(waiting)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/imports/people?list=READY&batch=7",
      "/imports/people?list=NEEDS_A_LOOK&batch=7",
      "/imports/people?list=NO_STUDENT&batch=7",
    ]);
    const decided = screen.getByRole("list", { name: "Put aside and decided" });
    expect(within(decided).getByRole("link", { name: /Linked to a student/ })).toHaveTextContent("2");
  });

  it("lists a queue's people, each opening their own page", async () => {
    renderAt("/imports/people?list=NEEDS_A_LOOK");

    const link = await screen.findByRole("link", { name: /Theo Lane/ });
    expect(link).toHaveAttribute("href", "/imports/people/202?list=NEEDS_A_LOOK");
    expect(link).toHaveTextContent("Could be Theo Barker or another");
    expect(api.getHistoricalPeople).toHaveBeenCalledWith(
      expect.objectContaining({ queue: "NEEDS_A_LOOK", page: 1, page_size: 50 }),
    );
    expect(screen.queryByRole("button", { name: /Confirm all/ })).toBeNull();
  });

  it("confirms everyone ready to confirm, each to the student suggested, at once", async () => {
    const user = userEvent.setup();
    api.getAllHistoricalPeople.mockResolvedValue(page([mia]));
    api.confirmHistoricalPeople.mockResolvedValue([mia]);

    renderAt("/imports/people?list=READY&batch=7");

    await user.click(await screen.findByRole("button", { name: "Confirm all 2 people" }));
    expect(api.getAllHistoricalPeople).toHaveBeenCalledWith({ queue: "READY", batch: 7 });
    expect(api.confirmHistoricalPeople).toHaveBeenCalledWith([{ person: 201, student: 31, version: 4 }]);
    expect(await screen.findByText("1 person confirmed")).toBeVisible();
  });

  it("confirms nobody when one has changed since, and says so", async () => {
    const user = userEvent.setup();
    api.getAllHistoricalPeople.mockResolvedValue(page([mia]));
    api.confirmHistoricalPeople.mockRejectedValue(new ApiError("This person has changed since.", 400));

    renderAt("/imports/people?list=READY");
    await user.click(await screen.findByRole("button", { name: "Confirm all 2 people" }));

    expect(await screen.findByText("Nobody was confirmed.")).toBeVisible();
    expect(screen.getByText("This person has changed since.")).toBeVisible();
  });
});

describe("One person", () => {
  it("shows how they are written, their gradings and the suggested student, and confirms them", async () => {
    const user = userEvent.setup();
    api.linkHistoricalPerson.mockResolvedValue({ ...mia, state: "LINKED" });

    renderAt("/imports/people/201?list=READY");

    expect(await screen.findByRole("heading", { name: "Mia Reyes" })).toBeVisible();
    const spellings = screen.getByRole("list", { name: "Spellings" });
    expect(
      within(spellings)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Mia R", "Mia Reyes"]);
    expect(screen.getByText("Passed to Blue stripe, then held it on the next sheet")).toBeVisible();
    expect(screen.getByText("Their gradings (2)")).toBeVisible();
    expect(screen.getByText("Rank fits: Blue stripe now, Blue stripe then", { exact: false })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "This is Mia Reyes" }));
    expect(api.linkHistoricalPerson).toHaveBeenCalledWith(201, { student: 31, version: 4 });
  });

  it("goes on to the next person in the list it was opened from", async () => {
    const user = userEvent.setup();
    renderAt("/imports/people/201?list=READY&batch=7");

    await user.click(await screen.findByRole("button", { name: "Next" }));
    expect(where()).toBe("/imports/people/202?list=READY&batch=7");
  });

  it("asks which student where several fit, or offers to find one", async () => {
    const user = userEvent.setup();
    api.linkHistoricalPerson.mockResolvedValue(theo);
    renderAt("/imports/people/202?list=NEEDS_A_LOOK");

    await user.click(await screen.findByRole("button", { name: "This is Theo Lane" }));
    expect(api.linkHistoricalPerson).toHaveBeenCalledWith(202, { student: 41, version: 4 });
    expect(screen.getByRole("link", { name: "Find the student" })).toHaveAttribute(
      "href",
      "/imports/people/202/student?list=NEEDS_A_LOOK",
    );
  });

  it("marks someone not a current student, with a note when the reason is Other", async () => {
    const user = userEvent.setup();
    api.markNotAStudent.mockResolvedValue({ ...mia, state: "NOT_A_STUDENT" });
    renderAt("/imports/people/201");

    await user.click(await screen.findByRole("button", { name: "Not a current student" }));
    const dialog = screen.getByRole("dialog");
    const mark = within(dialog).getByRole("button", { name: "Mark not a student" });
    expect(mark).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Other" }));
    expect(mark).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Say why"), "A visiting instructor");
    await user.click(mark);

    expect(api.markNotAStudent).toHaveBeenCalledWith(201, {
      reason: "OTHER",
      note: "A visiting instructor",
      version: 4,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves someone for later", async () => {
    const user = userEvent.setup();
    api.leavePersonForLater.mockResolvedValue({ ...mia, state: "LATER" });
    renderAt("/imports/people/201");

    await user.click(await screen.findByRole("button", { name: "Leave for later" }));
    expect(api.leavePersonForLater).toHaveBeenCalledWith(201, 4);
  });

  it("offers only what the server says can be decided: a decided person can be undone", async () => {
    const user = userEvent.setup();
    const linked = person({
      state: "LINKED",
      queue: null,
      student: 31,
      student_name: "Mia Reyes",
      decided_by_name: "Sam Taylor",
      decisions: ["REOPEN"],
    });
    api.getHistoricalPerson.mockResolvedValue(linked);
    api.reopenHistoricalPerson.mockResolvedValue(mia);
    renderAt("/imports/people/201");

    expect(await screen.findByText("By Sam Taylor")).toBeVisible();
    expect(screen.getAllByText("Linked to Mia Reyes")[0]).toBeVisible();
    expect(screen.queryByRole("button", { name: "Not a current student" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Leave for later" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo the decision" }));
    expect(api.reopenHistoricalPerson).toHaveBeenCalledWith(201, 4);
  });

  it("confirms records that joined since with the decision already made", async () => {
    const user = userEvent.setup();
    api.getHistoricalPerson.mockResolvedValue(
      person({
        state: "LINKED",
        queue: "NEEDS_A_LOOK",
        student: 31,
        student_name: "Mia Reyes",
        awaiting_confirmation: 1,
        decisions: ["CONFIRM_JOINED", "REOPEN"],
      }),
    );
    api.linkHistoricalPerson.mockResolvedValue(mia);
    renderAt("/imports/people/201");

    await user.click(await screen.findByRole("button", { name: "Confirm the 1 new record" }));
    expect(api.linkHistoricalPerson).toHaveBeenCalledWith(201, { student: 31, version: 4 });
  });

  it("shows a refusal, such as a change since", async () => {
    const user = userEvent.setup();
    api.leavePersonForLater.mockRejectedValue(new ApiError("This person has changed since you looked.", 400));
    renderAt("/imports/people/201");

    await user.click(await screen.findByRole("button", { name: "Leave for later" }));
    expect(await screen.findByText("This person has changed since you looked.")).toBeVisible();
  });
});

describe("Splitting and merging", () => {
  it("moves the records ticked to a new person and opens them", async () => {
    const user = userEvent.setup();
    api.splitHistoricalPerson.mockResolvedValue(person({ id: 305 }));
    renderAt("/imports/people/201/split?list=READY");

    const move = await screen.findByRole("button", { name: "Move to a new person" });
    expect(move).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Mia R”/ }));
    await user.click(screen.getByRole("button", { name: "Move 1 record to a new person" }));

    expect(api.splitHistoricalPerson).toHaveBeenCalledWith(201, { records: [101], version: 4 });
    await waitFor(() => expect(where()).toBe("/imports/people/305?list=READY"));
  });

  it("keeps at least one record with the person", async () => {
    const user = userEvent.setup();
    renderAt("/imports/people/201/split");

    for (const box of await screen.findAllByRole("checkbox")) await user.click(box);
    expect(screen.getByRole("button", { name: "Move 2 records to a new person" })).toBeDisabled();
    expect(screen.getByText("At least one record stays with this person.")).toBeVisible();
  });

  it("finds another person by a name as written and merges them in", async () => {
    const user = userEvent.setup();
    api.getHistoricalPeople.mockResolvedValue(page([mia, theo]));
    api.mergeHistoricalPeople.mockResolvedValue(mia);
    renderAt("/imports/people/201/split");

    await user.type(await screen.findByLabelText("Find them by a name as written"), "theo");
    await user.click(await screen.findByRole("button", { name: "Merge Theo Lane into Mia Reyes" }));

    expect(api.getHistoricalPeople).toHaveBeenCalledWith({ search: "theo", page_size: 10 });
    expect(screen.queryByRole("button", { name: "Merge Mia Reyes into Mia Reyes" })).toBeNull();
    expect(api.mergeHistoricalPeople).toHaveBeenCalledWith(201, { other: 202, version: 4, other_version: 4 });
    await waitFor(() => expect(where()).toBe("/imports/people/201"));
  });
});

describe("Choosing the student", () => {
  it("finds a student by name and links the person to them", async () => {
    const user = userEvent.setup();
    api.getStudents.mockResolvedValue(
      page([
        {
          id: 41,
          first_name: "Theo",
          last_name: "Lane",
          current_rank_name: "White",
          age_band_display: "9-12",
          status_display: "Active",
          wksa_id: "104-2-417",
        },
      ]),
    );
    api.linkHistoricalPerson.mockResolvedValue(theo);
    renderAt("/imports/people/202/student?list=NEEDS_A_LOOK");

    await user.type(await screen.findByLabelText("A name or WKSA ID"), "lane");
    const found = await screen.findByRole("button", { name: /Theo Lane/ });
    expect(found).toHaveTextContent("White now · 9-12 · Active · 104-2-417");
    await user.click(found);

    expect(api.linkHistoricalPerson).toHaveBeenCalledWith(202, { student: 41, version: 4 });
    await waitFor(() => expect(where()).toBe("/imports/people/202?list=NEEDS_A_LOOK"));
  });
});

describe("A person not there", () => {
  it("says so", async () => {
    api.getHistoricalPerson.mockRejectedValue(new ApiError("Not found.", 404));
    renderAt("/imports/people/999");

    expect(await screen.findByText("Person not found")).toBeVisible();
  });
});
