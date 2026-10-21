import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DataImportBatch,
  type DataImportKind,
  type DataImportRow,
  type LegacyImportPreview,
  commitDataImport,
  correctDataImportRow,
  errorMessage,
  leaveOutDataImportRowsNeedingAttention,
  previewLegacyGradingImport,
  setDataImportRowExcluded,
} from "./api";
import { ImportCellInput } from "./ImportCellInput";
import { ImportDialog } from "./ImportDialog";
import { ImportPager } from "./ImportPager";
import { usePagedRows } from "./useImportRows";
import { counted, importRowName } from "./importSteps";
import { useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";

const PAGE_SIZE = 20;
const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "LEFT", label: "Left" },
];

type RowParams = Parameters<typeof usePagedRows>[1];
type Tile<View extends string> = { key: View; label: string; count: number; tone: string; mark: string };
type Exclusion = ReturnType<typeof useRowExclusion>;

function where(row: DataImportRow, kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? `Row ${row.row_number}` : row.source_locator.replaceAll("!", " · ");
}

/** A row in a line: what it holds, as KukGrade will save it. */
function rowDetail(row: DataImportRow, kind: DataImportKind): string {
  const values = row.values;
  if (kind === "STUDENT_ROSTER") return [values.wksa_id, values.current_rank, values.date_of_birth].filter(Boolean).join(" · ");
  const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
  const words = values.report || values.note;
  return [ranks, values.outcome, words ? `“${words}”` : ""].filter(Boolean).join(" · ");
}

