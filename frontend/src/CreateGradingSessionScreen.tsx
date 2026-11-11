import { type FormEvent, useMemo, useState } from "react";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { Alert } from "./Alert";
import { createGradingSession } from "./api";
import { useServerForm } from "./forms";
import { ResponsiveTable } from "./ResponsiveTable";
import { SessionStatusBadge } from "./StatusBadge";
import { labelOf, useChoices } from "./choices";
import "./GradingSessions.css";
import { currentYear, formatSessionDate } from "./dates";
import { Button } from "./Button";

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
  const thisYear = currentYear();
  const years: string[] = [];
  for (let y = thisYear - 1; y <= thisYear + 5; y++) {
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
  const sessionStatuses = useChoices().session_statuses;

  // Form State
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(String(currentYear()));
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  // What the server and the browser's own checks say about the form.
  const form = useServerForm(["title", "grading_date", "location", "notes"]);

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createGradingSession>[0]) => createGradingSession(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.gradingSessions.all() });
      navigate("/gradings");
    },
    onError: (err) => form.handle(err, "Failed to create grading session. Please check the form."),
  });
  const isSubmitting = createMutation.isPending;

  const years = useMemo(() => generateYears(), []);

  // Compute days in chosen month/year
  const daysCount = useMemo(() => {
    if (!month) return 31;
    const y = year ? parseInt(year, 10) : currentYear();
    const m = parseInt(month, 10);
    return new Date(y, m, 0).getDate();
  }, [year, month]);

  const daysList = useMemo(() => {
    return Array.from({ length: daysCount }, (_, i) => String(i + 1));
  }, [daysCount]);

  const previewFormattedDate = useMemo(() => {
    return formatPreviewDate(year, month, day);
  }, [year, month, day]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    form.reset();

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
      form.setClientErrors(errors);
      return;
    }

    const formattedIsoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    createMutation.mutate({
      title: title.trim(),
      grading_date: formattedIsoDate,
      location: location.trim(),
      notes: notes.trim(),
    });
  }

  return (
    <section aria-labelledby="create-session-heading" className="page">
      <PageHeader
        back={{ to: "/gradings", label: "Gradings" }}
        title="Create grading session"
        titleId="create-session-heading"
        subtitle="Set the details, then add candidates."
      />

      {/* ── General Error Banner */}
      {form.banner && (
        <Alert>{form.banner}</Alert>
      )}

      {/* ── Two-Column Layout */}
      <div className="split">
        {/* Left Column: Form */}
        <div>
          <form className="cgs-form" noValidate onSubmit={handleSubmit}>
            {/* Session Title */}
            <Field label="Session title" required error={form.errorFor("title")}>
              {(control) => (
                <input
                  {...control}
                  disabled={isSubmitting}
                  name="title"
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Winter Grading"
                  type="text"
                  value={title}
                />
              )}
            </Field>

            {/* Grading Date (Day / Month / Year) */}
            <div className="field field--sentence">
              <label htmlFor="cgs-day-select">
                Grading date <span className="required-star">*</span>
              </label>
              <div className="cgs-date-row">
                <select
                  aria-label="Grading day"
                  aria-invalid={!!form.errorFor("grading_date")}
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
                  aria-invalid={!!form.errorFor("grading_date")}
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
                  aria-invalid={!!form.errorFor("grading_date")}
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
              {form.errorFor("grading_date") && (
                <ErrorText field>{form.errorFor("grading_date")}</ErrorText>
              )}
            </div>

            {/* Location */}
            <Field label={<>Location <small>(optional)</small></>} error={form.errorFor("location")}>
              {(control) => (
                <input
                  {...control}
                  disabled={isSubmitting}
                  name="location"
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Riverside Dojang"
                  type="text"
                  value={location}
                />
              )}
            </Field>

            {/* Staff Notes */}
            <Field label={<>Staff notes <small>(optional)</small></>} error={form.errorFor("notes")}>
              {(control) => (
                <>
                  <textarea
                    {...control}
                    disabled={isSubmitting}
                    maxLength={500}
                    name="notes"
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add internal notes for grading staff"
                    rows={4}
                    value={notes}
                  />
                  <div className="cgs-char-counter meta">
                    <span className={notes.length >= 480 ? "cgs-char-near-limit" : ""}>
                      {notes.length}/500
                    </span>
                  </div>
                </>
              )}
            </Field>

            {/* Form Actions */}
            <div className="action-row cgs-form-actions">
              <Button
                variant="ghost"
                disabled={isSubmitting}
                id="cgs-cancel-btn"
                onClick={() => navigate("/gradings")}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={isSubmitting}
                id="cgs-submit-btn"
                type="submit"
              >
                {isSubmitting ? "Creating…" : "Create draft session"}
              </Button>
            </div>
          </form>
        </div>

        {/* Right Column: Session Preview */}
        <div className="split__aside">
          <div className="cgs-preview-card">
            <h2 className="cgs-preview-title section-title" id="cgs-preview-heading">Session preview</h2>
            <p className="cgs-preview-subtitle subtext">
              This is how the session will appear in the gradings list after creation.
            </p>

            <ResponsiveTable
              label="Session preview"
              rows={[{ id: "preview" }]}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "title",
                  header: "Session title",
                  primary: true,
                  render: () => title.trim() || <span className="cgs-preview-placeholder">Session title</span>,
                },
                { key: "date", header: "Date", render: () => previewFormattedDate },
                { key: "location", header: "Location", render: () => location.trim() || "—" },
                { key: "status", header: "Status", render: () => <SessionStatusBadge status="DRAFT" label={labelOf(sessionStatuses, "DRAFT")} /> },
                { key: "candidates", header: "Candidates", align: "end", render: () => "0" },
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
