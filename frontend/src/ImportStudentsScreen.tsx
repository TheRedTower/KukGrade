import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  errorMessage,
  type CreateDataImportBatchResponse,
  type DataImportBatch,
  type StudentImportPreview,
  type StudentImportRowCorrection,
  type StudentImportRowResult,
  cancelDataImportBatch,
  commitStudentImport,
  createDataImportBatch,
  previewStudentImport,
} from "./api";
import { ImportReviewActions, ImportUploadRow } from "./ImportWizardParts";
import "./StudentScreens.css";
import "./ImportStudents.css";

type Step = "upload" | "map" | "preview" | "result";

// Mirrors data_imports/mappings.py's STANDARD_STUDENT_HEADERS - the backend
// is the source of truth; this is only the client-side template download.
const STANDARD_TEMPLATE_HEADERS = [
  "WKSA ID",
  "First Name",
  "Last Name",
  "Date of Birth",
  "Current Rank",
  "Status",
];

const TARGET_FIELDS: { field: string; label: string; required: boolean }[] = [
  { field: "wksa_id", label: "WKSA ID", required: true },
  { field: "first_name", label: "First name", required: true },
  { field: "last_name", label: "Last name", required: true },
  { field: "date_of_birth", label: "Date of birth (YYYY-MM-DD or DD/MM/YYYY)", required: true },
  { field: "current_rank", label: "Current rank", required: true },
  { field: "status", label: "Status (defaults to Active)", required: false },
];

const CORRECTION_FIELDS: { field: keyof StudentImportRowCorrection; label: string }[] = [
  { field: "wksa_id", label: "WKSA ID" },
  { field: "first_name", label: "First name" },
  { field: "last_name", label: "Last name" },
  { field: "date_of_birth", label: "Date of birth" },
  { field: "current_rank", label: "Current rank" },
  { field: "status", label: "Status" },
];

