import { useState } from "react";
import { Badge } from "./Badge";
import { PageHeader } from "./PageHeader";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type DataImportBatch,
  type DataImportKind,
  cancelDataImportBatch,
  errorMessage,
  getDataImportBatches,
  LARGEST_PAGE,
  getLegacyRecordCounts,
} from "./api";
import { ErrorText } from "./ErrorText";
import { useAuth } from "./auth";
import { formatShortDateTime } from "./dates";
import { ConfirmDialog } from "./ConfirmDialog";
import { Pagination } from "./Pagination";
import { importKinds } from "./importKinds";
import { useImportSteps } from "./importSteps";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { useTemplateDownload } from "./importTemplate";
import "./Imports.css";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { useChoices } from "./choices";
import { keys } from "./queryKeys";
import { agreeing, counted } from "./plural";

const PAST_PAGE_SIZE = 10;

/** What a finished import did, in a line. */
function finishedResult(batch: DataImportBatch): string {
  return batch.status === "COMMITTED" ? importKinds[batch.kind].finished(batch.summary_json) : "Nothing saved";
}

function statePill(batch: DataImportBatch) {
  const tone = batch.status === "COMMITTED" ? "success" : batch.status === "UPLOADED" ? "warning" : "neutral";
  return (
    <Badge dot tone={tone}>
      {batch.status_display}
    </Badge>
  );
}

