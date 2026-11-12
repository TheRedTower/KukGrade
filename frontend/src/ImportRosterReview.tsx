import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type DataImportBatch,
  type DataImportRow,
  correctDataImportRow,
  errorMessage,
  leaveOutDataImportRowsNeedingAttention,
} from "./api";
import { ErrorText } from "./ErrorText";
import { ImportCellInput } from "./ImportCellInput";
import { usePagedRows } from "./useImportRows";
import { importKinds } from "./importKinds";
import { useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { Button } from "./Button";
import { ResponsiveTable } from "./ResponsiveTable";
import { CountTiles, ExclusionButton, LastLook, ListHead, RowsList } from "./ImportReviewParts";
import { Exclusion, PAGE_SIZE, RowParams, Tile, useRowExclusion } from "./importReviewRows";
import { labelOf, useChoices } from "./choices";
import { counted } from "./plural";
import { cx } from "./cx";
import { CheckIcon, ExclamationIcon, MinusIcon, SkipIcon } from "./Icons";

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
  const statuses = useChoices().student_statuses;
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
    <div className={cx("ix-row", row.issues.length > 0 && "ix-attention")}>
      <div className="action-row ix-align-start">
        <div className="ix-row-main">
          <p className="item-title">
            Row {row.row_number} · {importKinds[batch.kind].rowName(row)}
          </p>
          {row.issues.length ? <p className="ix-why error-text">{row.issues.join(" ")}</p> : null}
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
        ) : (
          <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />
        )}
      </div>
      {batch.extra_columns.length ? (
        <p className="subtext">
          {batch.extra_columns.map((column) => `${column}: ${row.extra[column] ?? "(blank)"}`).join(" · ")}
        </p>
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
              field.field === "current_rank" ? ranks.map((rank) => ({ value: rank.name, label: rank.name })) : statuses;
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
              <span aria-hidden="true" className={cx("ix-field-label item-title", bad && "ix-label-invalid")}>
                {field.name}
              </span>
              {control}
              {corrected ? (
                <span className="ix-fix-note meta">
                  File had “{row.file_values[field.field] || "nothing"}”
                  <Button
                    variant="link"
                    aria-label={`Undo the fix to ${label}`}
                    onClick={() => void save(field.field, null).catch(() => {})}
                  >
                    Undo
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {fix.isError ? (
        <ErrorText className="ix-flush">{errorMessage(fix.error, "That fix could not be saved.")}</ErrorText>
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

  const outcomes = useChoices().import_row_outcomes;
  const skipped = labelOf(outcomes, "SKIP_EXISTING");
  const leftOut = labelOf(outcomes, "EXCLUDED");
  const tiles: Tile<RosterView>[] = [
    {
      key: "READY",
      label: "Ready to add",
      count: counts.ready,
      tone: "ix-success-text",
      mark: <CheckIcon size={22} />,
    },
    {
      key: "attention",
      label: "Need attention",
      count: counts.review_required,
      tone: "ix-warning-text",
      mark: <ExclamationIcon size={22} />,
    },
    { key: "SKIP_EXISTING", label: skipped, count: counts.skip_existing, tone: "", mark: <SkipIcon size={22} /> },
    { key: "EXCLUDED", label: leftOut, count: counts.excluded, tone: "subtext", mark: <MinusIcon size={22} /> },
  ];
  const heads: Record<RosterView, [string, string]> = {
    attention: [
      "Rows that need attention",
      "Fix what is marked, or leave the row out. Each fix is saved and checked again straight away. Nothing is imported until you confirm.",
    ],
    READY: ["Ready to add", "These rows will be added as new students."],
    SKIP_EXISTING: [
      skipped,
      "A student with the same WKSA ID is already here, so the row is skipped. Nothing about that student changes.",
    ],
    EXCLUDED: [leftOut, "These rows will not be imported. Bring one back any time before you confirm."],
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
          <p className="row ix-row ix-success-text item-title">
            <CheckIcon /> Nothing needs attention. Every row will be imported or left out as shown.
          </p>
        ) : (
          <RowsList kind={batch.kind} exclusion={exclusion} rows={rows}>
            {(list) =>
              view === "attention" ? (
                list.map((row) => (
                  <RosterRowEditor
                    batch={batch}
                    exclusion={exclusion}
                    key={row.row_number}
                    row={row}
                    onEditStateChange={onEditStateChange}
                    onFixed={fixed}
                  />
                ))
              ) : view === "check" ? (
                <div className="ix-ruled">
                  <ResponsiveTable
                    flush
                    label="New students to add"
                    rows={list}
                    rowKey={(row) => row.row_number}
                    columns={[
                      { key: "row", header: "Row", primary: true, render: (row) => `Row ${row.row_number}` },
                      ...batch.target_fields.map((field) => ({
                        key: field.field,
                        header: field.name,
                        render: (row: DataImportRow) => (
                          <>
                            {row.values[field.field] || <span className="subtext">(blank)</span>}
                            {row.corrected_fields.includes(field.field) ? (
                              <span className="ix-fix-note meta">Your fix</span>
                            ) : null}
                          </>
                        ),
                      })),
                      ...batch.extra_columns.map((column) => ({
                        key: `extra-${column}`,
                        header: `${column} (extra)`,
                        render: (row: DataImportRow) => <span className="subtext">{row.extra[column] ?? ""}</span>,
                      })),
                      {
                        key: "change",
                        header: "Change",
                        actions: true,
                        render: (row) => (
                          <>
                            <Button
                              variant="link"
                              aria-expanded={editing === row.row_number}
                              onClick={() => setEditing(editing === row.row_number ? null : row.row_number)}
                            >
                              {editing === row.row_number ? "Close editor" : `Edit row ${row.row_number}`}
                            </Button>
                            <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />
                          </>
                        ),
                      },
                    ]}
                    detail={(row) =>
                      editing === row.row_number ? (
                        <RosterRowEditor
                          batch={batch}
                          exclusion={exclusion}
                          row={row}
                          onEditStateChange={onEditStateChange}
                          onFixed={fixed}
                        />
                      ) : null
                    }
                  />
                </div>
              ) : (
                list.map((row) => (
                  <RosterRowEditor
                    batch={batch}
                    exclusion={exclusion}
                    key={row.row_number}
                    row={row}
                    onEditStateChange={onEditStateChange}
                    onFixed={fixed}
                  />
                ))
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
          <div className="row row--wrap">
            <span className="ix-why error-text">
              Fix or leave out the {counted(counts.review_required, "row that needs", "rows that need")} attention
              first.
            </span>
            <Button variant="secondary" disabled={leaveRest.isPending} onClick={() => leaveRest.mutate()}>
              {leaveRest.isPending ? "Leaving out…" : `Leave out the ${counts.review_required} left`}
            </Button>
          </div>
        ) : (
          <span className="subtext">Change anything on this page until you confirm.</span>
        )}
      </div>
      {leaveRest.isError ? (
        <ErrorText>{errorMessage(leaveRest.error, "Those rows could not be left out.")}</ErrorText>
      ) : null}
    </>
  );
}
