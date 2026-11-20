import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ActionBar } from "./ActionBar";
import { Alert } from "./Alert";
import { type DataImportBatch, commitDataImport, errorMessage, getLegacyChecksSummary, getLegacySheets } from "./api";
import { Button } from "./Button";
import { useImportRefresh } from "./useImportRefresh";
import { agreeing, counted } from "./plural";
import { keys } from "./queryKeys";

/**
 * The one confirmation: how many records from how many sheets, what is left
 * out, and what happens next. They are saved together, exactly as written,
 * or not at all.
 */
export function ImportSave({ batch, onBack }: { batch: DataImportBatch; onBack: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useImportRefresh(batch.id);
  const sheets = useQuery({ queryKey: keys.imports.sheets(batch.id), queryFn: () => getLegacySheets(batch.id) });
  const summary = useQuery({
    queryKey: keys.imports.checksSummary(batch.id),
    queryFn: () => getLegacyChecksSummary(batch.id),
  });
  const save = useMutation({
    mutationFn: () => commitDataImport(batch.id),
    onSuccess: async () => {
      await Promise.all(
        [keys.imports.all(), keys.legacyRecords.all(), keys.legacyPeople.all()].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      // The import is saved: its address shows what it saved.
      navigate({ search: "" }, { replace: true });
    },
    onError: refresh,
  });

  const counts = batch.row_counts;
  const chosen = (sheets.data ?? []).filter((sheet) => sheet.included).length;
  const open = summary.data?.open ?? 0;
  const lines = [
    counts.excluded ? `${counted(counts.excluded, "record", "records")} you left out` : null,
    counts.skip_existing
      ? `${counted(counts.skip_existing, "record", "records")} already in KukGrade ${agreeing(counts.skip_existing, "is", "are")} not added again`
      : null,
    counts.sheet_left_out
      ? `${counted(counts.sheet_left_out, "record", "records")} on sheets not chosen ${agreeing(counts.sheet_left_out, "stays", "stay")} out`
      : null,
    open ? `${counted(open, "thing", "things")} to check ${agreeing(open, "is", "are")} saved as written` : null,
  ].filter(Boolean);

  return (
    <>
      {save.isError ? (
        <Alert title="Nothing was saved.">
          {errorMessage(save.error, "Something changed since you looked. Look over the import and try again.")}
        </Alert>
      ) : null}
      <section aria-labelledby="ix-save" className="card stack stack--4">
        <h2 className="section-title" id="ix-save">
          Save {counted(counts.ready, "record", "records")} from {counted(chosen, "sheet", "sheets")}
        </h2>
        {lines.length ? (
          <ul className="list-plain stack stack--1">
            {lines.map((line) => (
              <li className="subtext" key={line}>
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="subtext">
          They are saved together, exactly as the workbook has them. Next, KukGrade groups them into people for you to
          sort.
        </p>
      </section>
      <ActionBar>
        <Button variant="ghost" disabled={save.isPending} onClick={onBack}>
          Back to things to check
        </Button>
        <Button variant="primary" disabled={save.isPending || counts.ready === 0} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : counts.ready === 0 ? "Nothing to save" : "Save records"}
        </Button>
      </ActionBar>
    </>
  );
}