function downloadStandardTemplate() {
  const csv = `${STANDARD_TEMPLATE_HEADERS.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kukgrade-student-roster-template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ImportStudentsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<CreateDataImportBatchResponse | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<StudentImportPreview | null>(null);
  const [corrections, setCorrections] = useState<Record<string, StudentImportRowCorrection>>({});
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [commitResult, setCommitResult] = useState<DataImportBatch | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewRows = useMemo(
    () => preview?.rows.filter((row) => row.outcome === "REVIEW_REQUIRED") ?? [],
    [preview],
  );

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setBatch(null);
    setColumnMapping({});
    setPreview(null);
    setCorrections({});
    setExpandedRow(null);
    setCommitResult(null);
    setError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setError(null);
    setIsUploading(true);
    try {
      const result = await createDataImportBatch(file, "STUDENT_ROSTER");
      setBatch(result);
      setColumnMapping(result.suggested_mapping);
      setStep("map");
    } catch (err) {
      setError(errorMessage(err, "Could not upload that file. Check the format and try again."));
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePreview() {
    if (!batch) return;
    setError(null);
    setIsChecking(true);
    try {
      const result = await previewStudentImport(batch.id, {
        column_mapping: columnMapping,
        corrections,
      });
      setPreview(result);
      setStep("preview");
    } catch (err) {
      setError(errorMessage(err, "Could not check that mapping. Every required field needs a column."));
    } finally {
      setIsChecking(false);
    }
  }

  async function handleRecheck() {
    if (!batch) return;
    setError(null);
    setIsChecking(true);
    try {
      const result = await previewStudentImport(batch.id, {
        column_mapping: columnMapping,
        corrections,
      });
      setPreview(result);
    } catch (err) {
      setError(errorMessage(err, "Could not re-check the file."));
    } finally {
      setIsChecking(false);
    }
  }

  async function handleCommit() {
    if (!batch) return;
    setError(null);
    setIsCommitting(true);
    try {
      const result = await commitStudentImport(batch.id, {
        column_mapping: columnMapping,
        corrections,
      });
      setCommitResult(result);
      await queryClient.invalidateQueries({ queryKey: ["students", "list"] });
      setStep("result");
    } catch (err) {
      setError(errorMessage(err, "Could not commit this import."));
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleCancel() {
    if (!batch) {
      resetToUpload();
      return;
    }
    setIsCancelling(true);
    try {
      await cancelDataImportBatch(batch.id);
    } catch {
      // The batch may already be gone (e.g. expired) - either way, the
      // admin's intent was to abandon it, so proceed to reset regardless.
    } finally {
      setIsCancelling(false);
      resetToUpload();
    }
  }

  function updateCorrection(
    rowNumber: number,
    field: keyof StudentImportRowCorrection,
    value: string,
  ) {
    setCorrections((prev) => ({
      ...prev,
      [String(rowNumber)]: { ...prev[String(rowNumber)], [field]: value },
    }));
  }

  function correctionValue(
    row: StudentImportRowResult,
    field: keyof StudentImportRowCorrection,
  ): string {
    const existing = corrections[String(row.row_number)]?.[field];
    if (existing !== undefined) return existing;
    switch (field) {
      case "wksa_id":
        return row.wksa_id;
      case "first_name":
        return row.first_name;
      case "last_name":
        return row.last_name;
      case "date_of_birth":
        return row.date_of_birth_display;
      case "current_rank":
        return row.current_rank_text;
      case "status":
        return row.status;
      default:
        return "";
    }
  }

  const mappingIsComplete = TARGET_FIELDS.filter((f) => f.required).every(
    (f) => (columnMapping[f.field] ?? "").length > 0,
  );

  return (
    <section aria-labelledby="import-students-title" className="add-student-view">
      <nav aria-label="Breadcrumb navigation" className="form-breadcrumbs">
        <button type="button" className="breadcrumb-link-btn" onClick={() => navigate("/students")}>
          Students
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-current" aria-current="page">
          Import students
        </span>
      </nav>

      <div className="add-student-header">
        <h1 id="import-students-title" className="add-student-heading">
          Import students
        </h1>
        <p className="add-student-subtitle">
          Bulk-create student records from a spreadsheet. An existing WKSA ID is always
          skipped, never overwritten.
        </p>
      </div>

      {error && (
        <div role="alert" className="form-alert-banner">
          <p>{error}</p>
        </div>
      )}

      <ol className="imp-steps" aria-label="Import steps">
        {(["upload", "map", "preview", "result"] as Step[]).map((s, index) => (
          <li key={s} className={`imp-step ${step === s ? "imp-step-active" : ""}`}>
            {index + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map columns" : s === "preview" ? "Review" : "Done"}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <div className="form-section-card">
          <h2 className="form-section-title">1. Upload a file</h2>
          <p className="imp-help-text">
            Accepts .xlsx or .csv, up to 5 MiB. Use the standard template below, or map your
            own column headers in the next step.
          </p>
          <button type="button" className="btn-secondary imp-template-link" onClick={downloadStandardTemplate}>
            Download standard template
          </button>
          <ImportUploadRow
            accept=".xlsx,.csv"
            ariaLabel="Student roster file"
            canUpload={file !== null}
            isUploading={isUploading}
            onFile={setFile}
            onUpload={() => void handleUpload()}
          />
        </div>
      )}

      {step === "map" && batch && (
        <div className="form-section-card">
          <h2 className="form-section-title">2. Map columns</h2>
          {batch.already_imported_warning && (
            <p className="imp-warning-text" role="alert">
              A file with identical content has already been imported. Continuing is safe -
              existing WKSA IDs are always skipped, never duplicated.
            </p>
          )}
          <p className="imp-help-text">
            Detected columns: {batch.detected_headers.join(", ")}
          </p>
          <table className="imp-mapping-table">
            <thead>
              <tr>
                <th scope="col">KukGrade field</th>
                <th scope="col">Source column</th>
              </tr>
            </thead>
            <tbody>
              {TARGET_FIELDS.map(({ field, label, required }) => (
                <tr key={field}>
                  <th scope="row">
                    {label}
                    {required ? " *" : ""}
                  </th>
                  <td>
                    <select
                      aria-label={`Source column for ${label}`}
                      value={columnMapping[field] ?? ""}
                      onChange={(event) =>
                        setColumnMapping((prev) => ({ ...prev, [field]: event.target.value }))
                      }
                    >
                      <option value="">— not mapped —</option>
                      {batch.detected_headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="imp-actions">
            <button type="button" className="btn-secondary" disabled={isCancelling} onClick={() => void handleCancel()}>
              {isCancelling ? "Cancelling…" : "Cancel import"}
            </button>
            <button
              type="button"
              className="btn-form-submit"
              disabled={!mappingIsComplete || isChecking}
              onClick={() => void handlePreview()}
            >
              {isChecking ? "Checking…" : "Check file"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && batch && (
        <div className="form-section-card">
          <h2 className="form-section-title">3. Review</h2>
          <ul className="imp-summary">
            <li>{preview.total} row(s) found</li>
            <li>{preview.ready} ready to create</li>
            <li>{preview.review_required} need review</li>
            <li>{preview.skip_existing} existing WKSA ID(s) - will be skipped</li>
          </ul>

          {reviewRows.length > 0 && (
            <table className="imp-review-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Name</th>
                  <th scope="col">Issues</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((row) => (
                  <Fragment key={row.row_number}>
                    <tr>
                      <td>{row.row_number}</td>
                      <td>
                        {row.first_name} {row.last_name}
                      </td>
                      <td>
                        <ul className="imp-issue-list">
                          {row.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            setExpandedRow(expandedRow === row.row_number ? null : row.row_number)
                          }
                        >
                          {expandedRow === row.row_number ? "Close" : "Fix"}
                        </button>
                      </td>
                    </tr>
                    {expandedRow === row.row_number && (
                      <tr key={`${row.row_number}-edit`}>
                        <td colSpan={4}>
                          <div className="imp-correction-form">
                            {CORRECTION_FIELDS.map(({ field, label }) => (
                              <label key={field} className="imp-correction-field">
                                {label}
                                <input
                                  type="text"
                                  value={correctionValue(row, field)}
                                  onChange={(event) =>
                                    updateCorrection(row.row_number, field, event.target.value)
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          <ImportReviewActions
            isCancelling={isCancelling}
            isChecking={isChecking}
            isCommitting={isCommitting}
            commitDisabled={preview.ready === 0}
            commitLabel={`Create ${preview.ready} student${preview.ready === 1 ? "" : "s"}`}
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
            {String(commitResult.summary_json.created ?? 0)} student(s) created.{" "}
            {String(commitResult.summary_json.skipped_existing ?? 0)} existing WKSA ID(s)
            skipped. {String(commitResult.summary_json.review_required ?? 0)} row(s) left
            unresolved.
          </p>
          <div className="imp-actions">
            <button type="button" className="btn-secondary" onClick={resetToUpload}>
              Import another file
            </button>
            <button type="button" className="btn-form-submit" onClick={() => navigate("/students")}>
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
