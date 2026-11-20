import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ActionBar } from "./ActionBar";
import { Alert } from "./Alert";
import {
  type DataImportBatch,
  type DataImportRow,
  cancelDataImportBatch,
  chooseDataImportSheet,
  commitDataImport,
  errorMessage,
  getDataImportRow,
  getDataImportRows,
  leaveOutDataImportRowsNeedingAttention,
} from "./api";
import { Button } from "./Button";
import { ChoiceGroup } from "./ChoiceGroup";
import { labelOf, useChoices } from "./choices";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { FoundChecklist } from "./ImportFound";
import { RosterRowEditor } from "./ImportRosterRow";
import { PAGE_SIZE, useRowExclusion } from "./importReviewRows";
import { importKinds } from "./importKinds";
import { LoadingState } from "./LoadingState";
import { Pagination } from "./Pagination";
import { agreeing, counted } from "./plural";
import { Progress } from "./Progress";
import { QueueList } from "./QueueList";
import { keys } from "./queryKeys";
import { SearchField } from "./SearchField";
import { useDirtySet } from "./useDirtySet";
import { useImportRefresh } from "./useImportRefresh";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";

// A student list's steps before it is saved, on the same screens as past
// gradings (StudentListImport): the file, the things to check (the columns
// to match and each row to fix, a page of its own), every row, and the save.

/** How many of the rows are sorted: ready, already in KukGrade or left out. */
function RowsSorted({ batch }: { batch: DataImportBatch }) {
  const counts = batch.row_counts;
  return <Progress done={counts.total - counts.review_required} total={counts.total} what="rows sorted" />;
}

/** What KukGrade found in the file, and which of its sheets to read. */
export function RosterFile({
  batch,
  importedBefore,
  onContinue,
}: {
  batch: DataImportBatch;
  importedBefore: boolean;
  onContinue: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useImportRefresh(batch.id);
  const sheet = useMutation({
    mutationFn: (name: string) => chooseDataImportSheet(batch.id, name),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.imports.batch(batch.id), updated);
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelDataImportBatch(batch.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.imports.all() });
      navigate("/imports");
    },
  });
  const empty = Boolean(batch.sheet_error) || batch.row_counts.total === 0;

  return (
    <>
      <section aria-labelledby="ix-your-file" className="card stack stack--4">
        <h2 className="section-title" id="ix-your-file">
          {batch.original_filename}
        </h2>
        <FoundChecklist batch={batch} importedBefore={importedBefore} />
        {empty ? (
          <Alert tone="warning">
            {batch.sheet_error || "This sheet has no student rows."} Choose the sheet that holds the students.
          </Alert>
        ) : null}
        {batch.sheet_names.length > 1 ? (
          <label className="field field--sentence ix-field-narrow">
            <span>Sheet to read</span>
            <select
              disabled={sheet.isPending}
              value={batch.sheet}
              onChange={(event) => sheet.mutate(event.target.value)}
            >
              {batch.sheet_names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="subtext">
              {sheet.isPending
                ? "Reading that sheet…"
                : `The workbook has ${batch.sheet_names.length} sheets. KukGrade picked the one it opens on.`}
            </span>
          </label>
        ) : null}
        {sheet.isError ? <ErrorText>{errorMessage(sheet.error, "That sheet could not be read.")}</ErrorText> : null}
        {cancel.isError ? (
          <ErrorText>{errorMessage(cancel.error, "The import could not be cancelled.")}</ErrorText>
        ) : null}
      </section>
      <ActionBar>
        <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel import
        </Button>
        <Button variant="primary" disabled={sheet.isPending || empty} onClick={onContinue}>
          Continue
        </Button>
      </ActionBar>
    </>
  );
}

/**
 * The things to check in a student list: its columns to match, and the rows
 * that need a fix, each opening a page of its own.
 */
