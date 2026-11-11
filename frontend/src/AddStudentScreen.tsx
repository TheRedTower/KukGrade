import { FormEvent, useMemo, useState } from "react";
import { useChoices } from "./choices";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { type Rank, type StudentStatus, createStudent } from "./api";
import { Field } from "./Field";
import { Alert } from "./Alert";
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
  const studentStatuses = useChoices().student_statuses;

  // What the server and the browser's own checks say about the form.
  const form = useServerForm(["first_name", "last_name", "wksa_id", "date_of_birth", "current_rank"]);

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createStudent>[0]) => createStudent(payload),
    onSuccess: async (newStudent) => {
      await queryClient.invalidateQueries({ queryKey: keys.students.list() });
      navigate(`/students/${newStudent.id}`);
    },
    onError: (err) => form.handle(err, "Failed to create student. Please check the form."),
  });
  const isSubmitting = createMutation.isPending;

  // 1. Fetch active ranks
  const ranksQuery = useRanksQuery();

  const ranks = useMemo<Rank[]>(() => {
    return ranksQuery.data?.results ?? [];
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
    <section aria-labelledby="add-student-title" className="page">
      <PageHeader
        back={{ to: "/students", label: "Students" }}
        title="Add student"
        titleId="add-student-title"
        subtitle="Create a staff-only student record"
      />

      {form.banner && <Alert className="form-alert">{form.banner}</Alert>}

      <form onSubmit={handleSubmit} noValidate className="stack">
        {/* Card 1: Identity */}
        <div className="card stack">
          <h2 className="section-title section-title--ruled">Identity</h2>

          <div className="form-row-grid-2">
            <Field label="First name" required error={form.errorFor("first_name")}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  placeholder="e.g. Alex"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={isSubmitting}
                />
              )}
            </Field>

            <Field label="Last name" required error={form.errorFor("last_name")}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  placeholder="e.g. Carter"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={isSubmitting}
                />
              )}
            </Field>
          </div>

          <Field
            label="WKSA ID"
            required
            error={form.errorFor("wksa_id")}
            hint={`${idScheme ? `${idScheme.hint} ` : ""}A student ID changes only once, to the black belt ID handed out at the national grading.`}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                placeholder={idScheme ? `e.g. ${idScheme.forms.map((form) => form.example).join(" or ")}` : undefined}
                value={wksaId}
                onChange={(e) => setWksaId(e.target.value)}
                disabled={isSubmitting}
              />
            )}
          </Field>
        </div>

        {/* Card 2: Grading details */}
        <div className="card stack">
          <h2 className="section-title section-title--ruled">Grading details</h2>

          <div className="form-row-grid-3">
            <Field
              label="Date of birth"
              required
              error={form.errorFor("date_of_birth")}
              hint={
                <span className="privacy-badge-line">
                  <LockIcon size={14} className="privacy-icon" />
                  <span>Date of birth is visible only on the individual student record.</span>
                </span>
              }
            >
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={dateOfBirth}
                  max={todayIsoDate()}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  disabled={isSubmitting}
                />
              )}
            </Field>

            <Field label="Current rank" required error={form.errorFor("current_rank")}>
              {(control) => (
                <select
                  {...control}
                  value={effectiveRankId ?? ""}
                  onChange={(e) => setCurrentRank(Number(e.target.value))}
                  disabled={isSubmitting || ranksQuery.isLoading}
                >
                  {ranks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Status" required>
              {(control) => (
                <select
                  {...control}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StudentStatus)}
                  disabled={isSubmitting}
                >
                  {studentStatuses.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </div>

        {/* Actions Row */}
        <div className="action-row action-row--end">
          <Button variant="secondary" onClick={() => navigate("/students")} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create student"}
          </Button>
        </div>
      </form>
    </section>
  );
}
