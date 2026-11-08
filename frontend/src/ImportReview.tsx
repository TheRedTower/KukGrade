import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DataImportBatch, commitDataImport, errorMessage, previewLegacyGradingImport } from "./api";
import { Alert } from "./Alert";
import { ImportDialog } from "./ImportDialog";
import { counted } from "./importSteps";
import { Button } from "./Button";
import { LegacyReview } from "./ImportLegacyReview";
import { RosterReview } from "./ImportRosterReview";

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
  const roster = batch.kind === "STUDENT_ROSTER";
  const counts = batch.row_counts;
  const count = counts.ready;
  const action = roster ? `Add ${counted(count, "student", "students")}` : `Import ${counted(count, "record", "records")}`;
  const line = roster
    ? [
        counts.skip_existing ? `${counts.skip_existing} already in KukGrade ${counts.skip_existing === 1 ? "is" : "are"} skipped` : null,
        counts.excluded ? `${counts.excluded} you left out` : null,
        batch.extra_columns.length ? `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept as extra information` : null,
        "all are added together, or none are",
      ]
    : [
        counts.excluded ? `${counts.excluded} you left out` : null,
        unresolvedRanks ? `${counted(unresolvedRanks, "rank", "ranks")} not matched stay as written` : null,
        "next, KukGrade suggests who each record belongs to",
      ];
  const sentence = line.filter(Boolean).join(", ");

  return (
    <section aria-labelledby="ix-seal-h" className="card card--flush ix-banner ix-gold-edge">
      <span aria-hidden="true" className="mark mark--large mark--success">
        ✓
      </span>
      <div className="ix-seal-text">
        <h2 className="section-title" id="ix-seal-h" tabIndex={-1}>
          {roster
            ? `Everything is sorted · ready to add ${counted(count, "student", "students")}`
            : `Ready to import ${counted(count, "historical record", "historical records")}`}
        </h2>
        <p className="subtext">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</p>
      </div>
      <Button variant="primary" disabled={count === 0 || pending || blocked} onClick={() => setOpen(true)}>
        {pending ? (roster ? "Adding…" : "Importing…") : count === 0 ? "Nothing to import" : action}
      </Button>
      {blocked ? <p className="ix-warning-text ">Finish saving or retry row changes before adding students.</p> : null}
      {open ? (
        <ImportDialog
          confirmLabel={action}
          confirmDisabled={blocked}
          pending={pending}
          pendingLabel={roster ? "Adding…" : "Importing…"}
          title={roster ? `${action} to KukGrade?` : `Import ${counted(count, "historical record", "historical records")}?`}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            if (blocked) return;
            setOpen(false);
            onImport();
          }}
        >
          <p className="subtext">
            {roster
              ? "They are saved together, so either all are added or none are. You can edit or remove any of them afterwards."
              : "They are saved together, exactly as the workbook has them. Next you link them to students."}
          </p>
        </ImportDialog>
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
  const roster = batch.kind === "STUDENT_ROSTER";
  const [announcement, setAnnouncement] = useState("");
  const [dirtyRosterCells, setDirtyRosterCells] = useState<string[]>([]);
  // A refused import shows the review again from the top, as it now stands.
  const [refusals, setRefusals] = useState(0);
  const preview = useQuery({
    queryKey: ["imports", "legacyPreview", batch.id],
    queryFn: () => previewLegacyGradingImport(batch.id, {}),
    enabled: !roster,
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["imports", "batch", batch.id] }),
      queryClient.invalidateQueries({ queryKey: ["imports", "rows", batch.id] }),
      queryClient.invalidateQueries({ queryKey: ["imports", "legacyPreview", batch.id] }),
    ]);
  }

  const commit = useMutation({
    mutationFn: () => commitDataImport(batch.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["imports", "batch", batch.id] }),
        queryClient.invalidateQueries({ queryKey: ["imports", "rows", batch.id] }),
        queryClient.invalidateQueries({ queryKey: ["imports", "unfinished"] }),
        queryClient.invalidateQueries({ queryKey: ["imports", "past"] }),
        queryClient.invalidateQueries({ queryKey: ["imports", "historical"] }),
      ]);
      onCommitted();
    },
    onError: async () => {
      await refresh();
      setRefusals((count) => count + 1);
    },
  });

  const sorted = !roster || batch.row_counts.review_required === 0;
  function editStateChanged(key: string, dirty: boolean) {
    setDirtyRosterCells((current) => dirty ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  }
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
        <Seal batch={batch} blocked={roster && dirtyRosterCells.length > 0} pending={commit.isPending} unresolvedRanks={unresolvedRanks} onImport={() => {
          if (dirtyRosterCells.length === 0) commit.mutate();
        }} />
      ) : null}
      {roster ? (
        <RosterReview announce={setAnnouncement} batch={batch} key={refusals} onEditStateChange={editStateChanged} onMatch={onMatch} onRefresh={refresh} />
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
