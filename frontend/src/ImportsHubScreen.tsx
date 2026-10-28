import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import {
  type DataImportBatch,
  type DataImportKind,
  cancelDataImportBatch,
  errorMessage,
  getDataImportBatches,
  getLegacyGradingRecords,
} from "./api";
import { useAuth } from "./auth";
import { formatShortDateTime } from "./dates";
import { ImportDialog } from "./ImportDialog";
import { ImportPager } from "./ImportPager";
import { counted, importKindLabel, importStepIndex, importStepNames } from "./importSteps";
import { downloadStandardTemplate } from "./importTemplate";
import "./Imports.css";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";

const PAST_PAGE_SIZE = 10;
const FINISHED = "COMMITTED,CANCELLED,EXPIRED";

/** What an unfinished import's rows look like so far, in a line. */
function unfinishedCounts(batch: DataImportBatch): string {
  const counts = batch.row_counts;
  if (batch.kind === "LEGACY_GRADINGS") {
    return `${counted(counts.total, "record", "records")} found`;
  }
  if (batch.next_step === "MATCH_COLUMNS") {
    return `${counted(counts.total, "row", "rows")} read · columns still to match`;
  }
  return [
    `${counts.ready} ready`,
    counts.review_required ? `${counts.review_required} need attention` : null,
    counts.skip_existing ? `${counts.skip_existing} already in KukGrade` : null,
    counts.excluded ? `${counts.excluded} left out` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a finished import did, in a line. */
function finishedResult(batch: DataImportBatch): string {
  if (batch.status !== "COMMITTED") return "Nothing saved";
  const summary = batch.summary_json;
  if (batch.kind === "LEGACY_GRADINGS") {
    return counted(summary.total ?? 0, "record", "records");
  }
  const parts = [counted(summary.created ?? 0, "student added", "students added")];
  if (summary.skipped_existing) parts.push(`${summary.skipped_existing} already here`);
  return parts.join(" · ");
}

function statePill(batch: DataImportBatch) {
  const tone =
    batch.status === "COMMITTED" ? "success" : batch.status === "UPLOADED" ? "warning" : "neutral";
  return <span className={`ix-pill ix-pill-${tone}`}>{batch.status_display}</span>;
}

function UnfinishedImports({
  batches,
  onCancel,
}: {
  batches: DataImportBatch[];
  onCancel: (batch: DataImportBatch) => void;
}) {
  return (
    <section aria-labelledby="ix-unfinished" className="ix-section">
      <div className="ix-section-head">
        <h2 id="ix-unfinished">Pick up where you left off</h2>
        <span className="ix-muted ix-small">
          An unfinished import is cleared a day after it was uploaded.
        </span>
      </div>
      <div className="ix-card">
        {batches.map((batch) => {
          const step = importStepIndex(batch);
          return (
            <div className="ix-row" key={batch.id}>
              <div className="ix-row-main">
                <p className="ix-kind">{importKindLabel(batch.kind)}</p>
                <p className="ix-strong">{batch.original_filename}</p>
                <p className="ix-muted ix-small">
                  Uploaded {formatShortDateTime(batch.uploaded_at)} by {batch.uploaded_by_name}
                </p>
              </div>
              <div className="ix-row-main">
                <p className="ix-small ix-semibold">
                  Step {step + 1} of 5 · {importStepNames(batch.kind)[step]}
                </p>
                <div aria-hidden="true" className="ix-progress">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <span className={index <= step ? "ix-filled" : undefined} key={index} />
                  ))}
                </div>
                <p className="ix-muted ix-small">{unfinishedCounts(batch)}</p>
              </div>
              <div className="ix-actions">
                <Link
                  aria-label={`Resume ${batch.original_filename}`}
                  className={buttonClass({ variant: "primary" })}
                  to={`/imports/${batch.id}`}
                >
                  Resume
                </Link>
                <Button
                  aria-label={`Cancel ${batch.original_filename}`}
                  variant="ghost"
                  onClick={() => onCancel(batch)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StartPanels({ awaitingLink, canLink }: { awaitingLink: number | undefined; canLink: boolean }) {
  return (
    <section aria-labelledby="ix-start" className="ix-section">
      <h2 className="ix-heading ix-flush" id="ix-start">
        Start an import
      </h2>
      <div className="ix-grid-2">
        <div className="ix-card ix-panel">
          <div className="ix-panel-body">
            <h3>Students</h3>
            <p className="ix-muted">
              A list of students, one per row: name, date of birth, WKSA ID and rank.
            </p>
            <div className="ix-actions ix-push-down">
              <Link className={buttonClass({ variant: "primary" })} to="/imports/new?kind=STUDENT_ROSTER">
                Import students
              </Link>
              <button className="ix-link-button" type="button" onClick={downloadStandardTemplate}>
                Download the template
              </button>
            </div>
          </div>
        </div>
        <div className="ix-card ix-panel">
          <div className="ix-panel-body">
            <h3>Past gradings</h3>
            <p className="ix-muted">
              An old grading record workbook: who tested, for which rank, the outcome and the
              comments.
            </p>
            <div className="ix-actions ix-push-down">
              <Link className={buttonClass({ variant: "primary" })} to="/imports/new?kind=LEGACY_GRADINGS">
                Import past gradings
              </Link>
              {canLink ? <Link className={buttonClass({ variant: "secondary" })} to="/imports/history">Browse and correct records</Link> : null}
            </div>
          </div>
          {awaitingLink ? (
            <div className="ix-panel-foot">
              <p className="ix-small">
                <strong className="ix-warning-text">
                  {counted(awaitingLink, "imported record", "imported records")}
                </strong>{" "}
                {awaitingLink === 1 ? "is" : "are"} not linked to a student yet.
              </p>
              {canLink ? (
                <Link className="ix-link-button" to="/imports/records">
                  Link records
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PastImports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = (searchParams.get("kind") ?? "") as DataImportKind | "";
  const state = searchParams.get("state") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const past = useQuery({
    queryKey: ["imports", "past", kind, state, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getDataImportBatches({
        kind: kind || undefined,
        status: state || FINISHED,
        page,
        page_size: PAST_PAGE_SIZE,
      }),
  });

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    setSearchParams(next, { replace: true });
  }

  function setPage(next: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    setSearchParams(params, { replace: true });
  }

  const batches = past.data?.results ?? [];
  const total = past.data?.count ?? 0;

  return (
    <section aria-labelledby="ix-past" className="ix-section">
      <div className="ix-section-head ix-align-end">
        <h2 id="ix-past">Past imports</h2>
        <div className="ix-filters">
          <label className="ix-field">
            What
            <select value={kind} onChange={(event) => setFilter("kind", event.target.value)}>
              <option value="">Everything</option>
              <option value="STUDENT_ROSTER">Students</option>
              <option value="LEGACY_GRADINGS">Past gradings</option>
            </select>
          </label>
          <label className="ix-field">
            State
            <select value={state} onChange={(event) => setFilter("state", event.target.value)}>
              <option value="">Any</option>
              <option value="COMMITTED">Imported</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </label>
        </div>
      </div>
      <div className="ix-card">
        {past.isPending ? (
          <p className="ix-muted ix-card-pad" role="status">
            Loading past imports…
          </p>
        ) : past.isError ? (
          <p className="ix-danger-text ix-card-pad" role="alert">
            {errorMessage(past.error, "Past imports could not be loaded. Try again in a moment.")}
          </p>
        ) : batches.length === 0 ? (
          <p className="ix-muted ix-card-pad">
            {kind || state ? "No imports match these filters." : "No imports have finished yet."}
          </p>
        ) : (
          <>
            <div className="ix-table-wrap">
              <table className="ix-table">
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">What</th>
                    <th scope="col">State</th>
                    <th scope="col">Result</th>
                    <th scope="col">When</th>
                    <th scope="col">
                      <span className="ix-visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td className="ix-strong">{batch.original_filename}</td>
                      <td>{importKindLabel(batch.kind)}</td>
                      <td>{statePill(batch)}</td>
                      <td>{finishedResult(batch)}</td>
                      <td className="ix-muted ix-nowrap">
                        {formatShortDateTime(batch.committed_at ?? batch.cancelled_at ?? batch.uploaded_at)}
                        {" · "}
                        {batch.committed_by_name || batch.uploaded_by_name}
                      </td>
                      <td className="ix-cell-action">
                        <Link
                          aria-label={`View ${batch.original_filename}`}
                          className="ix-link-button"
                          to={`/imports/${batch.id}`}
                        >
                          {batch.status === "COMMITTED" ? "View results" : "View"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ImportPager page={page} pages={Math.max(1, Math.ceil(total / PAST_PAGE_SIZE))} total={total} onPage={setPage} />
          </>
        )}
      </div>
    </section>
  );
}

/** The Imports area's front page. */
export function ImportsHubScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<DataImportBatch | null>(null);

  const unfinished = useQuery({
    queryKey: ["imports", "unfinished"],
    queryFn: () => getDataImportBatches({ status: "UPLOADED", page_size: 50 }),
  });
  const awaitingLink = useQuery({
    queryKey: ["legacyRecords", "awaitingLinkCount"],
    queryFn: () => getLegacyGradingRecords({ awaiting_link: true, page_size: 1 }),
  });

  const cancel = useMutation({
    mutationFn: (batch: DataImportBatch) => cancelDataImportBatch(batch.id),
    onSuccess: async () => {
      setCancelling(null);
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });

  const open = unfinished.data?.results ?? [];

  return (
    <section aria-labelledby="ix-title" className="page ix-page">
      <div className="ix-header">
        <div className="ix-header-text">
          <p className="ix-eyebrow">Administration</p>
          <h1 id="ix-title">Imports</h1>
          <p className="ix-lead">
            Bring students and past gradings in from a spreadsheet. Nothing is saved until you
            confirm the last step, and you can leave and come back.
          </p>
        </div>
      </div>

      {unfinished.isError ? (
        <p className="ix-danger-text" role="alert">
          {errorMessage(unfinished.error, "Unfinished imports could not be loaded.")}
        </p>
      ) : null}
      {open.length > 0 ? (
        <UnfinishedImports batches={open} onCancel={(batch) => setCancelling(batch)} />
      ) : null}

      <StartPanels
        awaitingLink={awaitingLink.data?.count}
        canLink={Boolean(user?.can_reconcile_imported_history)}
      />

      <PastImports />

      {cancelling ? (
        <ImportDialog
          confirmLabel="Cancel the import"
          danger
          error={cancel.isError ? errorMessage(cancel.error, "The import could not be cancelled.") : null}
          pending={cancel.isPending}
          pendingLabel="Cancelling…"
          title={`Cancel ${cancelling.original_filename}?`}
          onClose={() => {
            cancel.reset();
            setCancelling(null);
          }}
          onConfirm={() => cancel.mutate(cancelling)}
        >
          <p className="ix-muted">
            The file and everything you did with it are removed, and nothing is imported. You can
            start again with the file at any time.
          </p>
        </ImportDialog>
      ) : null}
    </section>
  );
}
