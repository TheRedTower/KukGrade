import { useEffect } from "react";
import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { getDataImportBatch } from "./api";
import { ImportMatchColumns } from "./ImportMatchColumns";
import { ImportMatchRanks } from "./ImportMatchRanks";
import { ImportResults } from "./ImportResults";
import { ImportReview } from "./ImportReview";
import { ImportStepBar } from "./ImportStepBar";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { importKinds } from "./importKinds";
import "./Imports.css";
import { buttonClass } from "./buttonClass";
import { keys } from "./queryKeys";

/** One import, opened at the step it is up to - so it survives a reload. */
export function ImportScreen() {
  const id = useIdParam();
  // The query waits for a real id; 0 is never sent.
  const batchId = id ?? 0;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const batch = useQuery({
    queryKey: keys.imports.batch(batchId),
    queryFn: () => getDataImportBatch(batchId),
    enabled: id !== null,
  });

  // The step is the one in the address, so a reload keeps it; with none, it
  // is where the server says the import is up to. Matching, once opened,
  // is written into the address: saving the first columns moves the import
  // on, but the importer has not finished matching.
  const asked = searchParams.get("step");
  const upTo = batch.data?.next_step === "MATCH" ? "match" : "review";
  const step = asked === "match" || asked === "review" ? asked : upTo;
  const open = batch.data?.status === "UPLOADED";
  useEffect(() => {
    if (open && !asked && upTo === "match") setSearchParams({ step: "match" }, { replace: true });
  }, [open, asked, upTo, setSearchParams]);

  const status = recordStatus(id, batch);
  if (status || !batch.data) {
    return (
      <RecordPage
        back={{ to: "/imports", label: "Imports" }}
        error={batch.error}
        failed="The import could not be loaded. Try again in a moment."
        label="Import"
        loading="Loading the import…"
        missing="Import not found"
        status={status ?? "loading"}
        onRetry={() => void batch.refetch()}
      />
    );
  }

  const loaded = batch.data;
  if (loaded.status === "COMMITTED") return <ImportResults batch={loaded} />;

  if (loaded.status !== "UPLOADED") {
    return (
      <section aria-labelledby="ix-closed-title" className="page">
        <PageHeader
          back={{ to: "/imports", label: "Imports" }}
          title={loaded.original_filename}
          titleId="ix-closed-title"
          tag={<Badge tone="neutral">{loaded.status_display}</Badge>}
          subtitle={
            loaded.status === "EXPIRED"
              ? "This import was not finished in time, so it was cleared. Nothing was saved."
              : "This import was cancelled. Nothing was saved."
          }
        />
        <Link className={buttonClass({ variant: "primary" }, "ix-start")} to={`/imports/new?kind=${loaded.kind}`}>
          Start again
        </Link>
      </section>
    );
  }

  const matching = step === "match";
  const goTo = (step: "match" | "review") => setSearchParams({ step });

  return (
    <section aria-labelledby="ix-step-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title={importKinds[loaded.kind].title}
        titleId="ix-step-title"
        subtitle={
          <>
            {loaded.original_filename}
            {loaded.sheet ? ` · sheet “${loaded.sheet}”` : ""} · {importKinds[loaded.kind].fileCounts(loaded)}
          </>
        }
      />
      <ImportStepBar current={matching ? "MATCH" : loaded.review_step} kind={loaded.kind} />
      {matching ? (
        importKinds[loaded.kind].match === "columns" ? (
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
