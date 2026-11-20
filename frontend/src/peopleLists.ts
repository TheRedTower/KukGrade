import type { getHistoricalPeople, getHistoricalPeopleSummary, HistoricalPerson } from "./api";
import { useUrlFilters } from "./useUrlFilters";

type Summary = Awaited<ReturnType<typeof getHistoricalPeopleSummary>>;
type ListQuery = NonNullable<Parameters<typeof getHistoricalPeople>[0]>;

/** The lists the people of the imported history are sorted from. */
type PeopleList = "READY" | "NEEDS_A_LOOK" | "NO_STUDENT" | "LATER" | "LINKED" | "NOT_A_STUDENT";

interface ListMeaning {
  value: PeopleList;
  label: string;
  hint: string;
  count: (summary: Summary) => number;
  /** The people list's filter: a queue the server names, or a decision. */
  query: Pick<ListQuery, "queue" | "state">;
}

/** Waiting for a decision, in the order to work through them. */
export const QUEUES: readonly ListMeaning[] = [
  {
    value: "READY",
    label: "Ready to confirm",
    hint: "One student fits and the ranks agree",
    count: (summary) => summary.ready,
    query: { queue: "READY" },
  },
  {
    value: "NEEDS_A_LOOK",
    label: "Needs a look",
    hint: "Several students fit, or something disagrees",
    count: (summary) => summary.needs_a_look,
    query: { queue: "NEEDS_A_LOOK" },
  },
  {
    value: "NO_STUDENT",
    label: "No student found",
    hint: "Nobody in KukGrade looks like them",
    count: (summary) => summary.no_student,
    query: { queue: "NO_STUDENT" },
  },
];

/** Put aside, or decided. */
export const DECIDED: readonly ListMeaning[] = [
  {
    value: "LATER",
    label: "Later",
    hint: "Put aside for any administrator to come back to",
    count: (summary) => summary.later,
    query: { state: "LATER" },
  },
  {
    value: "LINKED",
    label: "Linked to a student",
    hint: "Their records are in that student's history",
    count: (summary) => summary.linked,
    query: { state: "LINKED" },
  },
  {
    value: "NOT_A_STUDENT",
    label: "Not a current student",
    hint: "Their records stay unlinked",
    count: (summary) => summary.not_a_student,
    query: { state: "NOT_A_STUDENT" },
  },
];

const ALL = [...QUEUES, ...DECIDED];

export function listMeaning(value: string | null): ListMeaning | null {
  return ALL.find((list) => list.value === value) ?? null;
}

/** How many people a list shows to a page; a person's Next follows the same pages. */
export const PEOPLE_PAGE_SIZE = 50;

interface PeoplePlace {
  person?: number;
  to?: "split" | "student";
  list?: string | null;
  batch?: number;
  /** The list's page and search, so Back and Next keep to the list as it was. */
  page?: number;
  search?: string;
}

/** The address of the people screens, keeping the list and the import a person was opened from. */
export function peoplePath(where: PeoplePlace) {
  const path = ["/imports/people", where.person, where.to].filter((part) => part !== undefined).join("/");
  const search = new URLSearchParams();
  if (where.list) search.set("list", where.list);
  if (where.batch) search.set("batch", String(where.batch));
  if (where.search) search.set("search", where.search);
  if (where.page && where.page > 1) search.set("page", String(where.page));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Who a person is, or may be, in a few words. */
export function whoTheyMayBe(person: HistoricalPerson): string {
  if (person.state === "LINKED") return `Linked to ${person.student_name ?? "a student"}`;
  if (person.state === "NOT_A_STUDENT") return `Not a current student: ${person.not_a_student_reason_display}`;
  if (person.state === "LATER") return "Left for later";
  const [best] = person.candidates;
  if (!best) return "No student found";
  return person.suggestion === "clear" ? `Suggested: ${best.full_name}` : `Could be ${best.full_name} or another`;
}

/** Where the person's page was opened from: a list (its page and search), and an import. */
export function usePeopleContext() {
  const filters = useUrlFilters();
  const list = listMeaning(filters.value("list") || null);
  const batch = Number(filters.value("batch")) || undefined;
  const search = filters.value("search").trim();
  const page = filters.page;
  return {
    list,
    batch,
    search,
    page,
    path: (where: PeoplePlace) => peoplePath({ list: list?.value, batch, search, page, ...where }),
  };
}
