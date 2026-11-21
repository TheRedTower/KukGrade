import { useMutation } from "@tanstack/react-query";

import { ActionBar } from "./ActionBar";
import { Alert } from "./Alert";
import {
  type HistoricalPerson,
  confirmHistoricalPeople,
  errorMessage,
  getAllHistoricalPeople,
  getHistoricalPeople,
} from "./api";
import { Button } from "./Button";
import { ErrorText } from "./ErrorText";
import { periodRange } from "./linkRecords";
import { LoadingState } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { Pagination } from "./Pagination";
import { DECIDED, listMeaning, PEOPLE_PAGE_SIZE, peoplePath, QUEUES, whoTheyMayBe } from "./peopleLists";
import { counted } from "./plural";
import { Progress } from "./Progress";
import { useSiteSettingsQuery } from "./queries";
import { QueueList } from "./QueueList";
import { keys } from "./queryKeys";
import { SearchField } from "./SearchField";
import { useLegacyRefresh } from "./useLegacyRefresh";
import { usePeopleSummary } from "./usePerson";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";

/**
 * The people the imported history is about, to be sorted: how many are, and
 * a queue for each kind of decision still to make, then the ones put aside
 * and the ones decided. Each opens its list (?list=), and each person their
 * own page. `?batch=` narrows it all to one import.
 */
export function PeopleScreen() {
  const filters = useUrlFilters();
  const batch = Number(filters.value("batch")) || undefined;
  const list = listMeaning(filters.value("list") || null);
  const summary = usePeopleSummary(batch);
  const counts = summary.data;
  const back = list
    ? { to: peoplePath({ batch }), label: "People" }
    : { to: batch ? `/imports/${batch}` : "/imports", label: batch ? "The import" : "Imports" };

  return (
    <section aria-labelledby="ppl-title" className="page">
      <PageHeader
        back={back}
        eyebrow="Past gradings"
        title={list ? list.label : "Sort the people"}
        titleId="ppl-title"
        subtitle={list ? list.hint : "Who each person in the past gradings is. Nothing is linked until you say so."}
      >
        {counts ? <Progress done={counts.sorted} total={counts.people} what="people sorted" /> : null}
      </PageHeader>
      {summary.isError ? (
        <ErrorText>{errorMessage(summary.error, "The people could not be counted.")}</ErrorText>
      ) : null}
      {list ? (
        <PeopleList batch={batch} list={list.value} query={list.query} />
      ) : summary.isPending ? (
        <LoadingState>Counting the people…</LoadingState>
      ) : counts ? (
        <>
          <section aria-labelledby="ppl-waiting" className="stack stack--3">
            <h2 className="section-title" id="ppl-waiting">
              Still to sort
            </h2>
            <QueueList
              label="Still to sort"
              queues={QUEUES.map((queue) => ({
                to: peoplePath({ list: queue.value, batch }),
                label: queue.label,
                hint: queue.hint,
                count: queue.count(counts),
              }))}
            />
          </section>
          <section aria-labelledby="ppl-decided" className="stack stack--3">
            <h2 className="section-title" id="ppl-decided">
              Put aside and decided
            </h2>
            <QueueList
              label="Put aside and decided"
              queues={DECIDED.map((decided) => ({
                to: peoplePath({ list: decided.value, batch }),
                label: decided.label,
                hint: decided.hint,
                count: decided.count(counts),
              }))}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}

function PeopleList({
  list,
  query,
  batch,
}: {
  list: string;
  query: NonNullable<Parameters<typeof getHistoricalPeople>[0]>;
  batch: number | undefined;
}) {
  const filters = useUrlFilters();
  const page = filters.page;
  const search = filters.value("search").trim();
  const paged = usePagedQuery({
    queryKey: keys.legacyPeople.list(list, batch, search, page),
    page,
    pageSize: PEOPLE_PAGE_SIZE,
    onPage: filters.setPage,
    queryFn: () =>
      getHistoricalPeople({ ...query, batch, search: search || undefined, page, page_size: PEOPLE_PAGE_SIZE }),
  });
  const people = paged.results;

  return (
    <>
      <SearchField
        label="Search by a name as written"
        value={filters.value("search")}
        onChange={(value) => filters.set({ search: value || null, page: null })}
      />
      {paged.query.isPending ? (
        <LoadingState>Loading the people…</LoadingState>
      ) : paged.query.isError ? (
        <ErrorText>{errorMessage(paged.query.error, "The people could not be loaded.")}</ErrorText>
      ) : people.length === 0 ? (
        <p className="card subtext">{search ? `Nobody here is written “${search}”.` : "Nobody is in this list."}</p>
      ) : (
        <>
          <QueueList
            label="People"
            queues={people.map((person: HistoricalPerson) => ({
              to: peoplePath({ person: person.id, list, batch, search, page }),
              label: person.name,
              hint: `${counted(person.record_count, "record", "records")} · ${periodRange(person)} · ${whoTheyMayBe(person)}`,
            }))}
          />
          <Pagination flush label="Pages of people" noun={["person", "people"]} {...paged.pager} />
        </>
      )}
      {list === "READY" && !search ? <ConfirmAll batch={batch} /> : null}
    </>
  );
}

/**
 * Confirms everyone ready to confirm, each to the student suggested for them,
 * at once and all or nothing: no more than one request takes.
 */
function ConfirmAll({ batch }: { batch: number | undefined }) {
  const refresh = useLegacyRefresh();
  const limit = useSiteSettingsQuery().data?.imports.bulk_link_limit;
  const summary = usePeopleSummary(batch);
  const ready = summary.data?.ready ?? 0;
  const confirm = useMutation({
    mutationFn: async () => {
      const everyone = await getAllHistoricalPeople({ queue: "READY", batch });
      const confirmations = everyone.results
        .slice(0, limit)
        .flatMap((person) =>
          person.candidates[0]
            ? [{ person: person.id, student: person.candidates[0].student, version: person.version }]
            : [],
        );
      return confirmHistoricalPeople(confirmations);
    },
    onSettled: refresh,
  });
  if (ready === 0 && !confirm.isSuccess) return null;
  const some = limit !== undefined && ready > limit;

  return (
    <>
      {confirm.isError ? (
        <Alert title="Nobody was confirmed.">
          {errorMessage(confirm.error, "Someone changed since you looked. Look over the list and try again.")}
        </Alert>
      ) : null}
      <ActionBar
        status={
          <p className="subtext">
            {confirm.isSuccess
              ? `${counted(confirm.data.length, "person", "people")} confirmed`
              : "Each to the student suggested. Look over the list first."}
          </p>
        }
      >
        <Button
          variant="primary"
          disabled={confirm.isPending || ready === 0 || !limit}
          onClick={() => confirm.mutate()}
        >
          {confirm.isPending
            ? "Confirming…"
            : some
              ? `Confirm the first ${limit}`
              : `Confirm all ${counted(ready, "person", "people")}`}
        </Button>
      </ActionBar>
    </>
  );
}