function UnfinishedImports({
  batches,
  onCancel,
}: {
  batches: DataImportBatch[];
  onCancel: (batch: DataImportBatch) => void;
}) {
  const stepsOf = useImportSteps();
  return (
    <section aria-labelledby="ix-unfinished" className="stack stack--3">
      <div className="ix-section-head">
        <h2 id="ix-unfinished">Pick up where you left off</h2>
        <span className="subtext">An unfinished import is cleared a day after it was uploaded.</span>
      </div>
      <div className="card card--flush">
        {batches.map((batch) => {
          const steps = stepsOf(batch.kind);
          const step = steps.findIndex((served) => served.value === batch.next_step);
          return (
            <div className="ix-row" key={batch.id}>
              <div className="ix-row-main">
                <p className="ix-kind eyebrow--muted">{batch.kind_display}</p>
                <p className="item-title">{batch.original_filename}</p>
                <p className="subtext">
                  Uploaded {formatShortDateTime(batch.uploaded_at)} by {batch.uploaded_by_name}
                </p>
              </div>
              <div className="ix-row-main">
                <p className="item-title">
                  Step {step + 1} of {steps.length} · {steps[step]?.label}
                </p>
                <div aria-hidden="true" className="ix-progress">
                  {steps.map((served, index) => (
                    <span className={index <= step ? "ix-filled" : undefined} key={served.value} />
                  ))}
                </div>
                <p className="subtext">{importKinds[batch.kind].unfinished(batch)}</p>
              </div>
              <div className="row row--wrap">
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
  const template = useTemplateDownload();
  return (
    <section aria-labelledby="ix-start" className="stack stack--3">
      <h2 className="section-title" id="ix-start">
        Start an import
      </h2>
      <div className="ix-grid-2">
        <div className="card card--flush ix-panel">
          <div className="ix-panel-body">
            <h3>Students</h3>
            <p className="subtext">A list of students, one per row: name, date of birth, WKSA ID and rank.</p>
            <div className="row row--wrap ix-push-down">
              <Link className={buttonClass({ variant: "primary" })} to="/imports/new?kind=STUDENT_ROSTER">
                Import students
              </Link>
              <Button variant="link" disabled={!template.ready} onClick={template.download}>
                Download the template
              </Button>
            </div>
          </div>
        </div>
        <div className="card card--flush ix-panel">
          <div className="ix-panel-body">
            <h3>Past gradings</h3>
            <p className="subtext">
              An old grading record workbook: who tested, for which rank, the outcome and the comments.
            </p>
            <div className="row row--wrap ix-push-down">
              <Link className={buttonClass({ variant: "primary" })} to="/imports/new?kind=LEGACY_GRADINGS">
                Import past gradings
              </Link>
              {canLink ? (
                <Link className={buttonClass({ variant: "secondary" })} to="/imports/history">
                  Browse and correct records
                </Link>
              ) : null}
            </div>
          </div>
          {awaitingLink ? (
            <div className="ix-panel-foot">
              <p>
                <strong className="ix-warning-text">
                  {counted(awaitingLink, "imported record", "imported records")}
                </strong>{" "}
                {agreeing(awaitingLink, "is", "are")} not linked to a student yet.
              </p>
              {canLink ? (
                <Link className={buttonClass({ variant: "link" })} to="/imports/records">
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
  const filters = useUrlFilters();
  const kind = filters.value("kind") as DataImportKind | "";
  const state = filters.value("state");
  const page = filters.page;
  const choices = useChoices();

  const paged = usePagedQuery({
    queryKey: keys.imports.past(kind, state, page),
    placeholderData: keepPreviousData,
    queryFn: () =>
      getDataImportBatches({
        kind: kind || undefined,
        status: state || undefined,
        finished: true,
        page,
        page_size: PAST_PAGE_SIZE,
      }),
    page,
    pageSize: PAST_PAGE_SIZE,
    onPage: filters.setPage,
  });
  const past = paged.query;
  const batches = paged.results;

  return (
    <section aria-labelledby="ix-past" className="stack stack--3">
      <h2 id="ix-past" className="section-title">
        Past imports
      </h2>
      <div className="filter-bar" role="search" aria-label="Import filters">
        <label className="field">
          <span>What</span>
          <select value={kind} onChange={(event) => filters.set({ kind: event.target.value })}>
            <option value="">Everything</option>
            {choices.import_kinds.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>State</span>
          <select value={state} onChange={(event) => filters.set({ state: event.target.value })}>
            <option value="">Any</option>
            {choices.finished_import_statuses.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="card card--flush">
        {past.isPending ? (
          <p className="subtext ix-card-pad" role="status">
            Loading past imports…
          </p>
        ) : past.isError ? (
          <ErrorText className="ix-card-pad">
            {errorMessage(past.error, "Past imports could not be loaded. Try again in a moment.")}
          </ErrorText>
        ) : batches.length === 0 ? (
          <p className="subtext ix-card-pad">
            {kind || state ? "No imports match these filters." : "No imports have finished yet."}
          </p>
        ) : (
          <>
            <ResponsiveTable
              label="Past imports"
              flush
              rows={batches}
              rowKey={(batch) => batch.id}
              columns={[
                {
                  key: "file",
                  header: "File",
                  primary: true,
                  render: (batch) => <strong>{batch.original_filename}</strong>,
                },
                { key: "what", header: "What", render: (batch) => batch.kind_display },
                { key: "state", header: "State", render: (batch) => statePill(batch) },
                { key: "result", header: "Result", render: (batch) => finishedResult(batch) },
                {
                  key: "when",
                  header: "When",
                  render: (batch) => (
                    <span className="subtext">
                      {formatShortDateTime(batch.committed_at ?? batch.cancelled_at ?? batch.uploaded_at)} ·{" "}
                      {batch.committed_by_name || batch.uploaded_by_name}
                    </span>
                  ),
                },
                {
                  key: "open",
                  header: "Open",
                  actions: "inline",
                  render: (batch) => (
                    <Link
                      aria-label={`View ${batch.original_filename}`}
                      className={buttonClass({ variant: "ghost", small: true })}
                      to={`/imports/${batch.id}`}
                    >
                      {batch.status === "COMMITTED" ? "View results" : "View"}
                    </Link>
                  ),
                },
              ]}
            />
            <Pagination flush label="Pages of past imports" noun={["import", "imports"]} {...paged.pager} />
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
    queryKey: keys.imports.unfinished(),
    queryFn: () => getDataImportBatches({ status: "UPLOADED", page_size: LARGEST_PAGE }),
  });
  const awaitingLink = useQuery({
    queryKey: keys.legacyRecords.awaitingLinkCount(),
    queryFn: () => getLegacyRecordCounts(),
  });

  const cancel = useMutation({
    mutationFn: (batch: DataImportBatch) => cancelDataImportBatch(batch.id),
    onSuccess: async () => {
      setCancelling(null);
      await queryClient.invalidateQueries({ queryKey: keys.imports.all() });
    },
  });

  const open = unfinished.data?.results ?? [];

  return (
    <section aria-labelledby="ix-title" className="page">
      <PageHeader
        title="Imports"
        titleId="ix-title"
        subtitle="Bring students and past gradings in from a spreadsheet. Nothing is saved until you confirm the last step, and you can leave and come back."
      />

      {unfinished.isError ? (
        <ErrorText>{errorMessage(unfinished.error, "Unfinished imports could not be loaded.")}</ErrorText>
      ) : null}
      {open.length > 0 ? <UnfinishedImports batches={open} onCancel={(batch) => setCancelling(batch)} /> : null}

      <StartPanels
        awaitingLink={awaitingLink.data?.awaiting_link}
        canLink={Boolean(user?.can_reconcile_imported_history)}
      />

      <PastImports />

      {cancelling ? (
        <ConfirmDialog
          cancelLabel="Not yet"
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
          <p className="subtext">
            The file and everything you did with it are removed, and nothing is imported. You can start again with the
            file at any time.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
