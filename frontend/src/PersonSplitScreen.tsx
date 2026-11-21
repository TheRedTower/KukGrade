import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  type HistoricalPersonDetail,
  errorMessage,
  getHistoricalPeople,
  mergeHistoricalPeople,
  moveHistoricalRecords,
  splitHistoricalPerson,
} from "./api";
import { Button } from "./Button";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { periodRange, recordMonth } from "./linkRecords";
import { LoadingState } from "./LoadingState";
import { Pagination } from "./Pagination";
import { usePeopleContext } from "./peopleLists";
import { counted } from "./plural";
import { keys } from "./queryKeys";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { SearchField } from "./SearchField";
import { useDebouncedValue } from "./useDebouncedValue";
import { useDecision, usePerson } from "./usePerson";
import { usePagedQuery } from "./usePagedQuery";

const MERGE_PAGE_SIZE = 10;

/**
 * When a person's records are not all one person, tick the ones that are
 * someone else and move them to a new person, or to someone already here;
 * when two people are one, find the other and merge them. Each can be undone
 * the other way round. Opened from a record (`?record=`), that record comes
 * ticked and the page goes back to it.
 */
export function PersonSplitScreen() {
  const id = useIdParam();
  const navigate = useNavigate();
  const context = usePeopleContext();
  const person = usePerson(id);
  const [params] = useSearchParams();
  const fromRecord = Number(params.get("record")) || null;
  const [ticked, setTicked] = useState<number[]>(fromRecord ? [fromRecord] : []);
  const backToRecord = fromRecord ? `/imports/history/${fromRecord}` : null;
  const split = useDecision<HistoricalPersonDetail>((moved) =>
    navigate(backToRecord ?? context.path({ person: moved.id })),
  );

  const status = recordStatus(id, person);
  if (status || !person.data) {
    return (
      <RecordPage
        back={{ to: context.path({}), label: "People" }}
        error={person.error}
        failed="This person could not be loaded."
        label="Split or merge"
        missing="Person not found"
        status={status ?? "loading"}
        onRetry={() => void person.refetch()}
      />
    );
  }
  const shown = person.data;
  // Only this person's records count: one ticked from a record page may have
  // moved on since.
  const chosen = ticked.filter((record) => shown.records.some((own) => own.id === record));
  const all = chosen.length === shown.records.length;

  return (
    <DetailPage
      actions={
        <Button
          variant="primary"
          disabled={split.isPending || chosen.length === 0 || all}
          onClick={() =>
            split.mutate(() => splitHistoricalPerson(shown.id, { records: chosen, version: shown.version }))
          }
        >
          {chosen.length
            ? `Move ${counted(chosen.length, "record", "records")} to a new person`
            : "Move to a new person"}
        </Button>
      }
      back={
        backToRecord
          ? { to: backToRecord, label: "Historical record" }
          : { to: context.path({ person: shown.id }), label: shown.name }
      }
      eyebrow="Past gradings · Sort the people"
      status={
        <p className="subtext">
          {all ? "At least one record stays with this person." : "Tick the records that are someone else."}
        </p>
      }
      testId="pp-split"
      title={`Split or merge ${shown.name}`}
    >
      <section aria-labelledby="pp-split-records" className="card stack stack--3">
        <h2 className="section-title" id="pp-split-records">
          These aren’t all the same person
        </h2>
        <ul className="list-plain stack stack--2">
          {shown.records.map((record) => (
            <li key={record.id}>
              <label className="check">
                <input
                  checked={ticked.includes(record.id)}
                  type="checkbox"
                  onChange={(event) =>
                    setTicked((now) =>
                      event.target.checked ? [...now, record.id] : now.filter((other) => other !== record.id),
                    )
                  }
                />
                <span className="check__text">
                  <span className="item-title">
                    {recordMonth(record)} · “{record.source_name}”
                  </span>
                  <span className="subtext">
                    {[record.source_current_rank_text, record.source_testing_for_rank_text].filter(Boolean).join(" → ")}
                    {record.outcome_display ? ` · ${record.outcome_display}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {split.isError ? <ErrorText>{errorMessage(split.error, "Those records could not be moved.")}</ErrorText> : null}
      </section>
      <MergeWith
        moving={all ? [] : chosen}
        person={shown}
        onMerged={() => navigate(backToRecord ?? context.path({ person: shown.id }))}
      />
    </DetailPage>
  );
}

/**
 * Another person who is this one, found by a name as written, merged in; or,
 * with some of this person's records ticked (`moving`), the person those are,
 * and they move there.
 */
function MergeWith({
  moving,
  person,
  onMerged,
}: {
  moving: number[];
  person: HistoricalPersonDetail;
  onMerged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const searched = useDebouncedValue(search.trim());
  // Every match can be reached, a page at a time: people written alike are
  // told apart by their records, not by a longer search.
  const paged = usePagedQuery({
    queryKey: keys.legacyPeople.list("merge", searched, page),
    page,
    pageSize: MERGE_PAGE_SIZE,
    onPage: setPage,
    queryFn: () => getHistoricalPeople({ search: searched, page, page_size: MERGE_PAGE_SIZE }),
    enabled: searched.length >= 2,
  });
  const found = paged.query;
  const merge = useDecision<unknown>(onMerged);
  const others = (found.data?.results ?? []).filter((other) => other.id !== person.id);

  return (
    <section aria-labelledby="pp-merge" className="card stack stack--3">
      <h2 className="section-title" id="pp-merge">
        {moving.length ? "Or move them to someone already here" : "The same person as someone else"}
      </h2>
      <SearchField
        label="Find them by a name as written"
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />
      {found.isFetching && !found.data ? <LoadingState compact>Looking…</LoadingState> : null}
      {found.isError ? <ErrorText>{errorMessage(found.error, "Nobody could be looked for.")}</ErrorText> : null}
      {searched.length >= 2 && found.isSuccess && others.length === 0 ? (
        <p className="subtext">Nobody else is written “{searched}”.</p>
      ) : null}
      <ul className="list-plain stack stack--3">
        {others.map((other) => (
          <li className="row row--wrap" key={other.id}>
            <span className="stack stack--1">
              <span className="item-title">{other.name}</span>
              <span className="subtext">
                {counted(other.record_count, "record", "records")} · {periodRange(other)} · {other.state_display}
              </span>
            </span>
            {moving.length ? (
              <Button
                aria-label={`Move ${counted(moving.length, "record", "records")} to ${other.name}`}
                variant="secondary"
                disabled={merge.isPending}
                onClick={() =>
                  merge.mutate(() =>
                    moveHistoricalRecords(person.id, {
                      records: moving,
                      to: other.id,
                      version: person.version,
                      to_version: other.version,
                    }),
                  )
                }
              >
                Move here
              </Button>
            ) : (
              <Button
                aria-label={`Merge ${other.name} into ${person.name}`}
                variant="secondary"
                disabled={merge.isPending}
                onClick={() =>
                  merge.mutate(() =>
                    mergeHistoricalPeople(person.id, {
                      other: other.id,
                      version: person.version,
                      other_version: other.version,
                    }),
                  )
                }
              >
                Merge
              </Button>
            )}
          </li>
        ))}
      </ul>
      {searched.length >= 2 ? (
        <Pagination flush label="Pages of people found" noun={["person", "people"]} {...paged.pager} />
      ) : null}
      {merge.isError ? (
        <ErrorText>
          {errorMessage(merge.error, moving.length ? "Those records could not be moved." : "They could not be merged.")}
        </ErrorText>
      ) : null}
    </section>
  );
}
