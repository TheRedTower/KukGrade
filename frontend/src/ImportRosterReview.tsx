import { Fragment, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { type DataImportBatch, type DataImportRow, correctDataImportRow, errorMessage, leaveOutDataImportRowsNeedingAttention } from "./api";
import { ErrorText } from "./ErrorText";
import { ImportCellInput } from "./ImportCellInput";
import { usePagedRows } from "./useImportRows";
import { counted, importRowName } from "./importSteps";
import { useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { Button } from "./Button";
import { CountTiles, ExclusionButton, LastLook, ListHead, RowsList } from "./ImportReviewParts";
import { Exclusion, PAGE_SIZE, RowParams, STATUSES, Tile, useRowExclusion } from "./importReviewRows";

/** The same source-preserving correction controls in every roster review view. */
function RosterRowEditor({
  batch,
  row,
  exclusion,
  onFixed,
  onEditStateChange,
}: {
  batch: DataImportBatch;
  row: DataImportRow;
  exclusion: Exclusion;
  onFixed: (row: DataImportRow) => Promise<void>;
  onEditStateChange: (key: string, dirty: boolean) => void;
}) {
  const ranks = useRanksQuery().data?.results ?? [];
  const fix = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string | null }) =>
      correctDataImportRow(batch.id, row.row_number, { [field]: value }),
    onSuccess: onFixed,
  });

  async function save(field: string, value: string | null) {
    const key = `${row.row_number}:${field}`;
    onEditStateChange(key, true);
    await fix.mutateAsync({ field, value });
    onEditStateChange(key, false);
  }

  return (
    <div className={`ix-row${row.issues.length ? " ix-attention" : ""}`}>
      <div className="ix-actions ix-actions-split ix-align-start">
        <div className="ix-row-main">
          <p className="ix-strong">
            Row {row.row_number} · {importRowName(row, batch.kind)}
          </p>
          {row.issues.length ? <p className="ix-why">{row.issues.join(" ")}</p> : null}
        </div>
        {row.outcome === "REVIEW_REQUIRED" ? (
          <Button
            aria-label={`Leave this row out, row ${row.row_number}`}
            variant="ghost"
            disabled={exclusion.isPending}
            onClick={() => exclusion.mutate({ row, excluded: true })}
          >
            Leave this row out
          </Button>
        ) : <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />}
      </div>
      {batch.extra_columns.length ? (
        <p className="ix-muted ix-small">{batch.extra_columns.map((column) => `${column}: ${row.extra[column] ?? "(blank)"}`).join(" · ")}</p>
      ) : null}
      <div className="ix-field-grid">
        {batch.target_fields.map((field) => {
          const value = row.values[field.field] ?? "";
          const bad = row.issue_fields.includes(field.field);
          const corrected = row.corrected_fields.includes(field.field);
          const label = `${field.name}, row ${row.row_number}`;
          let control;
          if (field.field === "current_rank" || field.field === "status") {
            const options =
              field.field === "current_rank" ? ranks.map((rank) => ({ value: rank.name, label: rank.name })) : STATUSES;
            const known = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
            control = (
              <select
                aria-invalid={bad}
                aria-label={label}
                className={bad ? "ix-cell-invalid" : corrected ? "ix-cell-changed" : undefined}
                disabled={fix.isPending}
                value={known ? known.value : value}
                onChange={(event) => void save(field.field, event.target.value).catch(() => {})}
              >
                {known ? null : <option value={value}>{value ? `${value} (not recognised)` : "Choose…"}</option>}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            );
          } else {
            control = (
              <ImportCellInput
                changed={corrected}
                invalid={bad}
                label={label}
                placeholder={field.field === "date_of_birth" ? "dd/mm/yyyy" : undefined}
                value={value}
                onDirtyChange={(dirty) => onEditStateChange(`${row.row_number}:${field.field}`, dirty)}
                onSave={(next) => save(field.field, next)}
              />
            );
          }
          return (
            <div key={field.field}>
              <span aria-hidden="true" className={`ix-field-label${bad ? " ix-label-invalid" : ""}`}>
                {field.name}
              </span>
              {control}
              {corrected ? (
                <span className="ix-fix-note">
                  File had “{row.file_values[field.field] || "nothing"}”
                  <button aria-label={`Undo the fix to ${label}`} type="button" onClick={() => void save(field.field, null).catch(() => {})}>
                    Undo
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {fix.isError ? (
        <ErrorText className="ix-small ix-flush">
          {errorMessage(fix.error, "That fix could not be saved.")}
        </ErrorText>
      ) : null}
    </div>
  );
}

type RosterView = "attention" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "check";

export function RosterReview({
  batch,
  announce,
  onRefresh,
  onMatch,
  onEditStateChange,
}: {
  batch: DataImportBatch;
  announce: (text: string) => void;
  onRefresh: () => Promise<void>;
  onMatch: () => void;
  onEditStateChange: (key: string, dirty: boolean) => void;
}) {
  const counts = batch.row_counts;
  const [view, setView] = useState<RosterView>(counts.review_required ? "attention" : "check");
  const [editing, setEditing] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const searchable = view !== "attention";
  const params: RowParams = {
    outcome: view === "attention" ? "REVIEW_REQUIRED" : view === "check" ? "READY" : view,
    search: searchable && debounced ? debounced : undefined,
  };
  const rows = usePagedRows(batch.id, params, PAGE_SIZE);
  const exclusion = useRowExclusion(batch, onRefresh, announce);
  const leaveRest = useMutation({
    mutationFn: () => leaveOutDataImportRowsNeedingAttention(batch.id),
    onSuccess: async () => {
      announce("Every row that needed attention is left out.");
      await onRefresh();
    },
  });

  async function fixed(row: DataImportRow) {
    if (row.outcome === "READY") announce(`Row ${row.row_number} is ready.`);
    await onRefresh();
  }

  const tiles: Tile<RosterView>[] = [
    { key: "READY", label: "Ready to add", count: counts.ready, tone: "ix-success-text", mark: "✓" },
    { key: "attention", label: "Need attention", count: counts.review_required, tone: "ix-warning-text", mark: "!" },
    { key: "SKIP_EXISTING", label: "Already in KukGrade", count: counts.skip_existing, tone: "", mark: "↷" },
    { key: "EXCLUDED", label: "Left out", count: counts.excluded, tone: "ix-muted", mark: "–" },
  ];
  const heads: Record<RosterView, [string, string]> = {
    attention: [
      "Rows that need attention",
      "Fix what is marked, or leave the row out. Each fix is saved and checked again straight away. Nothing is imported until you confirm.",
    ],
    READY: ["Ready to add", "These rows will be added as new students."],
    SKIP_EXISTING: [
      "Already in KukGrade",
      "A student with the same WKSA ID is already here, so the row is skipped. Nothing about that student changes.",
    ],
    EXCLUDED: ["Left out", "These rows will not be imported. Bring one back any time before you confirm."],
    check: [
      `${counted(counts.ready, "student", "students")} will be added`,
      "In file order, as KukGrade will save them. A fix of yours is marked. Rows already in KukGrade, left out or still needing attention are not in this list.",
    ],
  };

  return (
    <>
      <CountTiles tiles={tiles} view={view} onView={setView} />
      <LastLook
        label={`Look over all ${counted(counts.ready, "new student", "new students")}`}
        lead="See every student who will be added, exactly as they will be saved, your fixes included."
        pressed={view === "check"}
        onShow={() => setView("check")}
      />

      <section aria-labelledby="ix-review-list" className="card card--flush">
        <ListHead
          lead={heads[view][1]}
          search={searchable ? { value: search, hint: "Name or WKSA ID", onChange: setSearch } : undefined}
          title={heads[view][0]}
        />
        {view === "attention" && counts.review_required === 0 ? (
          <p className="ix-row ix-success-text ix-bold">✓ Nothing needs attention. Every row will be imported or left out as shown.</p>
        ) : (
          <RowsList exclusion={exclusion} rows={rows}>
            {(list) =>
              view === "attention" ? (
                list.map((row) => <RosterRowEditor batch={batch} exclusion={exclusion} key={row.row_number} row={row} onEditStateChange={onEditStateChange} onFixed={fixed} />)
              ) : view === "check" ? (
                <div className="ix-table-wrap ix-ruled">
                  <table className="ix-table">
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        {batch.target_fields.map((field) => (
                          <th key={field.field} scope="col">
                            {field.name}
                          </th>
                        ))}
                        {batch.extra_columns.map((column) => (
                          <th key={column} scope="col">
                            {column} (extra)
                          </th>
                        ))}
                        <th scope="col">
                          <span className="ix-visually-hidden">Change</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((row) => (
                        <Fragment key={row.row_number}>
                        <tr>
                          <td className="ix-muted">{row.row_number}</td>
                          {batch.target_fields.map((field) => (
                            <td key={field.field}>
                              {row.values[field.field] || <span className="ix-muted">(blank)</span>}
                              {row.corrected_fields.includes(field.field) ? <span className="ix-fix-note">Your fix</span> : null}
                            </td>
                          ))}
                          {batch.extra_columns.map((column) => (
                            <td className="ix-muted" key={column}>
                              {row.extra[column] ?? ""}
                            </td>
                          ))}
                          <td className="ix-cell-action">
                            <Button variant="link" aria-expanded={editing === row.row_number} onClick={() => setEditing(editing === row.row_number ? null : row.row_number)}>
                              {editing === row.row_number ? "Close editor" : `Edit row ${row.row_number}`}
                            </Button>
                            <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />
                          </td>
                        </tr>
                        {editing === row.row_number ? <tr><td colSpan={batch.target_fields.length + batch.extra_columns.length + 2}>
                          <RosterRowEditor batch={batch} exclusion={exclusion} row={row} onEditStateChange={onEditStateChange} onFixed={fixed} />
                        </td></tr> : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                list.map((row) => <RosterRowEditor batch={batch} exclusion={exclusion} key={row.row_number} row={row} onEditStateChange={onEditStateChange} onFixed={fixed} />)
              )
            }
          </RowsList>
        )}
      </section>

      <div className="step-foot">
        <Button variant="ghost" onClick={onMatch}>
          Back to matching
        </Button>
        {counts.review_required ? (
          <div className="ix-actions">
            <span className="ix-why">
              Fix or leave out the {counted(counts.review_required, "row that needs", "rows that need")} attention first.
            </span>
            <Button variant="secondary" disabled={leaveRest.isPending} onClick={() => leaveRest.mutate()}>
              {leaveRest.isPending ? "Leaving out…" : `Leave out the ${counts.review_required} left`}
            </Button>
          </div>
        ) : (
          <span className="ix-muted ix-small">Change anything on this page until you confirm.</span>
        )}
      </div>
      {leaveRest.isError ? (
        <ErrorText>
          {errorMessage(leaveRest.error, "Those rows could not be left out.")}
        </ErrorText>
      ) : null}
    </>
  );
}
