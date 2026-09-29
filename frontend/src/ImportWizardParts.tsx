import type { ChangeEvent, ReactNode } from "react";

export function ImportUploadRow({
  accept,
  ariaLabel,
  canUpload,
  isUploading,
  onFile,
  onUpload,
}: {
  accept: string;
  ariaLabel: string;
  canUpload: boolean;
  isUploading: boolean;
  onFile: (file: File | null) => void;
  onUpload: () => void;
}) {
  return (
    <div className="imp-upload-row">
      <input
        type="file"
        accept={accept}
        aria-label={ariaLabel}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onFile(event.target.files?.[0] ?? null)
        }
      />
      <button
        type="button"
        className="btn-form-submit"
        disabled={!canUpload || isUploading}
        onClick={onUpload}
      >
        {isUploading ? "Uploading…" : "Upload"}
      </button>
    </div>
  );
}

export function ImportReviewActions({
  isCancelling,
  isChecking,
  isCommitting,
  commitDisabled,
  commitLabel,
  onCancel,
  onRecheck,
  onCommit,
}: {
  isCancelling: boolean;
  isChecking: boolean;
  isCommitting: boolean;
  commitDisabled: boolean;
  commitLabel: ReactNode;
  onCancel: () => void;
  onRecheck: () => void;
  onCommit: () => void;
}) {
  return (
    <div className="imp-actions">
      <button type="button" className="btn-secondary" disabled={isCancelling} onClick={onCancel}>
        {isCancelling ? "Cancelling…" : "Cancel import"}
      </button>
      <button type="button" className="btn-secondary" disabled={isChecking} onClick={onRecheck}>
        {isChecking ? "Re-checking…" : "Re-check"}
      </button>
      <button
        type="button"
        className="btn-form-submit"
        disabled={commitDisabled || isCommitting}
        onClick={onCommit}
      >
        {isCommitting ? "Creating…" : commitLabel}
      </button>
    </div>
  );
}
