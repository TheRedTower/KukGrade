import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { errorMessage, getAllDataImportBatches, getLegacyGradingRecords, type LegacyGradingRecord } from "./api";
import { buttonClass } from "./buttonClass";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { recordMonth } from "./linkRecords";
import { LoadingState } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { Pagination } from "./Pagination";
import { QueueList } from "./QueueList";
import { keys } from "./queryKeys";
import { SearchField } from "./SearchField";
import { Select } from "./Select";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import "./Imports.css";

type Filter = "all" | "unlinked" | "linked" | "voided";

const PAGE_SIZE = 50;

const RECORD_FILTERS = [
  { value: "unlinked", label: "Unlinked" },
  { value: "linked", label: "Linked" },
  { value: "voided", label: "Voided" },
];

/** A record in a line: who it is linked to, and its ranks and outcome as read. */
function recordHint(record: LegacyGradingRecord): string {
  const ranks = [
    record.current_rank_name ?? record.source_current_rank_text,
    record.testing_for_rank_name ?? record.source_testing_for_rank_text,
  ]
    .filter(Boolean)
    .join(" → ");
  const who = record.is_void ? "Voided" : record.student_display_name || "Not linked";
  return [who, ranks, record.outcome_display || record.attendance_status_display].filter(Boolean).join(" · ");
}

/**
 * Every imported record, found again by the name as written, by import and
 * by whether it is linked: each a two-line card that opens the record's own
 * page (HistoricalRecordScreen).
 */
export function HistoricalRecordsScreen() {
  const filters = useUrlFilters();
  const filter: Filter = filters.oneOf("filter", ["all", "unlinked", "linked", "voided"] as const, "all");
  const page = filters.page;
  const batch = Number(filters.value("batch")) || undefined;
  const search = filters.value("search");
  const searched = search.trim();

  const imports = useQuery({
    queryKey: keys.imports.historical(),
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const paged = usePagedQuery({
    queryKey: keys.legacyRecords.browse(filter, page, batch, searched),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
    queryFn: () =>
      getLegacyGradingRecords({
        page,
        page_size: PAGE_SIZE,
        batch,
        search: searched || undefined,
        linked: filter === "linked" ? true : filter === "unlinked" ? false : undefined,
        voided: filter === "voided" ? true : filter === "linked" || filter === "unlinked" ? false : undefined,
      }),
  });
  const records = paged.query;
  const query = filters.query ? `?${filters.query}` : "";

  return (
    <section aria-labelledby="ix-history-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        eyebrow="Past gradings"
        title="Historical records"
        titleId="ix-history-title"
        subtitle="Find an imported record again. The workbook's text stays as written."
        actions={
          <Link className={buttonClass({ variant: "secondary" })} to="/imports/people">
            Sort the people
          </Link>
        }
      />
      <SearchField label="Name as written" value={search} onChange={(value) => filters.set({ search: value })} />
      <div className="filter-bar">
        <Field label="Show">
          {(control) => (
            <Select
              {...control}
              all="All records"
              allValue="all"
              options={RECORD_FILTERS}
              value={filter}
              onChange={(value) => filters.set({ filter: value === "all" ? null : value })}
            />
          )}
        </Field>
        <Field label="Import">
          {(control) => (
            <Select
              {...control}
              all="Every import"
              options={(imports.data?.results ?? []).map((item) => ({
                value: String(item.id),
                label: item.original_filename,
              }))}
              value={String(batch ?? "")}
              onChange={(value) => filters.set({ batch: value })}
            />
          )}
        </Field>
      </div>
      {records.isPending ? (
        <LoadingState>Loading records…</LoadingState>
      ) : records.isError ? (
        <ErrorText>{errorMessage(records.error, "Records could not be loaded.")}</ErrorText>
      ) : records.data.results.length === 0 ? (
        <p className="card subtext">No records match these filters.</p>
      ) : (
        <>
          <QueueList
            label="Records"
            queues={records.data.results.map((record) => ({
              to: `/imports/history/${record.id}${query}`,
              label: `“${record.source_name}” · ${recordMonth(record)}`,
              hint: recordHint(record),
            }))}
          />
          <Pagination flush label="Pages of records" noun={["record", "records"]} {...paged.pager} />
        </>
      )}
    </section>
  );
}
