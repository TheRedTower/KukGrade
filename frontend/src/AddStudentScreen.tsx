import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  type Rank,
  type StudentStatus,
  createStudent,
} from "./api";
import { useServerForm } from "./forms";
import { useRanksQuery, useSiteSettingsQuery } from "./queries";
import "./StudentScreens.css";
import { todayIsoDate } from "./dates";
import { LockIcon } from "./Icons";
import { Button } from "./Button";

export function AddStudentScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The two forms a WKSA ID takes, as the server enforces and words them.
  const idScheme = useSiteSettingsQuery().data?.wksa_id;

  // Form State
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [wksaId, setWksaId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [status, setStatus] = useState<StudentStatus>("ACTIVE");

  // What the server and the browser's own checks say about the form.
  const form = useServerForm(["first_name", "last_name", "wksa_id", "date_of_birth", "current_rank"]);

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createStudent>[0]) => createStudent(payload),
    onSuccess: async (newStudent) => {
      await queryClient.invalidateQueries({ queryKey: ["students", "list"] });
      navigate(`/students/${newStudent.id}`);
    },
    onError: (err) => form.handle(err, "Failed to create student. Please check the form."),
  });
  const isSubmitting = createMutation.isPending;

  // 1. Fetch active ranks
  const ranksQuery = useRanksQuery();

  const ranks = useMemo<Rank[]>(() => {
    return Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : [];
  }, [ranksQuery.data]);

  // Set initial rank once ranks load if not yet selected
  const effectiveRankId = useMemo(() => {
    if (currentRank !== null) return currentRank;
    if (ranks.length > 0) {
      // White belt is the first rank in order; otherwise the first listed
      const defaultRank = ranks.find((r) => r.order === 1) || ranks[0];
      return defaultRank.id;
    }
    return null;
  }, [currentRank, ranks]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    form.reset();

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
      form.setClientErrors(errors);
      return;
    }

    createMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      // As typed: the server tidies spacing and case, and checks the form.
      wksa_id: wksaId,
      date_of_birth: dateOfBirth,
      current_rank: effectiveRankId!,
      status,
    });
  }

  return (
    <section aria-labelledby="add-student-title" className="page page--reading add-student-view">
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

      {form.banner && (
        <div role="alert" className="form-alert-banner">
          <p>{form.banner}</p>
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
                className={`form-text-input ${form.errorFor("first_name") ? "input-error" : ""}`}
                placeholder="e.g. Alex"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!form.errorFor("first_name")}
                aria-describedby={form.errorFor("first_name") ? "first-name-error" : undefined}
              />
              {form.errorFor("first_name") && (
                <p className="form-field-error" id="first-name-error" role="alert">{form.errorFor("first_name")}</p>
              )}
            </div>

            <div className="form-field-group">
              <label htmlFor="last-name-input" className="form-field-label">
                Last name <span className="required-star">*</span>
              </label>
              <input
                id="last-name-input"
                type="text"
                className={`form-text-input ${form.errorFor("last_name") ? "input-error" : ""}`}
                placeholder="e.g. Carter"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!form.errorFor("last_name")}
                aria-describedby={form.errorFor("last_name") ? "last-name-error" : undefined}
              />
              {form.errorFor("last_name") && (
                <p className="form-field-error" id="last-name-error" role="alert">{form.errorFor("last_name")}</p>
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
              className={`form-text-input ${form.errorFor("wksa_id") ? "input-error" : ""}`}
              placeholder={idScheme ? `e.g. ${idScheme.forms.map((form) => form.example).join(" or ")}` : undefined}
              value={wksaId}
              onChange={(e) => setWksaId(e.target.value)}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!form.errorFor("wksa_id")}
              aria-describedby={form.errorFor("wksa_id") ? "wksa-id-error" : undefined}
            />
            {form.errorFor("wksa_id") ? (
              <p className="form-field-error" id="wksa-id-error" role="alert">{form.errorFor("wksa_id")}</p>
            ) : (
              <p className="form-field-help">
                {idScheme ? `${idScheme.hint} ` : ""}
                A student ID changes only once, to the black belt ID handed out at the national grading.
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
                className={`form-text-input ${form.errorFor("date_of_birth") ? "input-error" : ""}`}
                value={dateOfBirth}
                max={todayIsoDate()}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!form.errorFor("date_of_birth")}
                aria-describedby={form.errorFor("date_of_birth") ? "dob-error" : undefined}
              />
              {form.errorFor("date_of_birth") ? (
                <p className="form-field-error" id="dob-error" role="alert">{form.errorFor("date_of_birth")}</p>
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
                className={`form-select-input ${form.errorFor("current_rank") ? "input-error" : ""}`}
                value={effectiveRankId ?? ""}
                onChange={(e) => setCurrentRank(Number(e.target.value))}
                disabled={isSubmitting || ranksQuery.isLoading}
                aria-required="true"
                aria-invalid={!!form.errorFor("current_rank")}
                aria-describedby={form.errorFor("current_rank") ? "current-rank-error" : undefined}
              >
                {ranks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {form.errorFor("current_rank") && (
                <p className="form-field-error" id="current-rank-error" role="alert">{form.errorFor("current_rank")}</p>
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
          <Button
            variant="secondary"
            onClick={() => navigate("/students")}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create student"}
          </Button>
        </div>
      </form>
    </section>
  );
}
