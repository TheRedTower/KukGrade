import { Alert } from "./Alert";
import { ResponsiveTable } from "./ResponsiveTable";
import { Badge } from "./Badge";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DataImportBatch,
  type LegacyImportPreview,
  errorMessage,
  getDataImportRows,
  previewLegacyGradingImport,
} from "./api";
import { ErrorText } from "./ErrorText";
import { useRanksQuery } from "./queries";
import { Button } from "./Button";
import { keys } from "./queryKeys";
import { counted } from "./plural";
import { LoadingState } from "./LoadingState";

const EXAMPLES = 5;

/**
 * Step 2 of a historical import: each way the workbook writes a rank, the
 * records that use it, and the KukGrade rank it means. The
 * workbook's own words are kept as written.
 */
export function ImportMatchRanks({
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
  const rankName = (code: string) => ranks.find((rank) => rank.code === code)?.name ?? code;
  const [picked, setPicked] = useState<string | null>(null);

  // Asked without choices, so it reads the stored ones and changes nothing.
  const preview = useQuery({
    queryKey: keys.imports.legacyPreview(batch.id),
    queryFn: () => previewLegacyGradingImport(batch.id, {}),
  });
  const spellings = preview.data?.rank_suggestions ?? [];
  const current =
    spellings.find((spelling) => spelling.source_text === picked) ??
    spellings.find((spelling) => !spelling.chosen_rank_code) ??
    spellings[0];

  const examples = useQuery({
    queryKey: keys.imports.rowsWithRank(batch.id, current?.source_text),
    queryFn: () => getDataImportRows(batch.id, { rank_text: current!.source_text, page_size: EXAMPLES }),
    enabled: current !== undefined,
  });

  const save = useMutation({
    mutationFn: (changes: Record<string, string | null>) => {
      const all: Record<string, string | null> = {};
      for (const spelling of spellings) {
        all[spelling.source_text] = spelling.chosen_rank_code ?? null;
      }
      return previewLegacyGradingImport(batch.id, { rank_mappings: { ...all, ...changes } });
    },
    onSuccess: async (result: LegacyImportPreview) => {
      queryClient.setQueryData(keys.imports.legacyPreview(batch.id), result);
      await queryClient.invalidateQueries({ queryKey: keys.imports.batch(batch.id) });
    },
  });

  const matched = spellings.filter((spelling) => spelling.chosen_rank_code).length;
  const withSuggestion = spellings.filter((spelling) => spelling.suggested_rank_code && !spelling.chosen_rank_code);

  return (
    <>
      <section aria-labelledby="ix-ranks-h" className="card stack stack--4">
        <div className="ix-section-head ix-align-end">
          <div className="ix-head-text">
            <h2 className="ix-title" id="ix-ranks-h" tabIndex={-1}>
              Match the ranks
            </h2>
            <p className="subtext">
              Pick a spelling to see the records that use it, then say which KukGrade rank it means. The workbook’s own
              words are kept as the record of what was written; what you add is what they mean.
            </p>
          </div>
          {withSuggestion.length ? (
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  Object.fromEntries(
                    withSuggestion.map((spelling) => [spelling.source_text, spelling.suggested_rank_code]),
                  ),
                )
              }
            >
              Use all {withSuggestion.length} suggestions
            </Button>
          ) : null}
        </div>

        {preview.isPending ? (
          <LoadingState compact>Reading the ranks…</LoadingState>
        ) : preview.isError ? (
          <ErrorText>{errorMessage(preview.error, "The ranks could not be read. Try again in a moment.")}</ErrorText>
        ) : spellings.length === 0 ? (
          <p className="subtext">The workbook writes no ranks, so there is nothing to match.</p>
        ) : current ? (
          <div className="ix-two-col ix-two-col-queue">
            <div className="card card--flush">
              <div className="stack stack--3 ix-focus-body">
                <div className="row row--wrap ix-align-end">
                  <label className="field field--sentence ix-field-wide">
                    <span>“{current.source_text}” means</span>
                    <select
                      disabled={save.isPending}
                      value={current.chosen_rank_code ?? ""}
                      onChange={(event) => save.mutate({ [current.source_text]: event.target.value || null })}
                    >
                      <option value="">Decide later</option>
                      {ranks.map((rank) => (
                        <option key={rank.code} value={rank.code}>
                          {rank.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {current.suggested_rank_code && current.chosen_rank_code !== current.suggested_rank_code ? (
                    <Button
                      variant="secondary"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ [current.source_text]: current.suggested_rank_code })}
                    >
                      Use suggestion: {rankName(current.suggested_rank_code)}
                    </Button>
                  ) : null}
                </div>
                {current.doubtful ? (
                  <Alert tone="warning" role="status">
                    The workbook marks this with “?”. The records keep that doubt, whatever you choose.
                  </Alert>
                ) : null}
                <h3 className="ix-caption">Records using “{current.source_text}”</h3>
                <ResponsiveTable
                  label={`Records using “${current.source_text}”`}
                  rows={examples.data?.results ?? []}
                  rowKey={(row) => row.row_number}
                  columns={[
                    { key: "name", header: "Name", primary: true, render: (row) => row.values.name || "(no name)" },
                    { key: "sheet", header: "Sheet", render: (row) => row.source_locator.split("!")[0] },
                    {
                      key: "ranks",
                      header: "Held → Tested for",
                      render: (row) =>
                        `${row.values.current_rank || "(blank)"} → ${row.values.testing_for_rank || "(blank)"}`,
                    },
                    { key: "outcome", header: "Outcome", render: (row) => row.values.outcome || "—" },
                  ]}
                />
                <p className="subtext ix-flush">
                  A rank left for later is still imported as written, and can be matched when you link records to
                  students.
                </p>
              </div>
            </div>
            <div aria-label="Rank spellings in the workbook" className="card card--flush" role="group">
              <ul className="list-plain ix-queue">
                {spellings.map((spelling) => {
                  const choice = spelling.chosen_rank_code;
                  const status = choice
                    ? rankName(choice)
                    : spelling.suggested_rank_code
                      ? "Suggested"
                      : "No suggestion";
                  const tone = choice ? "success" : spelling.suggested_rank_code ? "info" : "warning";
                  return (
                    <li key={spelling.source_text}>
                      <button
                        aria-pressed={spelling.source_text === current.source_text}
                        type="button"
                        onClick={() => setPicked(spelling.source_text)}
                      >
                        <span className="ix-queue-text">
                          <span className="ix-queue-name item-title">“{spelling.source_text}”</span>
                          <span className="subtext">{counted(spelling.rows, "record", "records")}</span>
                        </span>
                        <Badge dot tone={tone}>
                          {status}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}

        {save.isError ? <ErrorText>{errorMessage(save.error, "That rank could not be saved.")}</ErrorText> : null}
      </section>

      <div className="step-foot">
        <Button variant="ghost" onClick={onBack}>
          Back to Imports
        </Button>
        <Button variant="primary" disabled={save.isPending} onClick={onContinue}>
          {matched} of {spellings.length} matched · Continue
        </Button>
      </div>
    </>
  );
}
