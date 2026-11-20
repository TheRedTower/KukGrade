import { useMutation } from "@tanstack/react-query";
import { type DataImportBatch, type DataImportRow, correctDataImportRow, errorMessage } from "./api";
import { ErrorText } from "./ErrorText";
import { ImportCellInput } from "./ImportCellInput";
import { importKinds } from "./importKinds";
import { useRanksQuery } from "./queries";
import { Button } from "./Button";
import { ExclusionButton } from "./ImportReviewParts";
import type { Exclusion } from "./importReviewRows";
import { useChoices } from "./choices";
import { cx } from "./cx";

/**
 * One roster row's fields, each fixable: a fix is saved and the row checked
 * again straight away, the file's own value shown beside it with Undo.
 */
export function RosterRowEditor({
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
