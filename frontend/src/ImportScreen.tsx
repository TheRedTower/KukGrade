import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError, errorMessage, getDataImportBatch } from "./api";
import { ImportMatchColumns } from "./ImportMatchColumns";
import { ImportMatchRanks } from "./ImportMatchRanks";
import { ImportResults } from "./ImportResults";
import { ImportReview } from "./ImportReview";
import { ImportStepBar } from "./ImportStepBar";
import { importKindTitle } from "./importSteps";
import "./Imports.css";
import { buttonClass } from "./buttonClass";

/** One import, opened at the step it is up to - so it survives a reload. */
export function ImportScreen() {
  const { id } = useParams();
  const batchId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const batch = useQuery({
    queryKey: ["imports", "batch", batchId],
    queryFn: () => getDataImportBatch(batchId),
    enabled: Number.isInteger(batchId) && batchId > 0,
  });

  // The step is the one in the address, so a reload keeps it; with none, it
  // is where the import is up to - matching until a roster's columns are
  // saved, and always first for a workbook's ranks. Matching, once opened,
  // is written into the address: saving the first columns moves the import
  // on, but the importer has not finished matching.
  const asked = searchParams.get("step");
  const upTo =
    batch.data?.kind === "LEGACY_GRADINGS" || batch.data?.next_step === "MATCH_COLUMNS"
      ? "match"
      : "review";
  const step = asked === "match" || asked === "review" ? asked : upTo;
  const open = batch.data?.status === "UPLOADED";
  useEffect(() => {
    if (open && !asked && upTo === "match") setSearchParams({ step: "match" }, { replace: true });
  }, [open, asked, upTo, setSearchParams]);

  if (!Number.isInteger(batchId) || batchId <= 0 || (batch.error instanceof ApiError && batch.error.status === 404)) {
    return (
      <section className="page page--narrow ix-page">
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
      <section aria-labelledby="ix-closed-title" className="page page--narrow ix-page">
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 className="ix-wrap" id="ix-closed-title">
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
        <Link className={buttonClass({ variant: "primary" }, "ix-start")} to={`/imports/new?kind=${loaded.kind}`}>
          Start again
        </Link>
      </section>
    );
  }

  const matching = step === "match";
  const goTo = (step: "match" | "review") => setSearchParams({ step });
  const sorted = loaded.kind !== "STUDENT_ROSTER" || loaded.row_counts.review_required === 0;
  const current = matching ? 1 : sorted ? 3 : 2;

  return (
    <section aria-labelledby="ix-step-title" className="page ix-page">
      <div>
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 className="ix-page-title" id="ix-step-title">
          {importKindTitle(loaded.kind)}
        </h1>
        <p className="ix-muted ix-small ix-wrap">
          {loaded.original_filename}
          {loaded.sheet ? ` · sheet “${loaded.sheet}”` : ""} ·{" "}
          {loaded.kind === "STUDENT_ROSTER"
            ? `${loaded.row_counts.total} rows`
            : `${loaded.grading_sheets.length} grading sheets, ${loaded.row_counts.total} records`}
        </p>
      </div>
      <ImportStepBar current={current} kind={loaded.kind} />
      {matching ? (
        loaded.kind === "STUDENT_ROSTER" ? (
          <ImportMatchColumns batch={loaded} onBack={() => navigate("/imports")} onContinue={() => goTo("review")} />
        ) : (
          <ImportMatchRanks batch={loaded} onBack={() => navigate("/imports")} onContinue={() => goTo("review")} />
        )
      ) : (
        <ImportReview batch={loaded} onCommitted={() => setSearchParams({})} onMatch={() => goTo("match")} />
      )}
    </section>
  );
}
