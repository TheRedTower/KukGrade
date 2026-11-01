import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DataImportBatch,
  type DataImportRow,
  correctDataImportRow,
  errorMessage,
  getDataImportRows,
  saveDataImportMapping,
} from "./api";
import { ImportCellInput } from "./ImportCellInput";
import { useRanksQuery } from "./queries";
import { Button } from "./Button";

const PREVIEW_ROWS = 5;
const EXTRA = "extra";
const SKIP = "skip";

/** What each column of the file holds: a field, extra information, or nothing. */
type Choices = Record<string, string>;
type MappingPayload = Parameters<typeof saveDataImportMapping>[1];

function mappingPayload(choices: Choices, rank: string): MappingPayload {
  const mapping = readChoices(choices).columnFor;
  return {
    column_mapping: mapping,
    defaults: rank && !mapping.current_rank ? { current_rank: rank } : {},
    extra_columns: Object.entries(choices).filter(([, choice]) => choice === EXTRA).map(([header]) => header),
  };
}

function mappingKey(payload: MappingPayload): string {
  return JSON.stringify({
    column_mapping: Object.entries(payload.column_mapping).sort(),
    defaults: Object.entries(payload.defaults ?? {}).sort(),
    extra_columns: [...(payload.extra_columns ?? [])].sort(),
  });
}

function initialChoices(batch: DataImportBatch): Choices {
  const saved = Object.keys(batch.column_mapping).length > 0;
  const mapping = saved ? batch.column_mapping : batch.suggested_mapping;
  const choices: Choices = {};
  for (const header of batch.detected_headers) choices[header] = saved ? SKIP : "";
  for (const [field, header] of Object.entries(mapping)) {
    if (header in choices) choices[header] = field;
  }
  for (const header of batch.extra_columns) choices[header] = EXTRA;
  return choices;
}

/** The column each field was given, and the fields given to two columns. */
function readChoices(choices: Choices) {
  const columnFor: Record<string, string> = {};
  const clashes = new Set<string>();
  for (const [header, choice] of Object.entries(choices)) {
    if (!choice || choice === EXTRA || choice === SKIP) continue;
    if (choice in columnFor) clashes.add(choice);
    else columnFor[choice] = header;
  }
  return { columnFor, clashes };
}

function rowState(row: DataImportRow): { label: string; tone: string } {
  if (row.outcome === "READY") return { label: "Ready", tone: "success" };
  if (row.outcome === "SKIP_EXISTING") return { label: "Already in KukGrade", tone: "neutral" };
  if (row.outcome === "EXCLUDED") return { label: "Left out", tone: "neutral" };
  return { label: "Needs attention", tone: "warning" };
}

/**
 * Step 2 of a roster import: the file's first rows, a field chooser above
 * each column, read live, and every matched cell typable.
 */