/** Counts that double as filters (FDR-052). */
function CountTiles<View extends string>({
  tiles,
  view,
  onView,
}: {
  tiles: Tile<View>[];
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div aria-label="Show" className="ix-tiles" role="group">
      {tiles.map((tile) => (
        <button aria-pressed={view === tile.key} className="ix-tile" key={tile.key} type="button" onClick={() => onView(tile.key)}>
          <span className={`ix-tile-count ${tile.tone}`}>
            <span aria-hidden="true">{tile.mark}</span>
            {tile.count}
          </span>
          <span className="ix-tile-label">{tile.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The way to a last look at everything that will be saved (FDR-052). */
function LastLook({ pressed, lead, label, onShow }: { pressed: boolean; lead: string; label: string; onShow: () => void }) {
  return (
    <div className={`ix-banner ix-card${pressed ? " ix-picked" : ""}`}>
      <p className="ix-small">
        <strong>Last look before you confirm.</strong> {lead}
      </p>
      <button aria-pressed={pressed} className="btn-secondary" type="button" onClick={onShow}>
        {label}
      </button>
    </div>
  );
}

/** Leaving a row out or bringing it back, said aloud once done. */
function rowCalled(row: DataImportRow, kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? `row ${row.row_number}` : `the record for ${importRowName(row, kind)}`;
}

function useRowExclusion(batch: DataImportBatch, onRefresh: () => Promise<void>, announce: (text: string) => void) {
  return useMutation({
    mutationFn: ({ row, excluded }: { row: DataImportRow; excluded: boolean }) =>
      setDataImportRowExcluded(batch.id, row.row_number, excluded),
    onSuccess: async (_changed, { row, excluded }) => {
      const what = rowCalled(row, batch.kind);
      announce(`${what.charAt(0).toUpperCase()}${what.slice(1)} is ${excluded ? "left out" : "back in"}.`);
      await onRefresh();
    },
  });
}

function ExclusionButton({ row, kind, exclusion }: { row: DataImportRow; kind: DataImportKind; exclusion: Exclusion }) {
  const what = rowCalled(row, kind);
  return (
    <button
      aria-label={row.excluded ? `Bring back ${what}` : `Leave out ${what}`}
      className="ix-link-button"
      disabled={exclusion.isPending}
      type="button"
      onClick={() => exclusion.mutate({ row, excluded: !row.excluded })}
    >
      {row.excluded ? "Bring back" : "Leave out"}
    </button>
  );
}

/** One page of a list: loading, failed, empty, or its rows, and the pager. */
function RowsList({
  rows,
  empty = "Nothing here.",
  exclusion,
  children,
}: {
  rows: ReturnType<typeof usePagedRows>;
  empty?: string;
  exclusion: Exclusion;
  children: (list: DataImportRow[]) => ReactNode;
}) {
  const list = rows.query.data?.results ?? [];
  return (
    <>
      {rows.query.isError ? (
        <p className="ix-row ix-danger-text" role="alert">
          {errorMessage(rows.query.error, "The rows could not be loaded.")}
        </p>
      ) : rows.query.isPending ? (
        <p className="ix-row ix-muted" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="ix-row ix-muted">{empty}</p>
      ) : (
        children(list)
      )}
      {exclusion.isError ? (
        <p className="ix-row ix-danger-text" role="alert">
          {errorMessage(exclusion.error, "That row could not be changed.")}
        </p>
      ) : null}
      <ImportPager page={rows.page} pages={rows.pages} total={rows.total} onPage={rows.setPage} />
    </>
  );
}

/** A list of rows in a line each, with Leave out or Bring back. */
function RowLines({
  list,
  kind,
  exclusion,
  withIssues = false,
}: {
  list: DataImportRow[];
  kind: DataImportKind;
  exclusion?: Exclusion;
  withIssues?: boolean;
}) {
  return (
    <>
      {list.map((row) => (
        <div className={`ix-row${row.excluded ? " ix-row-out" : ""}`} key={row.row_number}>
          <div className="ix-row-main">
            <p className="ix-strong">
              {where(row, kind)} · {importRowName(row, kind)}
            </p>
            {withIssues && !row.excluded ? <p className="ix-small ix-semibold">{row.issues.join(" ")}</p> : null}
            <p className="ix-muted ix-small">{row.excluded ? "Left out of the import." : rowDetail(row, kind)}</p>
          </div>
          {exclusion ? <ExclusionButton exclusion={exclusion} kind={kind} row={row} /> : null}
        </div>
      ))}
    </>
  );
}

/** A list's heading, its lead, and search where there is one. */
function ListHead({ title, lead, search }: { title: string; lead: string; search?: { value: string; hint: string; onChange: (value: string) => void } }) {
  return (
    <div className="ix-row ix-align-end">
      <div className="ix-row-main">
        <h2 className="ix-heading" id="ix-review-list">
          {title}
        </h2>
        <p className="ix-muted ix-small">{lead}</p>
      </div>
      {search ? (
        <label className="ix-field">
          Search
          <input placeholder={search.hint} type="search" value={search.value} onChange={(event) => search.onChange(event.target.value)} />
        </label>
      ) : null}
    </div>
  );
}

/** A roster row needing attention: its problem in words and its fields to fix. */
function AttentionRow({
  batch,
  row,
  exclusion,
  onFixed,
}: {
  batch: DataImportBatch;
  row: DataImportRow;
  exclusion: Exclusion;
  onFixed: (row: DataImportRow) => Promise<void>;
}) {
  const ranks = useRanksQuery().data?.results ?? [];
  const fix = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string | null }) =>
      correctDataImportRow(batch.id, row.row_number, { [field]: value }),
    onSuccess: onFixed,
  });

  return (
    <div className="ix-row ix-attention">
      <div className="ix-actions ix-actions-split ix-align-start">
        <div className="ix-row-main">
          <p className="ix-strong">
            Row {row.row_number} · {importRowName(row, batch.kind)}
          </p>
          <p className="ix-why">{row.issues.join(" ")}</p>
        </div>
        <button
          aria-label={`Leave this row out, row ${row.row_number}`}
          className="btn-ghost"
          disabled={exclusion.isPending}
          type="button"
          onClick={() => exclusion.mutate({ row, excluded: true })}
        >
          Leave this row out
        </button>
      </div>
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
                onChange={(event) => fix.mutate({ field: field.field, value: event.target.value })}
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
                onSave={(next) => fix.mutateAsync({ field: field.field, value: next })}
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
                  <button aria-label={`Undo the fix to ${label}`} type="button" onClick={() => fix.mutate({ field: field.field, value: null })}>
                    Undo
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {fix.isError ? (
        <p className="ix-danger-text ix-small ix-flush" role="alert">
          {errorMessage(fix.error, "That fix could not be saved.")}
        </p>
      ) : null}
    </div>
  );
}

type RosterView = "attention" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "check";

function RosterReview({
  batch,
  announce,
  onRefresh,
  onMatch,
}: {
  batch: DataImportBatch;
  announce: (text: string) => void;
  onRefresh: () => Promise<void>;
  onMatch: () => void;
}) {
  const counts = batch.row_counts;
  const [view, setView] = useState<RosterView>(counts.review_required ? "attention" : "check");
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

      <section aria-labelledby="ix-review-list" className="ix-card">
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
                list.map((row) => <AttentionRow batch={batch} exclusion={exclusion} key={row.row_number} row={row} onFixed={fixed} />)
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
                        <tr key={row.row_number}>
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
                            <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <RowLines exclusion={view === "SKIP_EXISTING" ? undefined : exclusion} kind={batch.kind} list={list} />
              )
            }
          </RowsList>
        )}
      </section>

      <div className="ix-actions ix-actions-split">
        <button className="btn-ghost" type="button" onClick={onMatch}>
          Back to matching
        </button>
        {counts.review_required ? (
          <div className="ix-actions">
            <span className="ix-why">
              Fix or leave out the {counted(counts.review_required, "row that needs", "rows that need")} attention first.
            </span>
            <button className="btn-secondary" disabled={leaveRest.isPending} type="button" onClick={() => leaveRest.mutate()}>
              {leaveRest.isPending ? "Leaving out…" : `Leave out the ${counts.review_required} left`}
            </button>
          </div>
        ) : (
          <span className="ix-muted ix-small">Change anything on this page until you confirm.</span>
        )}
      </div>
      {leaveRest.isError ? (
        <p className="ix-danger-text" role="alert">
          {errorMessage(leaveRest.error, "Those rows could not be left out.")}
        </p>
      ) : null}
    </>
  );
}