export function RosterChecks({
  batch,
  onBack,
  onContinue,
  onRows,
}: {
  batch: DataImportBatch;
  onBack: () => void;
  onContinue: () => void;
  onRows: () => void;
}) {
  const counts = batch.row_counts;
  const matched = Object.keys(batch.column_mapping).length > 0;
  const uncovered = batch.target_fields.filter((field) => batch.uncovered_fields.includes(field.field));
  const columns = matched
    ? [
        counted(Object.keys(batch.column_mapping).length, "column matched", "columns matched"),
        uncovered.length ? `nothing given yet for ${uncovered.map((field) => field.name).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "Not matched yet: the rows are checked once they are";

  return (
    <>
      <section aria-labelledby="ix-checks" className="card stack stack--4">
        <h2 className="section-title" id="ix-checks">
          Things to check
        </h2>
        <p className="subtext">Match the columns, then fix each row KukGrade cannot add as it is, or leave it out.</p>
        {matched ? <RowsSorted batch={batch} /> : null}
        <QueueList
          label="Things to check"
          queues={[
            { to: "?step=match", label: "Match the columns", hint: columns },
            ...(matched
              ? [
                  {
                    to: "?step=row",
                    label: "Rows to fix",
                    count: counts.review_required,
                    hint: counts.review_required
                      ? `${counted(counts.review_required, "row needs", "rows need")} a fix, or leaving out`
                      : "All sorted",
                  },
                ]
              : []),
          ]}
        />
        {matched ? (
          <div>
            <Button variant="secondary" onClick={onRows}>
              See every row
            </Button>
          </div>
        ) : null}
      </section>
      <ActionBar
        status={
          matched ? <p className="subtext">{counted(counts.review_required, "row", "rows")} still to fix</p> : null
        }
      >
        <Button variant="ghost" onClick={onBack}>
          Back to your file
        </Button>
        <Button variant="primary" disabled={!matched} onClick={onContinue}>
          Continue to save
        </Button>
      </ActionBar>
    </>
  );
}

/**
 * One row on a page of its own, every field fixable, with Leave out. Opened
 * from the rows to fix, Next goes on to the next one still needing a fix;
 * opened from every row, it goes back there.
 */
export function RosterRow({
  batch,
  rowNumber,
  fromRows,
  back,
  onOpen,
  onPin,
  onDone,
}: {
  batch: DataImportBatch;
  rowNumber: number | null;
  /** Opened from every row, rather than from the rows to fix. */
  fromRows: boolean;
  /** Where Back goes, with the list's filters. */
  back: string;
  onOpen: (rowNumber: number) => void;
  /** Puts the row shown into the address, so fixing it never moves the page on. */
  onPin: (rowNumber: number) => void;
  onDone: () => void;
}) {
  const refresh = useImportRefresh(batch.id);
  const unsaved = useDirtySet();
  const [announcement, setAnnouncement] = useState("");
  const toFix = useQuery({
    queryKey: keys.imports.rowsPage(batch.id, "to-fix"),
    queryFn: () => getDataImportRows(batch.id, { outcome: "REVIEW_REQUIRED", page_size: 200 }),
  });
  const waiting = toFix.data?.results ?? [];
  const shown = rowNumber ?? waiting[0]?.row_number ?? null;
  useEffect(() => {
    if (rowNumber === null && shown !== null) onPin(shown);
  }, [rowNumber, shown, onPin]);
  const row = useQuery({
    queryKey: keys.imports.row(batch.id, shown ?? 0),
    queryFn: () => getDataImportRow(batch.id, shown!),
    enabled: shown !== null,
  });
  const exclusion = useRowExclusion(batch, refresh, setAnnouncement);
  const next = fromRows
    ? null
    : (waiting.find((other) => shown !== null && other.row_number > shown) ??
      waiting.find((other) => other.row_number !== shown) ??
      null);
  const loaded = row.data;
  const backLabel = fromRows ? "Every row" : "Things to check";

  async function fixed(changed: DataImportRow) {
    if (changed.outcome === "READY") setAnnouncement(`Row ${changed.row_number} is ready.`);
    await refresh();
  }

  return (
    <DetailPage
      actions={
        next ? (
          <Button variant="primary" disabled={unsaved.any} onClick={() => onOpen(next.row_number)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" disabled={unsaved.any} onClick={onDone}>
            Back to {backLabel.toLowerCase()}
          </Button>
        )
      }
      back={{ to: back, label: backLabel }}
      eyebrow={`${importKinds[batch.kind].title} · Things to check`}
      progress={<RowsSorted batch={batch} />}
      status={loaded ? <p className="subtext">{loaded.excluded ? "Left out" : loaded.outcome_display}</p> : null}
      testId="ix-roster-row"
      title={loaded ? `Row ${loaded.row_number} · ${importKinds[batch.kind].rowName(loaded)}` : "Row to fix"}
    >
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {shown === null ? (
        toFix.isPending ? (
          <LoadingState compact>Loading…</LoadingState>
        ) : toFix.isError ? (
          <ErrorText>{errorMessage(toFix.error, "The rows could not be loaded. Try again in a moment.")}</ErrorText>
        ) : (
          <p className="item-title">Nothing left to fix.</p>
        )
      ) : row.isPending ? (
        <LoadingState compact>Loading the row…</LoadingState>
      ) : row.isError ? (
        <ErrorText>{errorMessage(row.error, "This row could not be loaded.")}</ErrorText>
      ) : (
        <section aria-label="The row's fields" className="card card--flush">
          <RosterRowEditor
            batch={batch}
            exclusion={exclusion}
            row={row.data}
            onEditStateChange={unsaved.mark}
            onFixed={fixed}
          />
          {exclusion.isError ? (
            <ErrorText className="ix-row">{errorMessage(exclusion.error, "That row could not be changed.")}</ErrorText>
          ) : null}
        </section>
      )}
    </DetailPage>
  );
}

const SHOWN = ["all", "READY", "REVIEW_REQUIRED", "SKIP_EXISTING", "EXCLUDED"] as const;

/** A row in a line: what it holds as KukGrade will save it, or why it waits. */
function rowHint(batch: DataImportBatch, row: DataImportRow): string {
  if (row.excluded) return "Left out";
  if (row.outcome === "REVIEW_REQUIRED") return row.issues.join(" ");
  return [row.outcome_display, importKinds[batch.kind].reviewDetail(row)].filter(Boolean).join(" · ");
}

/** Every row of the list, by what it will be, found by name or WKSA ID: each opens its own page. */
export function RosterRows({ batch, onDone }: { batch: DataImportBatch; onDone: () => void }) {
  const filters = useUrlFilters();
  const show = filters.oneOf("show", SHOWN, "all");
  const search = filters.value("search");
  const searched = search.trim();
  const page = filters.page;
  const outcomes = useChoices().import_row_outcomes;
  const counts = batch.row_counts;
  const paged = usePagedQuery({
    queryKey: keys.imports.rowsPage(batch.id, "every", show, searched, page),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
    queryFn: () =>
      getDataImportRows(batch.id, {
        outcome: show === "all" ? undefined : show,
        search: searched || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
  });
  const rows = paged.query;

  function opened(row: DataImportRow) {
    const params = new URLSearchParams(filters.query);
    params.set("step", "row");
    params.set("row", String(row.row_number));
    params.set("from", "rows");
    return `?${params.toString()}`;
  }

  return (
    <>
      <section aria-labelledby="ix-every" className="card stack stack--4">
        <h2 className="section-title" id="ix-every">
          Every row
        </h2>
        <p className="subtext">As KukGrade will save them, your fixes included. A row left out is not added.</p>
        <ChoiceGroup
          choices={[
            { value: "all", label: "All", count: counts.total },
            { value: "READY", label: labelOf(outcomes, "READY"), count: counts.ready },
            { value: "REVIEW_REQUIRED", label: labelOf(outcomes, "REVIEW_REQUIRED"), count: counts.review_required },
            { value: "SKIP_EXISTING", label: labelOf(outcomes, "SKIP_EXISTING"), count: counts.skip_existing },
            { value: "EXCLUDED", label: labelOf(outcomes, "EXCLUDED"), count: counts.excluded },
          ]}
          label="Show"
          look="chips"
          value={show}
          onChange={(value) => filters.set({ show: value === "all" ? null : value })}
        />
        <SearchField label="Name or WKSA ID" value={search} onChange={(value) => filters.set({ search: value })} />
        {rows.isPending ? (
          <LoadingState compact>Loading the rows…</LoadingState>
        ) : rows.isError ? (
          <ErrorText>{errorMessage(rows.error, "The rows could not be loaded.")}</ErrorText>
        ) : rows.data.results.length === 0 ? (
          <p className="subtext">No rows match.</p>
        ) : (
          <>
            <QueueList
              label="Rows"
              queues={rows.data.results.map((row) => ({
                to: opened(row),
                label: `Row ${row.row_number} · ${importKinds[batch.kind].rowName(row)}`,
                hint: rowHint(batch, row),
              }))}
            />
            <Pagination flush label="Pages of rows" noun={importKinds[batch.kind].noun} {...paged.pager} />
          </>
        )}
      </section>
      <ActionBar>
        <Button variant="primary" onClick={onDone}>
          Back to things to check
        </Button>
      </ActionBar>
    </>
  );
}

/**
 * The one confirmation: how many students are added, what is skipped or left
 * out, and that they are added together or not at all. Rows still needing a
 * fix are fixed or left out first.
 */
export function RosterSave({
  batch,
  onBack,
  onFix,
}: {
  batch: DataImportBatch;
  onBack: () => void;
  onFix: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useImportRefresh(batch.id);
  const save = useMutation({
    mutationFn: () => commitDataImport(batch.id),
    onSuccess: async () => {
      // Past gradings can start once there are students (imports.starts).
      await Promise.all(
        [keys.imports.all(), keys.students.all()].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      navigate({ search: "" }, { replace: true });
    },
    onError: refresh,
  });
  const leaveRest = useMutation({
    mutationFn: () => leaveOutDataImportRowsNeedingAttention(batch.id),
    onSuccess: refresh,
  });

  const counts = batch.row_counts;
  const waiting = counts.review_required;
  const lines = [
    counts.skip_existing
      ? `${counted(counts.skip_existing, "row", "rows")} already in KukGrade ${agreeing(counts.skip_existing, "is", "are")} skipped`
      : null,
    counts.excluded ? `${counted(counts.excluded, "row", "rows")} you left out` : null,
    batch.extra_columns.length
      ? `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept as extra information`
      : null,
  ].filter(Boolean);
  const action = `Add ${counted(counts.ready, "student", "students")}`;

  return (
    <>
      {save.isError ? (
        <Alert title="Nothing was saved.">
          {errorMessage(save.error, "Something changed since you looked. Look over the rows and try again.")}
        </Alert>
      ) : null}
      <section aria-labelledby="ix-save" className="card stack stack--4">
        <h2 className="section-title" id="ix-save">
          {action}
        </h2>
        {waiting ? (
          <Alert
            tone="warning"
            title={`${counted(waiting, "row still needs", "rows still need")} a fix`}
            action={
              <>
                <Button variant="secondary" disabled={leaveRest.isPending} onClick={() => leaveRest.mutate()}>
                  {leaveRest.isPending ? "Leaving out…" : `Leave out the ${waiting} left`}
                </Button>
                <Button variant="link" onClick={onFix}>
                  Fix them
                </Button>
              </>
            }
          >
            Each row is fixed or left out before any student is added.
          </Alert>
        ) : null}
        {leaveRest.isError ? (
          <ErrorText>{errorMessage(leaveRest.error, "Those rows could not be left out.")}</ErrorText>
        ) : null}
        {lines.length ? (
          <ul className="list-plain stack stack--1">
            {lines.map((line) => (
              <li className="subtext" key={line}>
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="subtext">They are added together, or none are. You can edit or remove any of them afterwards.</p>
      </section>
      <ActionBar>
        <Button variant="ghost" disabled={save.isPending} onClick={onBack}>
          Back to things to check
        </Button>
        <Button
          variant="primary"
          disabled={save.isPending || counts.ready === 0 || waiting > 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Adding…" : counts.ready === 0 ? "Nothing to add" : action}
        </Button>
      </ActionBar>
    </>
  );
}
