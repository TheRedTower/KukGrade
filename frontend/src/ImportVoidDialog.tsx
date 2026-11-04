import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type DataImportBatch, errorMessage, voidDataImportRecords } from "./api";
import { ImportDialog } from "./ImportDialog";

export function VoidDialog({ batch, onClose }: { batch: DataImportBatch; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const voiding = useMutation({
    mutationFn: () => voidDataImportRecords(batch.id, reason.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["legacyRecords"] }),
        queryClient.invalidateQueries({ queryKey: ["legacyPeople"] }),
      ]);
      onClose();
    },
  });
  return (
    <ImportDialog
      confirmDisabled={!reason.trim()}
      confirmLabel="Void every record"
      danger
      error={voiding.isError ? errorMessage(voiding.error, "The records could not be voided.") : null}
      pending={voiding.isPending}
      pendingLabel="Voiding…"
      title={`Void the records from ${batch.original_filename}?`}
      onClose={onClose}
      onConfirm={() => voiding.mutate()}
    >
      <p className="ix-muted">
        They are kept, marked void with your reason, and leave every student’s history. This
        cannot be undone except by importing the workbook again.
      </p>
      <div className="field field--sentence">
        <label htmlFor="ix-void-reason">Why</label>
        <textarea data-dialog-autofocus id="ix-void-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </ImportDialog>
  );
}