type LegacyView = "attention" | "results" | "others" | "EXCLUDED" | "check";

function LegacyReview({
  batch,
  preview,
  announce,
  onRefresh,
  onMatch,
}: {
  batch: DataImportBatch;
  preview: LegacyImportPreview | undefined;
  announce: (text: string) => void;
  onRefresh: () => Promise<void>;
  onMatch: () => void;
}) {
  // Opens on the records worth a look, if any, once they are counted.
  const [picked, setPicked] = useState<LegacyView | null>(null);
  const view = picked ?? (preview?.worth_a_look ? "attention" : "check");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const searchable = view !== "attention";
  const ready = batch.row_counts.ready;
  const byView: Record<LegacyView, RowParams> = {
    attention: { worth_a_look: true },
    results: { record_kind: "GRADING_RESULT", outcome: "READY" },
    others: { record_kind: "DID_NOT_ATTEND,AUXILIARY_NOTE", outcome: "READY" },
    EXCLUDED: { outcome: "EXCLUDED" },
    check: { outcome: "READY" },
  };
  const rows = usePagedRows(
    batch.id,
    { ...byView[view], search: searchable && debounced ? debounced : undefined },
    PAGE_SIZE,
  );
  const exclusion = useRowExclusion(batch, onRefresh, announce);

  const tiles: Tile<LegacyView>[] = [
    { key: "results", label: "Grading results", count: preview?.grading_result ?? 0, tone: "ix-success-text", mark: "✓" },
    { key: "attention", label: "Worth a look", count: preview?.worth_a_look ?? 0, tone: "ix-warning-text", mark: "!" },
    {
      key: "others",
      label: "Did not attend and notes",
      count: (preview?.did_not_attend ?? 0) + (preview?.auxiliary_note ?? 0),
      tone: "",
      mark: "i",
    },
    { key: "EXCLUDED", label: "Left out", count: batch.row_counts.excluded, tone: "ix-muted", mark: "–" },
  ];
  const heads: Record<LegacyView, [string, string]> = {
    attention: [
      "Records worth a look",
      "Nothing here stops the import: every record is kept exactly as the workbook has it. Leave out anything that should not be imported, such as a test row.",
    ],
    results: ["Grading results", "One per student per grading, with the comments kept in full as the grading report."],
    others: ["Did not attend and notes", "Kept as they are: who did not attend, and notes written beside the tables."],
    EXCLUDED: ["Left out", "These records will not be imported. Bring one back any time before you confirm."],
    check: [
      `${counted(ready, "record", "records")} will be imported`,
      "In workbook order, exactly as written, with the comments in full. Records you left out are not in this list.",
    ],
  };

  return (
    <>
      <CountTiles tiles={tiles} view={view} onView={setPicked} />
      <LastLook
        label={`Look over all ${counted(ready, "record", "records")}`}
        lead="See every record that will be imported, sheet by sheet, exactly as written."
        pressed={view === "check"}
        onShow={() => setPicked("check")}
      />
      <section aria-labelledby="ix-review-list" className="ix-card">
        <ListHead
          lead={heads[view][1]}
          search={searchable ? { value: search, hint: "Name or comment", onChange: setSearch } : undefined}
          title={heads[view][0]}
        />
        <RowsList
          empty={view === "attention" ? "✓ Nothing to look at: every record reads as KukGrade expects." : undefined}
          exclusion={exclusion}
          rows={rows}
        >
          {(list) =>
            view === "check" ? (
              <div className="ix-table-wrap ix-ruled">
                <table className="ix-table">
                  <thead>
                    <tr>
                      <th scope="col">Sheet · row</th>
                      <th scope="col">Name</th>
                      <th scope="col">Ranks</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Comments (the grading report)</th>
                      <th scope="col">
                        <span className="ix-visually-hidden">Change</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr key={row.row_number}>
                        <td className="ix-muted ix-nowrap">{where(row, batch.kind)}</td>
                        <td className="ix-semibold">{row.values.name || (row.values.note ? "Sheet note" : "(no name)")}</td>
                        <td>{[row.values.current_rank, row.values.testing_for_rank].filter(Boolean).join(" → ")}</td>
                        <td>{row.values.outcome}</td>
                        <td className="ix-muted ix-cell-words">{row.values.report || row.values.note}</td>
                        <td className="ix-cell-action">
                          <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <RowLines exclusion={exclusion} kind={batch.kind} list={list} withIssues={view === "attention"} />
            )
          }
        </RowsList>
      </section>
      <div className="ix-actions ix-actions-split">
        <button className="btn-ghost" type="button" onClick={onMatch}>
          Back to matching ranks
        </button>
        <span className="ix-muted ix-small">Ranks still to match can be matched later, when linking records.</span>
      </div>
    </>
  );
}

