import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type DataImportBatch, commitDataImport, errorMessage } from "./api";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";
import { RosterReview } from "./ImportRosterReview";
import { keys } from "./queryKeys";
import { useDirtySet } from "./useDirtySet";
import { counted, agreeing } from "./plural";
import { CheckIcon } from "./Icons";

// What the seal says: a roster's rows become students.
const SEAL = {
  title: (count: number) => `Everything is sorted · ready to add ${counted(count, "student", "students")}`,
  action: (count: number) => `Add ${counted(count, "student", "students")}`,
  pending: "Adding…",
  line: (batch: DataImportBatch) => {
    const counts = batch.row_counts;
    return [
      counts.skip_existing
        ? `${counts.skip_existing} already in KukGrade ${agreeing(counts.skip_existing, "is", "are")} skipped`
        : null,
      counts.excluded ? `${counts.excluded} you left out` : null,
      batch.extra_columns.length
        ? `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept as extra information`
        : null,
      "all are added together, or none are",
    ];
  },
  confirmTitle: (count: number) => `Add ${counted(count, "student", "students")} to KukGrade?`,
  confirmBody:
    "They are saved together, so either all are added or none are. You can edit or remove any of them afterwards.",
};

/** The seal: once every row is sorted, the summary and the import itself. */
function Seal({
  batch,
  pending,
  blocked,
  onImport,
}: {
  batch: DataImportBatch;
  pending: boolean;
  blocked: boolean;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const words = SEAL;
  const count = batch.row_counts.ready;
  const action = words.action(count);
  const line = words.line(batch);
  const sentence = line.filter(Boolean).join(", ");

  return (
    <section aria-labelledby="ix-seal-h" className="card card--flush ix-banner ix-gold-edge">
      <span aria-hidden="true" className="mark mark--large" data-tone="success">
        <CheckIcon size={22} />
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
 * A roster's steps 3 and 4: every row reviewed, the ones needing attention
 * first, and - once all are sorted - the confirmation on the same page.
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
  const [announcement, setAnnouncement] = useState("");
  const unsavedCells = useDirtySet();
  // A refused import shows the review again from the top, as it now stands.
  const [refusals, setRefusals] = useState(0);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.imports.batch(batch.id) }),
      queryClient.invalidateQueries({ queryKey: keys.imports.rows(batch.id) }),
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
        // Past gradings can start once there are students.
        queryClient.invalidateQueries({ queryKey: keys.imports.starts() }),
      ]);
      onCommitted();
    },
    onError: async () => {
      await refresh();
      setRefusals((count) => count + 1);
    },
  });

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
      {batch.row_counts.review_required === 0 ? (
        <Seal
          batch={batch}
          blocked={unsavedCells.any}
          pending={commit.isPending}
          onImport={() => {
            if (!unsavedCells.any) commit.mutate();
          }}
        />
      ) : null}
      <RosterReview
        announce={setAnnouncement}
        batch={batch}
        key={refusals}
        onEditStateChange={unsavedCells.mark}
        onMatch={onMatch}
        onRefresh={refresh}
      />
    </>
  );
}