export function ImportMatchColumns({
  batch,
  onBack,
  onContinue,
}: {
  batch: DataImportBatch;
  onBack: () => void;
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  const ranks = useRanksQuery().data?.results ?? [];
  const [choices, setChoices] = useState<Choices>(() => initialChoices(batch));
  const [rankDefault, setRankDefault] = useState(batch.defaults.current_rank ?? "");
  const [typed, setTyped] = useState<string[]>([]);
  const [dirtyCells, setDirtyCells] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(() => mappingKey({
    column_mapping: batch.column_mapping,
    defaults: batch.defaults,
    extra_columns: batch.extra_columns,
  }));
  const { columnFor, clashes } = useMemo(() => readChoices(choices), [choices]);
  const saved = Object.keys(batch.column_mapping).length > 0;
  const draftPayload = mappingPayload(choices, rankDefault);
  const dirty = mappingKey(draftPayload) !== acknowledged;

  const rows = useQuery({
    queryKey: ["imports", "rows", batch.id, "preview"],
    queryFn: () => getDataImportRows(batch.id, { page_size: PREVIEW_ROWS }),
    enabled: saved,
  });

  async function refresh(updated?: DataImportBatch) {
    if (updated) queryClient.setQueryData(["imports", "batch", batch.id], updated);
    await queryClient.invalidateQueries({ queryKey: ["imports", "rows", batch.id] });
    if (!updated) await queryClient.invalidateQueries({ queryKey: ["imports", "batch", batch.id] });
  }

  const save = useMutation({
    mutationFn: (payload: MappingPayload) => saveDataImportMapping(batch.id, payload),
    onSuccess: async (updated, payload) => {
      setAcknowledged(mappingKey(payload));
      await refresh(updated);
    },
  });
  const correct = useMutation({
    mutationFn: ({ row, field, value }: { row: number; field: string; value: string | null }) =>
      correctDataImportRow(batch.id, row, { [field]: value }),
    onSettled: () => refresh(),
  });

  // The suggested columns are saved straight away, so the first rows are
  // read with them; the importer changes any that are wrong.
  const suggestionSaved = useRef(saved);
  useEffect(() => {
    if (suggestionSaved.current) return;
    suggestionSaved.current = true;
    const read = readChoices(choices);
    if (read.clashes.size === 0 && Object.keys(read.columnFor).length > 0) {
      save.mutate(mappingPayload(choices, rankDefault));
    }
  }, [choices, rankDefault, save]);

  function choose(next: Choices, rank = rankDefault) {
    setChoices(next);
    const read = readChoices(next);
    // A field given two columns cannot be saved; it waits until one is changed.
    if (read.clashes.size === 0 && Object.keys(read.columnFor).length > 0) {
      const payload = mappingPayload(next, rank);
      if (mappingKey(payload) !== acknowledged || save.isError) save.mutate(payload);
    }
  }

  const fieldName = (field: string) =>
    batch.target_fields.find((candidate) => candidate.field === field)?.name ?? field;
  const previewRows = rows.data?.results ?? [];
  // A field typed in without a column: chosen here, or already holding a
  // saved fix (so it comes back after a reload). One with fixes stays.
  const withFixes = new Set(previewRows.flatMap((row) => row.corrected_fields));
  const typedColumns = [...new Set([...typed, ...withFixes])].filter((field) => !(field in columnFor));
  const missing = batch.target_fields.filter(
    (field) =>
      field.needed &&
      !(field.field in columnFor) &&
      !typedColumns.includes(field.field) &&
      !(field.whole_file && rankDefault && field.field === "current_rank"),
  );
  const readyCount = previewRows.filter((row) => row.outcome === "READY").length;
  const noColumn = Object.keys(columnFor).length === 0;
  const blockedWhy =
    clashes.size > 0
      ? `${[...clashes].map(fieldName).join(", ")} ${clashes.size === 1 ? "is" : "are"} chosen for two columns.`
      : noColumn
        ? "Match at least one column."
        : null;

  function cell(row: DataImportRow, field: string, header: string | null) {
    const corrected = row.corrected_fields.includes(field);
    const shown = corrected ? (row.values[field] ?? "") : header ? (row.cells[header] ?? "") : "";
    const original = row.file_values[field] ?? "";
    return (
      <>
        <ImportCellInput
          changed={corrected}
          disabled={!saved || save.isPending || correct.isPending}
          invalid={row.outcome === "REVIEW_REQUIRED" && row.issue_fields.includes(field)}
          label={`${fieldName(field)}, row ${row.row_number}`}
          placeholder={field === "date_of_birth" ? "dd/mm/yyyy" : undefined}
          value={shown}
          onDirtyChange={(isDirty) => {
            const key = `${row.row_number}:${field}`;
            setDirtyCells((current) => isDirty ? [...new Set([...current, key])] : current.filter((item) => item !== key));
          }}
          onSave={(next) => correct.mutateAsync({ row: row.row_number, field, value: next })}
        />
        {corrected ? (
          <span className="ix-fix-note">
            Your fix · file had “{original || "nothing"}”
            <button
              aria-label={`Undo the fix to ${fieldName(field)}, row ${row.row_number}`}
              type="button"
              onClick={() => correct.mutate({ row: row.row_number, field, value: null })}
            >
              Undo
            </button>
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <section aria-labelledby="ix-match-h" className="ix-card ix-card-pad ix-section ix-roomy">
        <div className="ix-section-head ix-align-end">
          <div className="ix-head-text">
            <h2 className="ix-title" id="ix-match-h" tabIndex={-1}>
              Match your columns
            </h2>
            <p className="ix-muted">
              Set what each column holds, above it. Then type into any cell to fix or fill it:
              the file itself is never changed, and your fix is what KukGrade imports.
            </p>
          </div>
          {saved && previewRows.length ? (
            <p aria-live="polite" className="ix-small ix-flush">
              <strong className="ix-success-text">{readyCount}</strong> of {previewRows.length} ready ·{" "}
              <strong className="ix-warning-text">{previewRows.length - readyCount}</strong> need attention
            </p>
          ) : null}
        </div>

        {missing.map((field) => (
          <div className="ix-banner ix-banner-warning" key={field.field}>
            <p>
              <strong>No column holds {field.name === "WKSA ID" ? "the WKSA ID" : field.name.toLowerCase()}.</strong>{" "}
              {field.whole_file
                ? "Choose the column above, set one value for everyone, or type each one in."
                : "Choose the column above, or type each one in if you know them."}
            </p>
            {field.whole_file && field.field === "current_rank" ? (
              <label className="ix-field">
                Same for everyone
                <select
                  disabled={save.isPending || correct.isPending}
                  value=""
                  onChange={(event) => {
                    setRankDefault(event.target.value);
                    choose(choices, event.target.value);
                  }}
                >
                  <option value="">Choose a rank…</option>
                  {ranks.map((rank) => (
                    <option key={rank.code} value={rank.name}>
                      {rank.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button variant="secondary" onClick={() => setTyped([...typed, field.field])}>
              Type each one in
            </Button>
          </div>
        ))}

        {rankDefault && !columnFor.current_rank ? (
          <p className="ix-small ix-flush">
            Rank for everyone: <strong>{rankDefault}</strong>. A row can still be given its own.{" "}
            <Button
              variant="link"
              disabled={save.isPending || correct.isPending}
              onClick={() => {
                setRankDefault("");
                choose(choices, "");
              }}
            >
              Change
            </Button>
          </p>
        ) : null}

        {save.isError ? (
          <div role="alert" className="ix-danger-text">
            {errorMessage(save.error, "The columns could not be saved. Try again in a moment.")}{" "}
            <Button variant="link" onClick={() => save.mutate(draftPayload)}>Retry saving columns</Button>
          </div>
        ) : null}
        {correct.isError ? (
          <p className="ix-danger-text" role="alert">
            {errorMessage(correct.error, "That fix could not be saved.")}
          </p>
        ) : null}

        <div className="ix-card ix-table-wrap">
          <table className="ix-table ix-table-cells">
            <thead>
              <tr>
                <th scope="col">Row</th>
                {batch.detected_headers.map((header, index) => {
                  const choice = choices[header] ?? "";
                  const suggested = batch.suggested_mapping[choice] === header;
                  return (
                    <th key={header} scope="col">
                      <span className="ix-col-name">{header}</span>
                      <label className="ix-visually-hidden" htmlFor={`ix-col-${index}`}>
                        What “{header}” holds
                      </label>
                      <select
                        className={`ix-col-select${clashes.has(choice) ? " ix-col-select-clash" : suggested ? " ix-col-select-suggested" : ""}`}
                        id={`ix-col-${index}`}
                        disabled={save.isPending || correct.isPending}
                        value={choice}
                        onChange={(event) => choose({ ...choices, [header]: event.target.value })}
                      >
                        <option value="">Choose…</option>
                        {batch.target_fields.map((field) => (
                          <option key={field.field} value={field.field}>
                            {field.name}
                          </option>
                        ))}
                        <option value={EXTRA}>Extra information</option>
                        <option value={SKIP}>Leave out</option>
                      </select>
                    </th>
                  );
                })}
                {typedColumns.map((field) => (
                  <th key={`typed-${field}`} scope="col">
                    <span className="ix-col-name">
                      {fieldName(field)} <span className="ix-pill ix-pill-info">Typed in</span>
                    </span>
                    {withFixes.has(field) ? null : (
                      <Button variant="link" onClick={() => setTyped(typed.filter((name) => name !== field))}>
                        Remove this column
                      </Button>
                    )}
                  </th>
                ))}
                <th scope="col">As KukGrade reads it</th>
              </tr>
            </thead>
            <tbody>
              {!saved ? (
                <tr>
                  <td colSpan={batch.detected_headers.length + typedColumns.length + 2}>
                    <span className="ix-muted">Match a column to see how KukGrade reads the first rows.</span>
                  </td>
                </tr>
              ) : rows.isPending ? (
                <tr>
                  <td colSpan={batch.detected_headers.length + typedColumns.length + 2}>
                    <span className="ix-muted" role="status">Reading the first rows…</span>
                  </td>
                </tr>
              ) : (
                previewRows.map((row) => {
                  const state = rowState(row);
                  return (
                    <tr key={row.row_number}>
                      <td className="ix-muted ix-small">{row.row_number}</td>
                      {batch.detected_headers.map((header) => {
                        const choice = choices[header] ?? "";
                        const isField = choice in columnFor && columnFor[choice] === header && !clashes.has(choice);
                        return (
                          <td key={header}>
                            {isField ? (
                              cell(row, choice, header)
                            ) : (
                              <span className={`ix-cell-text ${choice === EXTRA ? "ix-muted" : "ix-struck"}`}>
                                {row.cells[header] || "(blank)"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {typedColumns.map((field) => (
                        <td key={`typed-${field}`}>{cell(row, field, null)}</td>
                      ))}
                      <td className="ix-cell-reading">
                        <span className={`ix-pill ix-pill-${state.tone}`}>{state.label}</span>
                        {row.outcome === "REVIEW_REQUIRED" && row.issues.length ? (
                          <span className="ix-muted ix-small">
                            {row.issues.slice(0, 2).join(" ")}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="ix-muted ix-small ix-flush">
          These are the first {Math.min(PREVIEW_ROWS, batch.row_counts.total)} of {batch.row_counts.total} rows. In the next step every
          row can be checked and fixed the same way. Columns left out are struck through; Status is
          Active where none is given.
        </p>
      </section>

      <div className="ix-actions ix-actions-split">
        <Button variant="ghost" onClick={onBack}>
          Back to Imports
        </Button>
        <div className="ix-actions">
          {save.isPending ? (
            <span className="ix-muted ix-small" role="status">
              Checking every row…
            </span>
          ) : null}
          {dirty || dirtyCells.length > 0 || correct.isPending || correct.isError ? (
            <span className="ix-why" role="status">Save the visible changes before continuing.</span>
          ) : null}
          {blockedWhy ? (
            <span className="ix-why" id="ix-match-why">
              {blockedWhy}
            </span>
          ) : null}
          <Button
            aria-describedby={blockedWhy ? "ix-match-why" : undefined}
            variant="primary"
            disabled={Boolean(blockedWhy) || !saved || dirty || save.isPending || save.isError || dirtyCells.length > 0 || correct.isPending || correct.isError}
            onClick={onContinue}
          >
            Continue to review all {batch.row_counts.total} rows
          </Button>
        </div>
      </div>
    </>
  );
}