/** The seal: once every row is sorted, the summary and the import itself (FDR-053). */
function Seal({
  batch,
  unresolvedRanks,
  pending,
  onImport,
}: {
  batch: DataImportBatch;
  unresolvedRanks: number;
  pending: boolean;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const roster = batch.kind === "STUDENT_ROSTER";
  const counts = batch.row_counts;
  const count = counts.ready;
  const action = roster ? `Add ${counted(count, "student", "students")}` : `Import ${counted(count, "record", "records")}`;
  const line = roster
    ? [
        counts.skip_existing ? `${counts.skip_existing} already in KukGrade ${counts.skip_existing === 1 ? "is" : "are"} skipped` : null,
        counts.excluded ? `${counts.excluded} you left out` : null,
        batch.extra_columns.length ? `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept as extra information` : null,
        "all are added together, or none are",
      ]
    : [
        counts.excluded ? `${counts.excluded} you left out` : null,
        unresolvedRanks ? `${counted(unresolvedRanks, "rank", "ranks")} not matched stay as written` : null,
        "next, KukGrade suggests who each record belongs to",
      ];
  const sentence = line.filter(Boolean).join(", ");

  return (
    <section aria-labelledby="ix-seal-h" className="ix-banner ix-card ix-gold-edge">
      <span aria-hidden="true" className="ix-mark ix-mark-ok ix-mark-large">
        ✓
      </span>
      <div className="ix-seal-text">
        <h2 className="ix-heading" id="ix-seal-h" tabIndex={-1}>
          {roster
            ? `Everything is sorted · ready to add ${counted(count, "student", "students")}`
            : `Ready to import ${counted(count, "historical record", "historical records")}`}
        </h2>
        <p className="ix-muted ix-small">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</p>
      </div>
      <button className="btn-primary ix-seal-button" disabled={count === 0 || pending} type="button" onClick={() => setOpen(true)}>
        {pending ? (roster ? "Adding…" : "Importing…") : count === 0 ? "Nothing to import" : action}
      </button>
      {open ? (
        <ImportDialog
          confirmLabel={action}
          pending={pending}
          pendingLabel={roster ? "Adding…" : "Importing…"}
          title={roster ? `${action} to KukGrade?` : `Import ${counted(count, "historical record", "historical records")}?`}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            onImport();
          }}
        >
          <p className="ix-muted">
            {roster
              ? "They are saved together, so either all are added or none are. You can edit or remove any of them afterwards."
              : "They are saved together, exactly as the workbook has them. Next you link them to students."}
          </p>
        </ImportDialog>
      ) : null}
    </section>
  );
}

