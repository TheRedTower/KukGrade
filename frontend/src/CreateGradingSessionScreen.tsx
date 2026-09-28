import { type FormEvent, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type FieldErrors,
  createGradingSession,
} from "./api";
import "./GradingSessions.css";
import { formatSessionDate } from "./dates";

const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

function generateYears(): string[] {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = currentYear - 1; y <= currentYear + 5; y++) {
    years.push(String(y));
  }
  return years;
}

function formatPreviewDate(year: string, month: string, day: string): string {
  if (!year || !month || !day) return "—";
  const y = parseInt(year, 10);
  const m = parseInt(month, 10) - 1;
  const d = parseInt(day, 10);
  const dateObj = new Date(y, m, d);
  if (isNaN(dateObj.getTime()) || dateObj.getDate() !== d || dateObj.getMonth() !== m) {
    return "Invalid date";
  }
  return formatSessionDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

export function CreateGradingSessionScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Form State
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  // Submission & Validation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const years = useMemo(() => generateYears(), []);

  // Compute days in chosen month/year
  const daysCount = useMemo(() => {
    if (!month) return 31;
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const m = parseInt(month, 10);
    return new Date(y, m, 0).getDate();
  }, [year, month]);

  const daysList = useMemo(() => {
    return Array.from({ length: daysCount }, (_, i) => String(i + 1));
  }, [daysCount]);

  const previewFormattedDate = useMemo(() => {
    return formatPreviewDate(year, month, day);
  }, [year, month, day]);

  function getFieldError(fieldName: string): string | null {
    const err = fieldErrors[fieldName];
    if (Array.isArray(err) && err.length > 0) {
      return typeof err[0] === "string" ? err[0] : null;
    }
    if (typeof err === "string") {
      return err;
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const errors: Record<string, string[]> = {};

    if (!title.trim()) {
      errors.title = ["Session title is required."];
    }

    if (!day || !month || !year) {
      errors.grading_date = ["Grading date is required."];
    } else {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10) - 1;
      const d = parseInt(day, 10);
      const dateObj = new Date(y, m, d);
      if (isNaN(dateObj.getTime()) || dateObj.getDate() !== d || dateObj.getMonth() !== m) {
        errors.grading_date = ["Please provide a valid calendar date."];
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const formattedIsoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    setIsSubmitting(true);
    try {
      await createGradingSession({
        title: title.trim(),
        grading_date: formattedIsoDate,
        location: location.trim(),
        notes: notes.trim(),
      });

      // Invalidate grading session lists
      await queryClient.invalidateQueries({ queryKey: ["gradingSessions"] });

      // Navigate back to gradings list
      navigate("/gradings");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields && Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields);
        } else {
          setGeneralError(err.message || "Failed to create grading session. Please check the form.");
        }
      } else {
        setGeneralError("A network error occurred. Please check your connection.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="create-session-heading" className="cgs-page">
      {/* ── Breadcrumbs */}
      <nav aria-label="Breadcrumb navigation" className="cgs-breadcrumbs">
        <button
          className="cgs-breadcrumb-link"
          id="cgs-breadcrumb-gradings"
          onClick={() => navigate("/gradings")}
          type="button"
        >
          Gradings
        </button>
        <span aria-hidden="true" className="cgs-breadcrumb-sep">/</span>
        <span aria-current="page" className="cgs-breadcrumb-current">New session</span>
      </nav>

      {/* ── Page Header */}
      <div className="cgs-page-header">
        <h1 className="cgs-page-title" id="create-session-heading">Create grading session</h1>
        <p className="cgs-page-subtitle">Set the details, then add candidates.</p>
      </div>

      {/* ── General Error Banner */}
      {generalError && (
        <div className="cgs-alert-banner" role="alert">
          <p>{generalError}</p>
        </div>
      )}

      {/* ── Two-Column Layout */}
      <div className="cgs-grid">
        {/* Left Column: Form */}
        <div className="cgs-form-column">
          <form className="cgs-form" noValidate onSubmit={handleSubmit}>
            {/* Session Title */}
            <div className="cgs-field-group">
              <label className="cgs-label" htmlFor="cgs-title-input">
                Session title <span className="cgs-required-star">*</span>
              </label>
              <input
                aria-invalid={!!getFieldError("title")}
                aria-required="true"
                className={`cgs-text-input ${getFieldError("title") ? "cgs-input-error" : ""}`}
                disabled={isSubmitting}
                id="cgs-title-input"
                name="title"
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Winter Grading"
                type="text"
                value={title}
              />
              {getFieldError("title") && (
                <p className="cgs-field-error" role="alert">{getFieldError("title")}</p>
              )}
            </div>

            {/* Grading Date (Day / Month / Year) */}
            <div className="cgs-field-group">
              <label className="cgs-label" htmlFor="cgs-day-select">
                Grading date <span className="cgs-required-star">*</span>
              </label>
              <div className="cgs-date-row">
                <select
                  aria-label="Grading day"
                  className={`cgs-select cgs-date-day ${getFieldError("grading_date") ? "cgs-input-error" : ""}`}
                  disabled={isSubmitting}
                  id="cgs-day-select"
                  onChange={(e) => setDay(e.target.value)}
                  value={day}
                >
                  <option value="">Day</option>
                  {daysList.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                <select
                  aria-label="Grading month"
                  className={`cgs-select cgs-date-month ${getFieldError("grading_date") ? "cgs-input-error" : ""}`}
                  disabled={isSubmitting}
                  id="cgs-month-select"
                  onChange={(e) => setMonth(e.target.value)}
                  value={month}
                >
                  <option value="">Month</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>

                <select
                  aria-label="Grading year"
                  className={`cgs-select cgs-date-year ${getFieldError("grading_date") ? "cgs-input-error" : ""}`}
                  disabled={isSubmitting}
                  id="cgs-year-select"
                  onChange={(e) => setYear(e.target.value)}
                  value={year}
                >
                  <option value="">Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {getFieldError("grading_date") && (
                <p className="cgs-field-error" role="alert">{getFieldError("grading_date")}</p>
              )}
            </div>

            {/* Location */}
            <div className="cgs-field-group">
              <label className="cgs-label" htmlFor="cgs-location-input">
                Location <span className="cgs-optional-text">(optional)</span>
              </label>
              <input
                className="cgs-text-input"
                disabled={isSubmitting}
                id="cgs-location-input"
                name="location"
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Colchester Dojang"
                type="text"
                value={location}
              />
              {getFieldError("location") && (
                <p className="cgs-field-error" role="alert">{getFieldError("location")}</p>
              )}
            </div>

            {/* Staff Notes */}
            <div className="cgs-field-group">
              <div className="cgs-label-wrap">
                <label className="cgs-label" htmlFor="cgs-notes-input">
                  Staff notes <span className="cgs-optional-text">(optional)</span>
                </label>
              </div>
              <textarea
                className="cgs-textarea"
                disabled={isSubmitting}
                id="cgs-notes-input"
                maxLength={500}
                name="notes"
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes for grading staff"
                rows={4}
                value={notes}
              />
              <div className="cgs-char-counter">
                <span className={notes.length >= 480 ? "cgs-char-near-limit" : ""}>
                  {notes.length}/500
                </span>
              </div>
              {getFieldError("notes") && (
                <p className="cgs-field-error" role="alert">{getFieldError("notes")}</p>
              )}
            </div>

            {/* Form Actions */}
            <div className="cgs-form-actions">
              <button
                className="btn-ghost cgs-cancel-btn"
                disabled={isSubmitting}
                id="cgs-cancel-btn"
                onClick={() => navigate("/gradings")}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn-primary gs-create-btn"
                disabled={isSubmitting}
                id="cgs-submit-btn"
                type="submit"
              >
                {isSubmitting ? "Creating…" : "Create draft session"}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Session Preview */}
        <div className="cgs-preview-column">
          <div className="cgs-preview-card">
            <h2 className="cgs-preview-title" id="cgs-preview-heading">Session preview</h2>
            <p className="cgs-preview-subtitle">
              This is how the session will appear in the gradings list after creation.
            </p>

            <div className="cgs-preview-table-wrap">
              <table aria-label="Session preview" className="cgs-preview-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Session title</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                    <th className="cgs-preview-th-num" scope="col">Candidates</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="cgs-preview-date-cell">
                      {previewFormattedDate}
                    </td>
                    <td className="cgs-preview-title-cell">
                      {title.trim() || <span className="cgs-preview-placeholder">Session title</span>}
                    </td>
                    <td className="cgs-preview-location-cell">
                      {location.trim() || "—"}
                    </td>
                    <td>
                      <span className="gs-status-badge gs-status-draft">Draft</span>
                    </td>
                    <td className="cgs-preview-candidates-cell">0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
