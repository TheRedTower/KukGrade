import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DataImportBatch, commitDataImport, errorMessage, previewLegacyGradingImport } from "./api";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";
import { LegacyReview } from "./ImportLegacyReview";
import { RosterReview } from "./ImportRosterReview";
import { keys } from "./queryKeys";
import { useDirtySet } from "./useDirtySet";
import { importKinds } from "./importKinds";

/** The seal: once every row is sorted, the summary and the import itself. */
function Seal({
  batch,
  unresolvedRanks,
  pending,
  blocked,
  onImport,
}: {
  batch: DataImportBatch;
  unresolvedRanks: number;
  pending: boolean;
  blocked: boolean;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const words = importKinds[batch.kind].seal;
  const count = batch.row_counts.ready;
  const action = words.action(count);
  const line = words.line(batch, unresolvedRanks);
  const sentence = line.filter(Boolean).join(", ");

  return (
    <section aria-labelledby="ix-seal-h" className="card card--flush ix-banner ix-gold-edge">
      <span aria-hidden="true" className="mark mark--large" data-tone="success">
        ✓
      </span>
      <div className="ix-seal-text">
        <h2 className="section-title" id="ix-seal-h" tabIndex={-1}>
          {words.title(count)}
        </h2>
        <p className="subtext">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</p>
      </div>
      <Button variant="primary" disabled={count === 0 || pending || blocked} onClick={() => setOpen(true)}>
        {pending ? words.pending : count === 0 ? "Nothing to import" : action}
      </Button>
      {blocked ? <p className="ix-warning-text ">Finish saving or retry row changes before adding students.</p> : null}
      {open ? (
        <ConfirmDialog
          cancelLabel="Not yet"
          confirmLabel={action}
          confirmDisabled={blocked}
          pending={pending}
          pendingLabel={words.pending}
          title={words.confirmTitle(count)}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            if (blocked) return;
            setOpen(false);
            onImport();
          }}
        >
          <p className="subtext">{words.confirmBody}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/**
 * Steps 3 and 4: every row reviewed, the ones needing attention first, and -
 * once all are sorted - the confirmation on the same page.
 */
export function ImportReview({
  batch,
  onMatch,
  onCommitted,
}: {
  batch: DataImportBatch;
  onMatch: () => void;
  onCommitted: () => void;
}) {
  const queryClient = useQueryClient();
  const { addsStudents } = importKinds[batch.kind];
  const [announcement, setAnnouncement] = useState("");
  const unsavedCells = useDirtySet();
  // A refused import shows the review again from the top, as it now stands.
  const [refusals, setRefusals] = useState(0);
  const preview = useQuery({
    queryKey: keys.imports.legacyPreview(batch.id),
    queryFn: () => previewLegacyGradingImport(batch.id, {}),
    enabled: !addsStudents,
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.imports.batch(batch.id) }),
      queryClient.invalidateQueries({ queryKey: keys.imports.rows(batch.id) }),
      queryClient.invalidateQueries({ queryKey: keys.imports.legacyPreview(batch.id) }),
    ]);
  }

  const commit = useMutation({
    mutationFn: () => commitDataImport(batch.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.imports.batch(batch.id) }),
        queryClient.invalidateQueries({ queryKey: keys.imports.rows(batch.id) }),
        queryClient.invalidateQueries({ queryKey: keys.imports.unfinished() }),
        queryClient.invalidateQueries({ queryKey: keys.imports.past() }),
        queryClient.invalidateQueries({ queryKey: keys.imports.historical() }),
      ]);
      onCommitted();
    },
    onError: async () => {
      await refresh();
      setRefusals((count) => count + 1);
    },
  });

  const sorted = !addsStudents || batch.row_counts.review_required === 0;
  const unresolvedRanks = (preview.data?.unresolved_current_rank ?? 0) + (preview.data?.unresolved_testing_for_rank ?? 0);
  return (
    <>
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {commit.isError ? (
        <Alert title="Nothing was saved.">
          {errorMessage(commit.error, "Something changed since the check. Look over the rows and try again.")}
        </Alert>
      ) : null}
      {sorted ? (
        <Seal batch={batch} blocked={addsStudents && unsavedCells.any} pending={commit.isPending} unresolvedRanks={unresolvedRanks} onImport={() => {
          if (!unsavedCells.any) commit.mutate();
        }} />
      ) : null}
      {addsStudents ? (
        <RosterReview announce={setAnnouncement} batch={batch} key={refusals} onEditStateChange={unsavedCells.mark} onMatch={onMatch} onRefresh={refresh} />
      ) : (
        <LegacyReview
          announce={setAnnouncement}
          batch={batch}
          key={refusals}
          preview={preview.data}
          onMatch={onMatch}
          onRefresh={refresh}
        />
      )}
    </>
  );
}
