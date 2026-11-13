import { Alert } from "./Alert";
import { Button } from "./Button";
import { WarningIcon } from "./Icons";
import { type Refusal, type RefusalAction, refusalOf, type usePdfDownload } from "./pdfDownloads";

const ACTION_LABELS: Record<RefusalAction, string> = {
  REFRESH_LIST: "Refresh the list",
  REFRESH_PAGE: "Refresh the page",
  TRY_AGAIN: "Try again",
  CLOSE: "Close",
};

/**
 * Why a PDF was not made: one box at a time, with the reason, each candidate
 * it affects by name, what to do, and the one button that does it. Nothing is
 * saved until every candidate chosen can be.
 */
function PdfRefusal({ refusal, onAction }: { refusal: Refusal; onAction: (action: RefusalAction) => void }) {
  return (
    <Alert
      title="Nothing was downloaded"
      icon={<WarningIcon size={18} />}
      data-testid="pdf-refusal"
      action={
        <Button variant="secondary" small onClick={() => onAction(refusal.action)}>
          {ACTION_LABELS[refusal.action]}
        </Button>
      }
    >
      <div className="stack stack--1">
        <span>{refusal.reason}</span>
        {refusal.candidates.length > 0 && (
          <ul>
            {refusal.candidates.map((candidate, index) => (
              <li key={`${candidate.name}-${index}`}>
                <strong>{candidate.name}</strong>: {candidate.why}
              </li>
            ))}
          </ul>
        )}
        {refusal.help && <span className="meta">{refusal.help}</span>}
      </div>
    </Alert>
  );
}

/**
 * What became of the last PDF asked for on a page: saved under its name, or
 * refused, with the way on. `nameOf` names a candidate the server refused;
 * `onRefresh` reads the page's records again.
 */
export function PdfDownloadNotice({
  download,
  nameOf = () => undefined,
  onRefresh,
}: {
  download: ReturnType<typeof usePdfDownload>;
  nameOf?: (candidateId: number) => string | undefined;
  onRefresh: () => void;
}) {
  if (download.isSuccess) {
    return (
      <p className="meta" role="status">
        Saved as <strong>{download.data.name}</strong>
      </p>
    );
  }
  if (!download.isError) return null;
  return (
    <PdfRefusal
      refusal={refusalOf(download.error, nameOf)}
      onAction={(action) => {
        if (action === "TRY_AGAIN" && download.variables) {
          download.mutate(download.variables);
          return;
        }
        download.reset();
        if (action === "REFRESH_LIST" || action === "REFRESH_PAGE") onRefresh();
      }}
    />
  );
}