/**
 * Steps 3 and 4: every row reviewed, the ones needing attention first, and -
 * once all are sorted - the confirmation on the same page (FDR-052, FDR-053).
 */
export function ImportReview({
  batch,
  onMatch,
  onCommitted,
}: {
  batch: DataImportBatch;
  onMatch: () => void;
  onCommitted: () => void;
}) {
  const queryClient = useQueryClient();
  const roster = batch.kind === "STUDENT_ROSTER";
  const [announcement, setAnnouncement] = useState("");
  // A refused import shows the review again from the top, as it now stands.
  const [refusals, setRefusals] = useState(0);
  const preview = useQuery({
    queryKey: ["imports", "legacyPreview", batch.id],
    queryFn: () => previewLegacyGradingImport(batch.id, {}),
    enabled: !roster,
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["imports", "batch", batch.id] }),
      queryClient.invalidateQueries({ queryKey: ["imports", "rows", batch.id] }),
      queryClient.invalidateQueries({ queryKey: ["imports", "legacyPreview", batch.id] }),
    ]);
  }

  const commit = useMutation({
    mutationFn: () => commitDataImport(batch.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      onCommitted();
    },
    onError: async () => {
      await refresh();
      setRefusals((count) => count + 1);
    },
  });

  const sorted = !roster || batch.row_counts.review_required === 0;
  const unresolvedRanks = (preview.data?.unresolved_current_rank ?? 0) + (preview.data?.unresolved_testing_for_rank ?? 0);
  return (
    <>
      <p aria-live="polite" className="ix-visually-hidden">
        {announcement}
      </p>
      {commit.isError ? (
        <div className="ix-banner ix-banner-danger" role="alert">
          <p>
            <strong>Nothing was saved.</strong>{" "}
            {errorMessage(commit.error, "Something changed since the check. Look over the rows and try again.")}
          </p>
        </div>
      ) : null}
      {sorted ? (
        <Seal batch={batch} pending={commit.isPending} unresolvedRanks={unresolvedRanks} onImport={() => commit.mutate()} />
      ) : null}
      {roster ? (
        <RosterReview announce={setAnnouncement} batch={batch} key={refusals} onMatch={onMatch} onRefresh={refresh} />
      ) : (
        <LegacyReview
          announce={setAnnouncement}
          batch={batch}
          key={refusals}
          preview={preview.data}
          onMatch={onMatch}
          onRefresh={refresh}
        />
      )}
    </>
  );
}
