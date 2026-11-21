/**
 * The bar above the session's candidates that makes a PDF of those chosen:
 * their records, and while the grading is a draft or open, their grading
 * sheets. Which is ready is the server's to say for each candidate.
 */
import { useState } from "react";

import { type GradingSession, downloadCandidateRecords, printGradingSheets } from "./api";
import { Button } from "./Button";
import type { usePdfDownload } from "./pdfDownloads";
import type { CandidateSelection } from "./useCandidateSelection";

type Making = "records" | "sheets";

/** Select all, how many are chosen, and the buttons that make their PDF. */
export function CandidateDownloadBar({
  session,
  selection,
  download,
}: {
  session: GradingSession;
  selection: CandidateSelection;
  download: ReturnType<typeof usePdfDownload>;
}) {
  const [making, setMaking] = useState<Making | null>(null);
  const { chosen } = selection;
  const ids = chosen.map((item) => item.candidate.id);
  const sheets = session.can_print_grading_sheets;
  const unsealed = chosen.filter((item) => !item.candidate.can_download_record).length;
  const recordsReady = chosen.length > 0 && unsealed === 0;
  const sheetsReady = chosen.length > 0 && chosen.every((item) => item.candidate.can_print_grading_sheet);
  const busy = download.isPending;

  const make = (what: Making) => {
    setMaking(what);
    download.mutate(() =>
      what === "records" ? downloadCandidateRecords(session.id, ids) : printGradingSheets(session.id, ids),
    );
  };
  const label = (what: Making, words: string) => (busy && making === what ? "Preparing PDF…" : words);

  const hint = !sheets
    ? "Only candidates with a sealed record can be chosen."
    : chosen.length === 0
      ? "Choose who to print grading sheets for. Every registered candidate can have one, whether or not their form is prepared."
      : unsealed > 0
        ? `Records can be downloaded only once sealed: ${unsealed} of the ${chosen.length} selected ${
            unsealed === 1 ? "is" : "are"
          } not sealed yet.`
        : "Every selected candidate has a sealed record, so their records can be downloaded too.";

  return (
    <div className="stack stack--2" data-testid="gsd-download-bar">
      <div className="action-row">
        <div className="row row--wrap row--3">
          <label className="check">
            <input
              type="checkbox"
              checked={selection.allShownChosen}
              disabled={selection.shownChoosable.length === 0}
              onChange={selection.toggleAllShown}
            />
            <span>
              {sheets
                ? `Select all (${selection.shownChoosable.length})`
                : `Select all that can be downloaded (${selection.shownChoosable.length})`}
            </span>
          </label>
          <span className="meta" aria-live="polite">
            {chosen.length === 0 ? "None selected" : `${chosen.length} selected`}
          </span>
        </div>
        <div className="action-row">
          <Button variant="ghost" onClick={selection.clear} disabled={chosen.length === 0 || busy}>
            Clear
          </Button>
          <Button
            variant={sheets ? "secondary" : "primary"}
            onClick={() => make("records")}
            disabled={!recordsReady || busy}
          >
            {label("records", "Download records (PDF)")}
          </Button>
          {sheets && (
            <Button variant="primary" onClick={() => make("sheets")} disabled={!sheetsReady || busy}>
              {label("sheets", "Print grading sheets (PDF)")}
            </Button>
          )}
        </div>
      </div>
      <p className="meta">{hint}</p>
    </div>
  );
}
