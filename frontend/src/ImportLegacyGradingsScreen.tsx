import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  errorMessage,
  type DataImportBatch,
  type LegacyImportPreview,
  type Rank,
  cancelDataImportBatch,
  commitLegacyGradingImport,
  createDataImportBatch,
  previewLegacyGradingImport,
} from "./api";
import { useRanksQuery } from "./queries";
import { ImportReviewActions, ImportUploadRow } from "./ImportWizardParts";
import "./StudentScreens.css";
import "./ImportStudents.css";

type Step = "upload" | "review" | "result";

export function ImportLegacyGradingsScreen() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [rankMappings, setRankMappings] = useState<Record<string, string | null>>({});
  const [commitResult, setCommitResult] = useState<DataImportBatch | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranksQuery = useRanksQuery();
  const ranks = useMemo<Rank[]>(
    () => (Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : []),
    [ranksQuery.data],
  );

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setBatchId(null);
    setAlreadyImported(false);
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
      setAlreadyImported(created.already_imported_warning);
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
      setError(errorMessage(err, "Could not finish this import."));
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
          <p className="imp-help-text">Excel workbooks (.xlsx) only, up to 5 MB.</p>
          <ImportUploadRow
            accept=".xlsx"
            ariaLabel="Historical grading workbook file"
            canUpload={file !== null}
            isUploading={isUploading}
            onFile={setFile}
            onUpload={() => void handleUpload()}
          />
        </div>
      )}

      {step === "review" && preview && (
        <div className="form-section-card">
          <h2 className="form-section-title">2. Review</h2>
          {alreadyImported && (
            <p className="imp-warning-text" role="alert">
              A workbook with identical content has already been imported. Importing it
              again creates a second copy of every record, and historical records can
              only be voided, never deleted.
            </p>
          )}
          <ul className="imp-summary">
            <li>{preview.total} row(s) found</li>
            <li>{preview.grading_result} grading result(s)</li>
            <li>{preview.did_not_attend} did not attend</li>
            <li>{preview.auxiliary_note} other note(s)</li>
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
            Every rank value below is a suggestion only - nothing is applied until you pick it and import. Leaving a rank unresolved never blocks its record; it can be
            resolved later from the historical records screen.
          </p>

          {preview.rank_suggestions.length > 0 && (
            <table className="imp-mapping-table">
              <thead>
                <tr>
                  <th scope="col">As written</th>
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

          <ImportReviewActions
            isCancelling={isCancelling}
            isChecking={isChecking}
            isCommitting={isCommitting}
            commitDisabled={false}
            commitLabel={`Create ${preview.total} historical record(s)`}
            onCancel={() => void handleCancel()}
            onRecheck={() => void handleRecheck()}
            onCommit={() => void handleCommit()}
          />
        </div>
      )}

      {step === "result" && commitResult && (
        <div className="form-section-card">
          <h2 className="form-section-title">Import complete</h2>
          <p className="imp-help-text">
            {String(commitResult.summary_json.total ?? 0)} historical record(s) created
            ({String(commitResult.summary_json.grading_result ?? 0)} grading results,{" "}
            {String(commitResult.summary_json.did_not_attend ?? 0)} did not attend,{" "}
            {String(commitResult.summary_json.auxiliary_note ?? 0)} other notes).{" "}
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
