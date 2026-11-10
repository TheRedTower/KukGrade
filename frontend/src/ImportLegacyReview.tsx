import { labelOf, useChoices } from "./choices";
import { useState } from "react";
import { ResponsiveTable } from "./ResponsiveTable";
import { type DataImportBatch, type LegacyImportPreview } from "./api";
import { usePagedRows } from "./useImportRows";
import { useDebouncedValue } from "./useDebouncedValue";
import { Button } from "./Button";
import { CountTiles, ExclusionButton, LastLook, ListHead, RowLines, RowsList } from "./ImportReviewParts";
import { PAGE_SIZE, RowParams, Tile, useRowExclusion, where } from "./importReviewRows";
import { counted } from "./plural";

type LegacyView = "attention" | "results" | "others" | "EXCLUDED" | "check";

export function LegacyReview({
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

  const leftOut = labelOf(useChoices().import_row_outcomes, "EXCLUDED");
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
    { key: "EXCLUDED", label: leftOut, count: batch.row_counts.excluded, tone: "subtext", mark: "–" },
  ];
  const heads: Record<LegacyView, [string, string]> = {
    attention: [
      "Records worth a look",
      "Nothing here stops the import: every record is kept exactly as the workbook has it. Leave out anything that should not be imported, such as a test row.",
    ],
    results: ["Grading results", "One per student per grading, with the comments kept in full as the grading report."],
    others: ["Did not attend and notes", "Kept as they are: who did not attend, and notes written beside the tables."],
    EXCLUDED: [leftOut, "These records will not be imported. Bring one back any time before you confirm."],
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
      <section aria-labelledby="ix-review-list" className="card card--flush">
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
              <div className="ix-ruled">
                <ResponsiveTable
                  flush
                  label="Records to check"
                  rows={list}
                  rowKey={(row) => row.row_number}
                  columns={[
                    {
                      key: "name",
                      header: "Name",
                      primary: true,
                      render: (row) => row.values.name || (row.values.note ? "Sheet note" : "(no name)"),
                    },
                    { key: "where", header: "Sheet · row", render: (row) => where(row, batch.kind) },
                    {
                      key: "ranks",
                      header: "Ranks",
                      render: (row) => [row.values.current_rank, row.values.testing_for_rank].filter(Boolean).join(" → "),
                    },
                    { key: "outcome", header: "Outcome", render: (row) => row.values.outcome },
                    {
                      key: "report",
                      header: "Comments (the grading report)",
                      render: (row) => row.values.report || row.values.note,
                    },
                    {
                      key: "change",
                      header: "Change",
                      actions: true,
                      render: (row) => <ExclusionButton exclusion={exclusion} kind={batch.kind} row={row} />,
                    },
                  ]}
                />
              </div>
            ) : (
              <RowLines exclusion={exclusion} kind={batch.kind} list={list} withIssues={view === "attention"} />
            )
          }
        </RowsList>
      </section>
      <div className="step-foot">
        <Button variant="ghost" onClick={onMatch}>
          Back to matching ranks
        </Button>
        <span className="subtext">Ranks still to match can be matched later, when linking records.</span>
      </div>
    </>
  );
}
