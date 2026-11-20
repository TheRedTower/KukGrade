import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DataImportBatch,
  type DataImportRow,
  errorMessage,
  getDataImportRows,
  saveDataImportMapping,
} from "./api";
import { ActionBar } from "./ActionBar";
import { Alert } from "./Alert";
import { useRanksQuery } from "./queries";
import { Button } from "./Button";
import { keys } from "./queryKeys";
import { agreeing } from "./plural";
import { cx } from "./cx";

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
    extra_columns: Object.entries(choices)
      .filter(([, choice]) => choice === EXTRA)
      .map(([header]) => header),
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

/** A column's first values in the file, as examples of what it holds. */
function examples(rows: DataImportRow[], header: string): string {
  const values = rows.map((row) => row.cells[header] ?? "").filter((value) => value.trim() !== "");
  return values.length ? [...new Set(values)].slice(0, 3).join(", ") : "Blank in the first rows";
}

/**
 * A student list's columns to match, one of its things to check: each column
 * of the file as a card, with its first values and what it holds. Each choice
 * is saved, and every row read again, straight away; a field no column holds
 * is set once for everyone, where it can be, or given on each row to fix.
 */
export function ImportMatchColumns({ batch, onDone }: { batch: DataImportBatch; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ranks = useRanksQuery().data?.results ?? [];
  const [choices, setChoices] = useState<Choices>(() => initialChoices(batch));
  const [rankDefault, setRankDefault] = useState(batch.defaults.current_rank ?? "");
  const [acknowledged, setAcknowledged] = useState(() =>
    mappingKey({
      column_mapping: batch.column_mapping,
      defaults: batch.defaults,
      extra_columns: batch.extra_columns,
    }),
  );
  const { columnFor, clashes } = useMemo(() => readChoices(choices), [choices]);
  const saved = Object.keys(batch.column_mapping).length > 0;
  const draftPayload = mappingPayload(choices, rankDefault);
  const dirty = mappingKey(draftPayload) !== acknowledged;

  const rows = useQuery({
    queryKey: keys.imports.rowsPreview(batch.id),
    queryFn: () => getDataImportRows(batch.id, { page_size: PREVIEW_ROWS }),
  });

  const save = useMutation({
    mutationFn: (payload: MappingPayload) => saveDataImportMapping(batch.id, payload),
    onSuccess: async (updated, payload) => {
      setAcknowledged(mappingKey(payload));
      queryClient.setQueryData(keys.imports.batch(batch.id), updated);
      await queryClient.invalidateQueries({ queryKey: keys.imports.rows(batch.id) });
    },
  });

  // The suggested columns are saved straight away, so every row is read
  // with them; the importer changes any that are wrong.
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
  // The fields the server says nothing covers.
  const missing = batch.target_fields.filter((field) => batch.uncovered_fields.includes(field.field));
  const counts = batch.row_counts;
  const noColumn = Object.keys(columnFor).length === 0;
  const blockedWhy =
    clashes.size > 0
      ? `${[...clashes].map(fieldName).join(", ")} ${agreeing(clashes.size, "is", "are")} chosen for two columns.`
      : noColumn
        ? "Match at least one column."
        : null;

  return (
    <>
      <section aria-labelledby="ix-match-h" className="card stack stack--4">
        <div>
          <h2 className="section-title" id="ix-match-h" tabIndex={-1}>
            Match your columns
          </h2>
          <p className="subtext">
            Say what each column of your file holds. Every row is read again as you choose; the file itself is never
            changed.
          </p>
        </div>
        {saved ? (
          <p aria-live="polite" className="subtext">
            <strong className="ix-success-text">{counts.ready}</strong> of {counts.total} rows ready ·{" "}
            <strong className="ix-warning-text">{counts.review_required}</strong> to fix
          </p>
        ) : null}

        {missing.map((field) => (
          <Alert
            tone="warning"
            role="status"
            key={field.field}
            title={`No column holds ${field.name === "WKSA ID" ? "the WKSA ID" : field.name.toLowerCase()}.`}
            action={
              field.whole_file && field.field === "current_rank" ? (
                <label className="field field--sentence">
                  <span>Same for everyone</span>
                  <select
                    disabled={save.isPending}
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
              ) : undefined
            }
          >
            {field.whole_file
              ? "Choose its column below, set one value for everyone, or give it on each row to fix."
              : "Choose its column below, or give it on each row to fix."}
          </Alert>
        ))}

        {rankDefault && !columnFor.current_rank ? (
          <p>
            Rank for everyone: <strong>{rankDefault}</strong>. A row can still be given its own.{" "}
            <Button
              variant="link"
              disabled={save.isPending}
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
          <Alert
            action={
              <Button variant="link" onClick={() => save.mutate(draftPayload)}>
                Retry saving columns
              </Button>
            }
          >
            {errorMessage(save.error, "The columns could not be saved. Try again in a moment.")}
          </Alert>
        ) : null}

        <ul aria-label="Your file's columns" className="list-plain stack stack--3">
          {batch.detected_headers.map((header) => {
            const choice = choices[header] ?? "";
            const suggested = batch.suggested_mapping[choice] === header;
            return (
              <li className="ix-column" key={header}>
                <span className="ix-column__text">
                  <span className="item-title">{header}</span>
                  <span className="subtext">{rows.isPending ? "Reading…" : examples(previewRows, header)}</span>
                </span>
                <select
                  aria-label={`What “${header}” holds`}
                  className={cx(
                    "ix-col-select",
                    clashes.has(choice) ? "ix-col-select-clash" : suggested && "ix-col-select-suggested",
                  )}
                  disabled={save.isPending}
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
              </li>
            );
          })}
        </ul>
        <p className="subtext">Status is Active where none is given.</p>
      </section>

      <ActionBar
        status={
          save.isPending ? (
            <p className="subtext" role="status">
              Checking every row…
            </p>
          ) : dirty ? (
            <p className="ix-why error-text" role="status">
              Save the visible changes first.
            </p>
          ) : blockedWhy ? (
            <p className="ix-why error-text" id="ix-match-why">
              {blockedWhy}
            </p>
          ) : null
        }
      >
        <Button
          aria-describedby={blockedWhy ? "ix-match-why" : undefined}
          variant="primary"
          disabled={Boolean(blockedWhy) || !saved || dirty || save.isPending || save.isError}
          onClick={onDone}
        >
          Done
        </Button>
      </ActionBar>
    </>
  );
}
