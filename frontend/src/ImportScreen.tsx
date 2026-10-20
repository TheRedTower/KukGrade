import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { ApiError, errorMessage, getDataImportBatch } from "./api";
import { ImportResults } from "./ImportResults";
import { ImportStepBar } from "./ImportStepBar";
import { importKindTitle, importStepIndex } from "./importSteps";
import "./Imports.css";

/** One import, opened at the step it is up to - so it survives a reload. */
export function ImportScreen() {
  const { id } = useParams();
  const batchId = Number(id);
  const batch = useQuery({
    queryKey: ["imports", "batch", batchId],
    queryFn: () => getDataImportBatch(batchId),
    enabled: Number.isInteger(batchId) && batchId > 0,
  });

  if (!Number.isInteger(batchId) || batchId <= 0 || (batch.error instanceof ApiError && batch.error.status === 404)) {
    return (
      <section className="ix-page ix-page-narrow">
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1>Import not found</h1>
        <p className="ix-muted">It may have been cleared. Start again from Imports.</p>
      </section>
    );
  }
  if (batch.isPending) {
    return (
      <p className="ix-muted" role="status">
        Loading the import…
      </p>
    );
  }
  if (batch.isError) {
    return (
      <p className="ix-danger-text" role="alert">
        {errorMessage(batch.error, "The import could not be loaded. Try again in a moment.")}
      </p>
    );
  }

  const loaded = batch.data;
  if (loaded.status === "COMMITTED") return <ImportResults batch={loaded} />;

  if (loaded.status !== "UPLOADED") {
    return (
      <section aria-labelledby="ix-closed-title" className="ix-page ix-page-narrow">
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 id="ix-closed-title" style={{ overflowWrap: "anywhere" }}>
          {loaded.original_filename}
        </h1>
        <p>
          <span className="ix-pill ix-pill-neutral">{loaded.status_display}</span>
        </p>
        <p className="ix-muted">
          {loaded.status === "EXPIRED"
            ? "This import was not finished in time, so it was cleared. Nothing was saved."
            : "This import was cancelled. Nothing was saved."}
        </p>
        <Link className="btn-primary" style={{ alignSelf: "flex-start" }} to={`/imports/new?kind=${loaded.kind}`}>
          Start again
        </Link>
      </section>
    );
  }

  // The matching and review steps are the next slices of the import screens
  // (FDR-051 to FDR-053).
  return (
    <section aria-labelledby="ix-step-title" className="ix-page">
      <div>
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 id="ix-step-title" style={{ margin: "0.25rem 0 0" }}>
          {importKindTitle(loaded.kind)}
        </h1>
        <p className="ix-muted ix-small">{loaded.original_filename}</p>
      </div>
      <ImportStepBar current={importStepIndex(loaded)} kind={loaded.kind} />
      <p className="ix-card ix-card-pad ix-muted">This step is not ready in this version yet.</p>
    </section>
  );
}
