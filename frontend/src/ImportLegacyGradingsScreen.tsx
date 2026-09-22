import { useMemo, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type DataImportBatch,
  type LegacyImportPreview,
  type Rank,
  cancelDataImportBatch,
  commitLegacyGradingImport,
  createDataImportBatch,
  getRanks,
  previewLegacyGradingImport,
} from "./api";
import "./StudentScreens.css";
import "./ImportStudents.css";

type Step = "upload" | "review" | "result";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.nonFieldMessages[0] || err.message || fallback;
  }
  return fallback;
}

export function ImportLegacyGradingsScreen() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [rankMappings, setRankMappings] = useState<Record<string, string | null>>({});
  const [commitResult, setCommitResult] = useState<DataImportBatch | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranksQuery = useQuery({
    queryKey: ["ranksList"],
    queryFn: () => getRanks({ page_size: 100 }),
  });
  const ranks = useMemo<Rank[]>(
    () => (Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : []),
    [ranksQuery.data],
  );

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setBatchId(null);
    setPreview(null);
    setRankMappings({});
    setCommitResult(null);
    setError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setError(null);
    setIsUploading(true);
    try {
      const created = await createDataImportBatch(file, "LEGACY_GRADINGS");
      setBatchId(created.id);
      const initialPreview = await previewLegacyGradingImport(created.id, {
        rank_mappings: {},
      });
      setPreview(initialPreview);
      const initialMappings: Record<string, string | null> = {};
      for (const suggestion of initialPreview.rank_suggestions) {
        if (suggestion.suggested_rank_code) {
          initialMappings[suggestion.source_text] = suggestion.suggested_rank_code;
        }
      }
      setRankMappings(initialMappings);
      setStep("review");
    } catch (err) {
      setError(
        errorMessage(err, "Could not upload that workbook. Check the format and try again."),
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRecheck() {
    if (!batchId) return;
    setError(null);
    setIsChecking(true);
    try {
      const result = await previewLegacyGradingImport(batchId, {
        rank_mappings: rankMappings,
      });
      setPreview(result);
    } catch (err) {
      setError(errorMessage(err, "Could not re-check the workbook."));
    } finally {
      setIsChecking(false);
    }
  }

  async function handleCommit() {
    if (!batchId) return;
    setError(null);
    setIsCommitting(true);
    try {
      const result = await commitLegacyGradingImport(batchId, {
        rank_mappings: rankMappings,
      });
      setCommitResult(result);
      setStep("result");
    } catch (err) {
      setError(errorMessage(err, "Could not commit this import."));
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleCancel() {
    if (!batchId) {
      resetToUpload();
      return;
    }
    setIsCancelling(true);
    try {
      await cancelDataImportBatch(batchId);
    } catch {
      // Intent was to abandon it either way.
    } finally {
      setIsCancelling(false);
      resetToUpload();
    }
  }

  function updateMapping(sourceText: string, rankCode: string) {
    setRankMappings((prev) => ({
      ...prev,
      [sourceText]: rankCode === "" ? null : rankCode,
    }));
  }

  return (
    <section aria-labelledby="import-legacy-title" className="add-student-view">
      <nav aria-label="Breadcrumb navigation" className="form-breadcrumbs">
        <button type="button" className="breadcrumb-link-btn" onClick={() => navigate("/gradings")}>
          Gradings
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-current" aria-current="page">
          Import historical gradings
        </span>
      </nav>

      <div className="add-student-header">
        <h1 id="import-legacy-title" className="add-student-heading">
          Import historical gradings
        </h1>
        <p className="add-student-subtitle">
          Upload the historical grading workbook (.xlsx). This creates historical records
          only - it never creates a promotion, changes a student&apos;s current rank, or
          links a name to a student automatically.
        </p>
      </div>

      {error && (
        <div role="alert" className="form-alert-banner">
          <p>{error}</p>
        </div>
      )}

      <ol className="imp-steps" aria-label="Import steps">
        {(["upload", "review", "result"] as Step[]).map((s, index) => (
          <li key={s} className={`imp-step ${step === s ? "imp-step-active" : ""}`}>
            {index + 1}. {s === "upload" ? "Upload" : s === "review" ? "Review ranks" : "Done"}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <div className="form-section-card">
          <h2 className="form-section-title">1. Upload a workbook</h2>
          <p className="imp-help-text">Accepts .xlsx only, up to 5 MiB.</p>
          <div className="imp-upload-row">
            <input
              type="file"
              accept=".xlsx"
              aria-label="Historical grading workbook file"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFile(event.target.files?.[0] ?? null)
              }
            />
            <button
              type="button"
              className="btn-form-submit"
              disabled={!file || isUploading}
              onClick={() => void handleUpload()}
            >
              {isUploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && preview && (
        <div className="form-section-card">
          <h2 className="form-section-title">2. Review</h2>
          <ul className="imp-summary">
            <li>{preview.total} row(s) found</li>
            <li>{preview.grading_result} grading result(s)</li>
            <li>{preview.did_not_attend} did not attend</li>
            <li>{preview.auxiliary_note} auxiliary note(s)</li>
            <li>{preview.unresolved_current_rank} unresolved current rank</li>
            <li>{preview.unresolved_testing_for_rank} unresolved testing-for rank</li>
            <li>{preview.unresolved_outcome} unresolved outcome</li>
          </ul>

          {preview.warnings.length > 0 && (
            <ul className="imp-issue-list">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <p className="imp-help-text">
            Every rank value below is a suggestion only - nothing is applied until you pick
            it and commit. Leaving a rank unresolved never blocks its record; it can be
            resolved later from the historical records screen.
          </p>

          {preview.rank_suggestions.length > 0 && (
            <table className="imp-mapping-table">
              <thead>
                <tr>
                  <th scope="col">Source text</th>
                  <th scope="col">Rank</th>
                </tr>
              </thead>
              <tbody>
                {preview.rank_suggestions.map((suggestion) => (
                  <tr key={suggestion.source_text}>
                    <th scope="row">{suggestion.source_text}</th>
                    <td>
                      <select
                        aria-label={`Rank for ${suggestion.source_text}`}
                        value={rankMappings[suggestion.source_text] ?? ""}
                        onChange={(event) =>
                          updateMapping(suggestion.source_text, event.target.value)
                        }
                      >
                        <option value="">— leave unresolved —</option>
                        {ranks.map((rank) => (
                          <option key={rank.code} value={rank.code}>
                            {rank.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="imp-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={isCancelling}
              onClick={() => void handleCancel()}
            >
              {isCancelling ? "Cancelling…" : "Cancel import"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isChecking}
              onClick={() => void handleRecheck()}
            >
              {isChecking ? "Re-checking…" : "Re-check"}
            </button>
            <button
              type="button"
              className="btn-form-submit"
              disabled={isCommitting}
              onClick={() => void handleCommit()}
            >
              {isCommitting ? "Creating…" : `Create ${preview.total} historical record(s)`}
            </button>
          </div>
        </div>
      )}

      {step === "result" && commitResult && (
        <div className="form-section-card">
          <h2 className="form-section-title">Import complete</h2>
          <p className="imp-help-text">
            {String(commitResult.summary_json.total ?? 0)} historical record(s) created
            ({String(commitResult.summary_json.grading_result ?? 0)} grading results,{" "}
            {String(commitResult.summary_json.did_not_attend ?? 0)} did not attend,{" "}
            {String(commitResult.summary_json.auxiliary_note ?? 0)} auxiliary notes).{" "}
            {String(commitResult.summary_json.unresolved_current_rank ?? 0)} current rank(s)
            and {String(commitResult.summary_json.unresolved_testing_for_rank ?? 0)}{" "}
            testing-for rank(s) remain unresolved - use the historical records screen to
            resolve or link them to students.
          </p>
          <div className="imp-actions">
            <button type="button" className="btn-secondary" onClick={resetToUpload}>
              Import another workbook
            </button>
            <button
              type="button"
              className="btn-form-submit"
              onClick={() => navigate("/gradings/legacy-records")}
            >
              Go to historical records
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
