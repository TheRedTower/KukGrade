import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ActionBar } from "./ActionBar";
import { type DataImportBatch, type LegacySheet, errorMessage, getLegacySheets } from "./api";
import { Button } from "./Button";
import { ErrorText } from "./ErrorText";
import { RowLines, RowsList } from "./ImportReviewParts";
import { PAGE_SIZE, useRowExclusion } from "./importReviewRows";
import { ChevronRightIcon } from "./Icons";
import { LoadingState } from "./LoadingState";
import { useImportRefresh } from "./useImportRefresh";
import { counted } from "./plural";
import { keys } from "./queryKeys";
import { usePagedRows } from "./useImportRows";

/** One sheet's records as written, a page at a time, each with Leave out. */
function SheetRecords({
  batch,
  sheet,
  announce,
}: {
  batch: DataImportBatch;
  sheet: LegacySheet;
  announce: (text: string) => void;
}) {
  const refresh = useImportRefresh(batch.id);
  const rows = usePagedRows(batch.id, { sheet: sheet.name }, PAGE_SIZE);
  const exclusion = useRowExclusion(batch, refresh, announce);
  return (
    <RowsList exclusion={exclusion} kind={batch.kind} rows={rows}>
      {(list) => <RowLines exclusion={exclusion} kind={batch.kind} list={list} />}
    </RowsList>
  );
}

/** Every record of the chosen sheets, sheet by sheet, exactly as written: to browse, and leave one out. */
export function ImportEveryRecord({ batch, onDone }: { batch: DataImportBatch; onDone: () => void }) {
  const sheets = useQuery({ queryKey: keys.imports.sheets(batch.id), queryFn: () => getLegacySheets(batch.id) });
  const [opened, setOpened] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const chosen = (sheets.data ?? []).filter((sheet) => sheet.included);

  return (
    <>
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      <section aria-labelledby="ix-every" className="card stack stack--4">
        <h2 className="section-title" id="ix-every">
          Every record
        </h2>
        <p className="subtext">Sheet by sheet, exactly as written. A record left out is not saved.</p>
        {sheets.isPending ? (
          <LoadingState compact>Reading the sheets…</LoadingState>
        ) : sheets.isError ? (
          <ErrorText>{errorMessage(sheets.error, "The sheets could not be read. Try again in a moment.")}</ErrorText>
        ) : chosen.length === 0 ? (
          <p className="subtext">No sheet is chosen, so there is nothing to save.</p>
        ) : (
          chosen.map((sheet) => (
            <details
              className="disclosure"
              key={sheet.name}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpened((names) => (open ? [...names, sheet.name] : names.filter((name) => name !== sheet.name)));
              }}
            >
              <summary>
                <ChevronRightIcon />
                {sheet.name} · {counted(sheet.records, "record", "records")}
              </summary>
              <div className="card card--flush disclosure__body">
                {opened.includes(sheet.name) ? (
                  <SheetRecords announce={setAnnouncement} batch={batch} sheet={sheet} />
                ) : null}
              </div>
            </details>
          ))
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
