import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getDataImportBatch } from "./api";
import { ImportResults } from "./ImportResults";
import { PastGradingsImport } from "./PastGradingsImport";
import { RecordPage } from "./RecordPage";
import { StudentListImport } from "./StudentListImport";
import { recordStatus, useIdParam } from "./recordStatus";
import "./Imports.css";
import { buttonClass } from "./buttonClass";
import { keys } from "./queryKeys";

/** One import, opened at the step it is up to - so it survives a reload. */
export function ImportScreen() {
  const id = useIdParam();
  // The query waits for a real id; 0 is never sent.
  const batchId = id ?? 0;
  const batch = useQuery({
    queryKey: keys.imports.batch(batchId),
    queryFn: () => getDataImportBatch(batchId),
    enabled: id !== null,
  });

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

  // Each kind runs through steps of its own, each in the address.
  if (loaded.kind === "LEGACY_GRADINGS") return <PastGradingsImport batch={loaded} />;
  return <StudentListImport batch={loaded} />;
}
