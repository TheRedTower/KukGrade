import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DataImportBatch,
  type LegacyImportPreview,
  errorMessage,
  getDataImportRows,
  previewLegacyGradingImport,
} from "./api";
import { useRanksQuery } from "./queries";

const EXAMPLES = 5;

function key(text: string): string {
  return text.trim().toLowerCase();
}

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
    queryKey: ["imports", "legacyPreview", batch.id],
    queryFn: () => previewLegacyGradingImport(batch.id, {}),
  });
  const spellings = preview.data?.rank_suggestions ?? [];
  const chosen = batch.rank_mappings;
  const current = spellings.find((spelling) => spelling.source_text === picked) ?? spellings.find((spelling) => !chosen[key(spelling.source_text)]) ?? spellings[0];

  const examples = useQuery({
    queryKey: ["imports", "rows", batch.id, "rank", current?.source_text],
    queryFn: () => getDataImportRows(batch.id, { rank_text: current!.source_text, page_size: EXAMPLES }),
    enabled: current !== undefined,
  });

  const save = useMutation({
    mutationFn: (changes: Record<string, string | null>) => {
      const all: Record<string, string | null> = {};
      for (const spelling of spellings) {
        all[spelling.source_text] = chosen[key(spelling.source_text)] ?? null;
      }
      return previewLegacyGradingImport(batch.id, { rank_mappings: { ...all, ...changes } });
    },
    onSuccess: async (result: LegacyImportPreview) => {
      queryClient.setQueryData(["imports", "legacyPreview", batch.id], result);
      await queryClient.invalidateQueries({ queryKey: ["imports", "batch", batch.id] });
    },
  });

  const matched = spellings.filter((spelling) => chosen[key(spelling.source_text)]).length;
  const withSuggestion = spellings.filter(
    (spelling) => spelling.suggested_rank_code && !chosen[key(spelling.source_text)],
  );

  return (
    <>
      <section aria-labelledby="ix-ranks-h" className="ix-card ix-card-pad ix-section ix-roomy">
        <div className="ix-section-head ix-align-end">
          <div className="ix-head-text">
            <h2 className="ix-title" id="ix-ranks-h" tabIndex={-1}>
              Match the ranks
            </h2>
            <p className="ix-muted">
              Pick a spelling to see the records that use it, then say which KukGrade rank it
              means. The workbook’s own words are kept as the record of what was written; what you
              add is what they mean.
            </p>
          </div>
          {withSuggestion.length ? (
            <button
              className="btn-secondary"
              disabled={save.isPending}
              type="button"
              onClick={() =>
                save.mutate(
                  Object.fromEntries(withSuggestion.map((spelling) => [spelling.source_text, spelling.suggested_rank_code])),
                )
              }
            >
              Use all {withSuggestion.length} suggestions
            </button>
          ) : null}
        </div>

        {preview.isPending ? (
          <p className="ix-muted" role="status">
            Reading the ranks…
          </p>
        ) : preview.isError ? (
          <p className="ix-danger-text" role="alert">
            {errorMessage(preview.error, "The ranks could not be read. Try again in a moment.")}
          </p>
        ) : spellings.length === 0 ? (
          <p className="ix-muted">The workbook writes no ranks, so there is nothing to match.</p>
        ) : current ? (
          <div className="ix-two-col ix-two-col-queue">
            <div className="ix-card">
              <div className="ix-section ix-focus-body">
                <div className="ix-actions ix-align-end">
                  <label className="ix-field ix-field-wide">
                    “{current.source_text}” means
                    <select
                      disabled={save.isPending}
                      value={chosen[key(current.source_text)] ?? ""}
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
                  {current.suggested_rank_code && chosen[key(current.source_text)] !== current.suggested_rank_code ? (
                    <button
                      className="btn-secondary"
                      disabled={save.isPending}
                      type="button"
                      onClick={() => save.mutate({ [current.source_text]: current.suggested_rank_code })}
                    >
                      Use suggestion: {rankName(current.suggested_rank_code)}
                    </button>
                  ) : null}
                </div>
                {current.doubtful ? (
                  <p className="ix-banner ix-banner-warning ix-small">
                    The workbook marks this with “?”. The records keep that doubt, whatever you choose.
                  </p>
                ) : null}
                <div className="ix-table-wrap">
                  <table className="ix-table ix-table-compact">
                    <caption className="ix-caption">
                      Records using “{current.source_text}”
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Sheet</th>
                        <th scope="col">Held → Tested for</th>
                        <th scope="col">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(examples.data?.results ?? []).map((row) => (
                        <tr key={row.row_number}>
                          <td className="ix-semibold">{row.values.name || "(no name)"}</td>
                          <td className="ix-nowrap">{row.source_locator.split("!")[0]}</td>
                          <td>{`${row.values.current_rank || "(blank)"} → ${row.values.testing_for_rank || "(blank)"}`}</td>
                          <td>{row.values.outcome || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ix-muted ix-small ix-flush">
                  A rank left for later is still imported as written, and can be matched when you
                  link records to students.
                </p>
              </div>
            </div>
            <div aria-label="Rank spellings in the workbook" className="ix-card" role="group">
              <ul className="ix-queue">
                {spellings.map((spelling) => {
                  const choice = chosen[key(spelling.source_text)];
                  const status = choice ? rankName(choice) : spelling.suggested_rank_code ? "Suggested" : "No suggestion";
                  const tone = choice ? "success" : spelling.suggested_rank_code ? "info" : "warning";
                  return (
                    <li key={spelling.source_text}>
                      <button
                        aria-pressed={spelling.source_text === current.source_text}
                        type="button"
                        onClick={() => setPicked(spelling.source_text)}
                      >
                        <span className="ix-queue-text">
                          <span className="ix-queue-name">“{spelling.source_text}”</span>
                          <span className="ix-muted ix-small">
                            {spelling.rows} {spelling.rows === 1 ? "record" : "records"}
                          </span>
                        </span>
                        <span className={`ix-pill ix-pill-${tone}`}>{status}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}

        {save.isError ? (
          <p className="ix-danger-text" role="alert">
            {errorMessage(save.error, "That rank could not be saved.")}
          </p>
        ) : null}
      </section>

      <div className="ix-actions ix-actions-split">
        <button className="btn-ghost" type="button" onClick={onBack}>
          Back to Imports
        </button>
        <button className="btn-primary" disabled={save.isPending} type="button" onClick={onContinue}>
          {matched} of {spellings.length} matched · Continue
        </button>
      </div>
    </>
  );
}
