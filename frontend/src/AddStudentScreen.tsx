import { FormEvent, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type FieldErrors,
  type Rank,
  type StudentStatus,
  createStudent,
} from "./api";
import { useRanksQuery } from "./queries";
import "./StudentScreens.css";
import { todayIsoDate } from "./dates";
import { LockIcon } from "./Icons";

export function AddStudentScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Form State
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [wksaId, setWksaId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [status, setStatus] = useState<StudentStatus>("ACTIVE");

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // 1. Fetch active ranks
  const ranksQuery = useRanksQuery();

  const ranks = useMemo<Rank[]>(() => {
    return Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : [];
  }, [ranksQuery.data]);

  // Set initial rank once ranks load if not yet selected
  const effectiveRankId = useMemo(() => {
    if (currentRank !== null) return currentRank;
    if (ranks.length > 0) {
      // Find White belt (order 1 or code W) or default to first
      const defaultRank = ranks.find((r) => r.code === "W" || r.order === 1) || ranks[0];
      return defaultRank.id;
    }
    return null;
  }, [currentRank, ranks]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // Client-side validations
    const errors: Record<string, string[]> = {};
    if (!firstName.trim()) {
      errors.first_name = ["First name is required."];
    }
    if (!lastName.trim()) {
      errors.last_name = ["Last name is required."];
    }
    if (!wksaId.trim()) {
      errors.wksa_id = ["WKSA ID is required."];
    }
    if (!dateOfBirth) {
      errors.date_of_birth = ["Date of birth is required."];
    }
    if (!effectiveRankId) {
      errors.current_rank = ["Current rank is required."];
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const newStudent = await createStudent({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        wksa_id: wksaId.trim().toUpperCase(),
        date_of_birth: dateOfBirth,
        current_rank: effectiveRankId!,
        status,
      });

      // Invalidate student lists
      await queryClient.invalidateQueries({ queryKey: ["students", "list"] });

      // Navigate to student detail view
      navigate(`/students/${newStudent.id}`);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields && Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields);
        } else {
          setGeneralError(err.message || "Failed to create student. Please check the form.");
        }
      } else {
        setGeneralError("A network error occurred. Please check your connection.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

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

  return (
    <section aria-labelledby="add-student-title" className="add-student-view">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb navigation" className="form-breadcrumbs">
        <button
          type="button"
          className="breadcrumb-link-btn"
          onClick={() => navigate("/students")}
        >
          Students
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-current" aria-current="page">
          Add student
        </span>
      </nav>

      {/* Header */}
      <div className="add-student-header">
        <h1 id="add-student-title" className="add-student-heading">
          Add student
        </h1>
        <p className="add-student-subtitle">Create a staff-only student record</p>
      </div>

      {generalError && (
        <div role="alert" className="form-alert-banner">
          <p>{generalError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="add-student-form-body">
        {/* Card 1: Identity */}
        <div className="form-section-card">
          <h2 className="form-section-title">Identity</h2>

          <div className="form-row-grid-2">
            <div className="form-field-group">
              <label htmlFor="first-name-input" className="form-field-label">
                First name <span className="required-star">*</span>
              </label>
              <input
                id="first-name-input"
                type="text"
                className={`form-text-input ${getFieldError("first_name") ? "input-error" : ""}`}
                placeholder="e.g. Alex"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!getFieldError("first_name")}
                aria-describedby={getFieldError("first_name") ? "first-name-error" : undefined}
              />
              {getFieldError("first_name") && (
                <p className="form-field-error" id="first-name-error" role="alert">{getFieldError("first_name")}</p>
              )}
            </div>

            <div className="form-field-group">
              <label htmlFor="last-name-input" className="form-field-label">
                Last name <span className="required-star">*</span>
              </label>
              <input
                id="last-name-input"
                type="text"
                className={`form-text-input ${getFieldError("last_name") ? "input-error" : ""}`}
                placeholder="e.g. Carter"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!getFieldError("last_name")}
                aria-describedby={getFieldError("last_name") ? "last-name-error" : undefined}
              />
              {getFieldError("last_name") && (
                <p className="form-field-error" id="last-name-error" role="alert">{getFieldError("last_name")}</p>
              )}
            </div>
          </div>

          <div className="form-field-group">
            <label htmlFor="wksa-id-input" className="form-field-label">
              WKSA ID <span className="required-star">*</span>
            </label>
            <input
              id="wksa-id-input"
              type="text"
              className={`form-text-input ${getFieldError("wksa_id") ? "input-error" : ""}`}
              placeholder="e.g. KG-0264 or UK12345"
              value={wksaId}
              onChange={(e) => setWksaId(e.target.value)}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!getFieldError("wksa_id")}
              aria-describedby={getFieldError("wksa_id") ? "wksa-id-error" : undefined}
            />
            {getFieldError("wksa_id") ? (
              <p className="form-field-error" id="wksa-id-error" role="alert">{getFieldError("wksa_id")}</p>
            ) : (
              <p className="form-field-help">
                This identifier cannot be changed after the record is created.
              </p>
            )}
          </div>
        </div>

        {/* Card 2: Grading details */}
        <div className="form-section-card">
          <h2 className="form-section-title">Grading details</h2>

          <div className="form-row-grid-3">
            <div className="form-field-group">
              <label htmlFor="dob-input" className="form-field-label">
                Date of birth <span className="required-star">*</span>
              </label>
              <input
                id="dob-input"
                type="date"
                className={`form-text-input ${getFieldError("date_of_birth") ? "input-error" : ""}`}
                value={dateOfBirth}
                max={todayIsoDate()}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!getFieldError("date_of_birth")}
                aria-describedby={getFieldError("date_of_birth") ? "dob-error" : undefined}
              />
              {getFieldError("date_of_birth") ? (
                <p className="form-field-error" id="dob-error" role="alert">{getFieldError("date_of_birth")}</p>
              ) : (
                <div className="privacy-badge-line">
                  <LockIcon size={14} className="privacy-icon" />
                  <span>Date of birth is visible only on the individual student record.</span>
                </div>
              )}
            </div>

            <div className="form-field-group">
              <label htmlFor="rank-select-input" className="form-field-label">
                Current rank <span className="required-star">*</span>
              </label>
              <select
                id="rank-select-input"
                className={`form-select-input ${getFieldError("current_rank") ? "input-error" : ""}`}
                value={effectiveRankId ?? ""}
                onChange={(e) => setCurrentRank(Number(e.target.value))}
                disabled={isSubmitting || ranksQuery.isLoading}
                aria-required="true"
                aria-invalid={!!getFieldError("current_rank")}
                aria-describedby={getFieldError("current_rank") ? "current-rank-error" : undefined}
              >
                {ranks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {getFieldError("current_rank") && (
                <p className="form-field-error" id="current-rank-error" role="alert">{getFieldError("current_rank")}</p>
              )}
            </div>

            <div className="form-field-group">
              <label htmlFor="status-select-input" className="form-field-label">
                Status <span className="required-star">*</span>
              </label>
              <select
                id="status-select-input"
                className="form-select-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as StudentStatus)}
                disabled={isSubmitting}
                aria-required="true"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="LEFT">Left</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions Row */}
        <div className="form-actions-bar">
          <button
            type="button"
            className="btn-form-cancel"
            onClick={() => navigate("/students")}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-form-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create student"}
          </button>
        </div>
      </form>
    </section>
  );
}
