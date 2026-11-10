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
import { ImportPager } from "./ImportPager";
import { usePagedRows } from "./useImportRows";
import { importRowName } from "./importSteps";
import { useDebouncedValue } from "./useDebouncedValue";
import { buttonClass } from "./buttonClass";

const ROWS_PAGE_SIZE = 50;

export type RowFilter = "all" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "corrected" | "status" | "current_rank";

function rowDetail(row: DataImportRow, batch: DataImportBatch): string {
  const values = row.values;
  if (batch.kind === "STUDENT_ROSTER") {
    const names = row.corrected_fields.map(
      (field) => batch.target_fields.find((target) => target.field === field)?.name ?? field,
    );
    const fixes = names.length ? `your fix: ${names.join(", ")}` : "";
    return [values.wksa_id, values.current_rank, fixes].filter(Boolean).join(" · ");
  }
  if (values.note && !values.current_rank && !values.testing_for_rank) return `“${values.note}”`;
  const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
  return [ranks, values.outcome].filter(Boolean).join(" · ") || values.report || "";
}

function rowState(row: DataImportRow, roster: boolean): { label: string; tone: BadgeTone } {
  if (row.outcome === "EXCLUDED" || row.outcome === "SKIP_EXISTING") return { label: row.outcome_display, tone: "neutral" };
  if (!roster) return { label: "Imported", tone: "success" };
  return { label: row.corrected_fields.length ? "Added, your fix" : "Added", tone: "success" };
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
  const roster = batch.kind === "STUDENT_ROSTER";
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
  const tabs: { key: RowFilter; label: string; count?: number }[] = roster
    ? [
        { key: "all", label: "All rows", count: summary.total },
        { key: "READY", label: "Added", count: summary.created },
        { key: "SKIP_EXISTING", label: labelOf(outcomes, "SKIP_EXISTING"), count: summary.skipped_existing },
        { key: "EXCLUDED", label: labelOf(outcomes, "EXCLUDED"), count: summary.excluded },
        { key: "corrected", label: "Your fixes" },
      ]
    : [
        { key: "all", label: "All records" },
        { key: "READY", label: "Imported", count: summary.total },
        { key: "EXCLUDED", label: labelOf(outcomes, "EXCLUDED"), count: summary.excluded },
      ];
  // A second-look filter shows as a chip of its own while it is in use.
  if (filter === "status") tabs.push({ key: "status", label: "Given a status" });
  if (filter === "current_rank") tabs.push({ key: "current_rank", label: "Given a rank" });
  const list = rows.query.data?.results ?? [];
  const cleared = !rows.query.isPending && rows.total === 0 && filter === "all" && !debounced;

  return (
    <section aria-labelledby="ix-rows-h" className="card card--flush">
      <div className="ix-row ix-align-end">
        <h2 className="section-title ix-grow" id="ix-rows-h">
          {roster ? "Every row" : "Every record"}
        </h2>
        <label className="field field--sentence">
          <span>Search</span>
          <input
            placeholder={roster ? "Name or WKSA ID" : "Name or comment"}
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
        <ErrorText className="ix-row">
          {errorMessage(rows.query.error, "The rows could not be loaded.")}
        </ErrorText>
      ) : cleared ? (
        <p className="ix-row subtext">
          The row-by-row list is kept {keptForDays === undefined ? "for a time" : `for ${keptForDays} days`} after an import, and this one’s has been
          cleared. The counts above stay for good.
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
              { key: "name", header: "Name", primary: true, render: (row) => importRowName(row, batch.kind) },
              {
                key: "where",
                header: roster ? "Row" : "Sheet · row",
                render: (row) => (roster ? row.row_number : row.source_locator.replaceAll("!", " · ")),
              },
              { key: "details", header: "Details", render: (row) => rowDetail(row, batch) },
              {
                key: "state",
                header: roster ? "What happened" : "Now",
                render: (row) => {
                  const state = rowState(row, roster);
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
                  roster && row.created_id ? (
                    <Link
                      aria-label={`Open ${importRowName(row, batch.kind)}`}
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
      <ImportPager label="Pages of results" page={rows.page} pages={rows.pages} total={rows.total} onPage={rows.setPage} />
    </section>
  );
}
