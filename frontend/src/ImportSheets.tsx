import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ActionBar } from "./ActionBar";
import {
  type DataImportBatch,
  type LegacySheet,
  cancelDataImportBatch,
  chooseLegacySheets,
  errorMessage,
  getLegacySheets,
} from "./api";
import { Badge } from "./Badge";
import type { BadgeTone } from "./badgeClass";
import { Button } from "./Button";
import { ErrorText } from "./ErrorText";
import { FoundChecklist } from "./ImportFound";
import { ChevronRightIcon } from "./Icons";
import { LoadingState } from "./LoadingState";
import { useImportRefresh } from "./useImportRefresh";
import { counted } from "./plural";
import { keys } from "./queryKeys";

const STATE_TONE: Record<LegacySheet["state"], BadgeTone> = {
  NEW: "success",
  IMPORTED: "neutral",
  CHANGED: "warning",
};

/** What differs between a changed sheet and what KukGrade holds for its month. */
function Differences({ sheet }: { sheet: LegacySheet }) {
  const said = (record: LegacySheet["added"][number]) =>
    [record.name, [record.current_rank, record.testing_for_rank].filter(Boolean).join(" → "), record.outcome]
      .filter(Boolean)
      .join(" · ");
  const lines = [
    ...sheet.added.map((record, index) => ({ key: `new-${index}`, text: `New: ${said(record)}` })),
    ...sheet.removed.map((record, index) => ({
      key: `gone-${index}`,
      text: `No longer in the workbook: ${said(record)}`,
    })),
  ];
  return (
    <details className="disclosure">
      <summary>
        <ChevronRightIcon />
        What differs: {sheet.added_count} new, {sheet.removed_count} no longer there
      </summary>
      <ul className="list-plain stack stack--1 disclosure__body">
        {lines.map((line) => (
          <li className="subtext" key={line.key}>
            {line.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * What KukGrade found in the workbook, and a tick for each grading sheet to
 * bring in: the new ones come ticked; one already imported, or changed since,
 * only when it is chosen, and then only what KukGrade does not hold.
 */
export function ImportSheets({
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
  const sheets = useQuery({ queryKey: keys.imports.sheets(batch.id), queryFn: () => getLegacySheets(batch.id) });
  const choose = useMutation({
    mutationFn: (included: string[]) => chooseLegacySheets(batch.id, included),
    onSuccess: async (chosen) => {
      queryClient.setQueryData(keys.imports.sheets(batch.id), chosen);
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

  const list = sheets.data ?? [];
  const chosen = list.filter((sheet) => sheet.included);
  function toggle(name: string, included: boolean) {
    const names = chosen.map((sheet) => sheet.name).filter((other) => other !== name);
    choose.mutate(included ? [...names, name] : names);
  }

  return (
    <>
      <section aria-labelledby="ix-sheets" className="card stack stack--4">
        <FoundChecklist batch={batch} importedBefore={importedBefore} />
        <h2 className="section-title" id="ix-sheets">
          Grading sheets to bring in
        </h2>
        {sheets.isPending ? (
          <LoadingState compact>Reading the sheets…</LoadingState>
        ) : sheets.isError ? (
          <ErrorText>{errorMessage(sheets.error, "The sheets could not be read. Try again in a moment.")}</ErrorText>
        ) : (
          <ul className="list-plain stack stack--3">
            {list.map((sheet) => (
              <li className="stack stack--1" key={sheet.name}>
                <div className="row row--wrap">
                  <label className="check">
                    <input
                      checked={sheet.included}
                      disabled={choose.isPending}
                      type="checkbox"
                      onChange={(event) => toggle(sheet.name, event.target.checked)}
                    />
                    <span className="check__text">
                      <span className="item-title">{sheet.name}</span>
                      <span className="subtext">{counted(sheet.records, "record", "records")}</span>
                    </span>
                  </label>
                  <Badge tone={STATE_TONE[sheet.state]}>{sheet.state_display}</Badge>
                </div>
                {sheet.state === "CHANGED" ? <Differences sheet={sheet} /> : null}
              </li>
            ))}
          </ul>
        )}
        {choose.isError ? <ErrorText>{errorMessage(choose.error, "That sheet could not be chosen.")}</ErrorText> : null}
        {cancel.isError ? (
          <ErrorText>{errorMessage(cancel.error, "The import could not be cancelled.")}</ErrorText>
        ) : null}
      </section>
      <ActionBar
        status={
          <p className="subtext">
            {counted(batch.row_counts.ready, "record", "records")} from {counted(chosen.length, "sheet", "sheets")} will
            come in
          </p>
        }
      >
        <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel import
        </Button>
        <Button variant="primary" disabled={choose.isPending || sheets.isPending} onClick={onContinue}>
          Continue
        </Button>
      </ActionBar>
    </>
  );
}
