import { useSiteSettingsQuery } from "./queries";
import { labelOf, useChoices } from "./choices";
import { useState } from "react";
import { ResponsiveTable } from "./ResponsiveTable";
import { ChoiceGroup } from "./ChoiceGroup";
import { BadgeTone } from "./badgeClass";
import { Badge } from "./Badge";
import { Link } from "react-router-dom";
import { type DataImportBatch, type DataImportRow, errorMessage } from "./api";
import { ErrorText } from "./ErrorText";
import { Pagination } from "./Pagination";
import { usePagedRows } from "./useImportRows";
import { importKinds } from "./importKinds";
import { useDebouncedValue } from "./useDebouncedValue";
import { buttonClass } from "./buttonClass";

const ROWS_PAGE_SIZE = 50;

export type RowFilter = "all" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "corrected" | "status" | "current_rank";

function rowState(row: DataImportRow, batch: DataImportBatch): { label: string; tone: BadgeTone } {
  if (row.outcome === "EXCLUDED" || row.outcome === "SKIP_EXISTING")
    return { label: row.outcome_display, tone: "neutral" };
  return { label: importKinds[batch.kind].ledger.saved(row), tone: "success" };
}

export function RowsLedger({
  batch,
  filter,
  onFilter,
}: {
  batch: DataImportBatch;
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
}) {
  const { addsStudents, ledger, rowName } = importKinds[batch.kind];
  const outcomes = useChoices().import_row_outcomes;
  const keptForDays = useSiteSettingsQuery().data?.imports.rows_kept_for_days;
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const rows = usePagedRows(
    batch.id,
    {
      outcome: filter === "READY" || filter === "SKIP_EXISTING" || filter === "EXCLUDED" ? filter : undefined,
      corrected: filter === "corrected" ? true : undefined,
      filled: filter === "status" || filter === "current_rank" ? filter : undefined,
      search: debounced || undefined,
    },
    ROWS_PAGE_SIZE,
  );
  const summary = batch.summary_json;
  const tabs: { key: RowFilter; label: string; count?: number }[] = ledger.tabs(summary, (value) =>
    labelOf(outcomes, value),
  );
  // A second-look filter shows as a chip of its own while it is in use.
  if (filter === "status") tabs.push({ key: "status", label: "Given a status" });
  if (filter === "current_rank") tabs.push({ key: "current_rank", label: "Given a rank" });
  const list = rows.results;
  const cleared = !rows.query.isPending && rows.count === 0 && filter === "all" && !debounced;

  return (
    <section aria-labelledby="ix-rows-h" className="card card--flush">
      <div className="ix-row ix-align-end">
        <h2 className="section-title ix-grow" id="ix-rows-h">
          {ledger.heading}
        </h2>
        <label className="field field--sentence">
          <span>Search</span>
          <input
            placeholder={ledger.search}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <ChoiceGroup
        choices={tabs.map((tab) => ({ value: tab.key, label: tab.label, count: tab.count }))}
        className="ix-chips-inset"
        label="Show"
        look="chips"
        value={filter}
        onChange={onFilter}
      />
      {rows.query.isError ? (
        <ErrorText className="ix-row">{errorMessage(rows.query.error, "The rows could not be loaded.")}</ErrorText>
      ) : cleared ? (
        <p className="ix-row subtext">
          The row-by-row list is kept {keptForDays === undefined ? "for a time" : `for ${keptForDays} days`} after an
          import, and this one’s has been cleared. The counts above stay for good.
        </p>
      ) : list.length === 0 && !rows.query.isPending ? (
        <p className="ix-row subtext">Nothing here.</p>
      ) : (
        <div className="ix-ruled">
          <ResponsiveTable
            flush
            label="Imported rows"
            rows={list}
            rowKey={(row) => row.row_number}
            columns={[
              { key: "name", header: "Name", primary: true, render: rowName },
              {
                key: "where",
                header: ledger.whereHeader,
                render: ledger.place,
              },
              { key: "details", header: "Details", render: (row) => ledger.detail(row, batch) },
              {
                key: "state",
                header: ledger.stateHeader,
                render: (row) => {
                  const state = rowState(row, batch);
                  return (
                    <Badge dot tone={state.tone}>
                      {state.label}
                    </Badge>
                  );
                },
              },
              {
                key: "open",
                header: "Open",
                actions: "inline",
                align: "end",
                render: (row) =>
                  addsStudents && row.created_id ? (
                    <Link
                      aria-label={`Open ${rowName(row)}`}
                      className={buttonClass({ variant: "link" })}
                      to={`/students/${row.created_id}`}
                    >
                      Open
                    </Link>
                  ) : null,
              },
            ]}
          />
        </div>
      )}
      <Pagination flush label="Pages of results" noun={importKinds[batch.kind].noun} {...rows.pager} />
    </section>
  );
}
