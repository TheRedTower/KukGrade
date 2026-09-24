import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  type AuditAction,
  type AuditEvent,
  ApiError,
  getAuditEvents,
} from "./api";
import { useDialogFocus } from "./useDialogFocus";
import "./AuditScreen.css";

const PAGE_SIZE = 10;

const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "SESSION_CREATED", label: "Grading session created" },
  { value: "SESSION_TRANSITIONED", label: "Grading session transitioned" },
  { value: "SESSION_DELETED", label: "Grading session deleted" },
  { value: "CANDIDATE_REGISTERED", label: "Candidate registered" },
  { value: "CANDIDATE_UPDATED", label: "Candidate updated" },
  { value: "CANDIDATE_WITHDRAWN", label: "Candidate withdrawn" },
  { value: "CANDIDATE_DELETED", label: "Candidate deleted" },
  { value: "ASSESSMENT_GENERATED", label: "Assessment generated" },
  { value: "ASSESSMENT_STARTED", label: "Assessment started" },
  { value: "ASSESSMENT_COMPLETED", label: "Assessment completed" },
  { value: "ITEM_RESULT_RECORDED", label: "Assessment item result recorded" },
  { value: "OUTCOME_CREATED", label: "Outcome created" },
  { value: "OUTCOME_PROPOSED", label: "Outcome proposed" },
  { value: "OUTCOME_FINALISED", label: "Outcome finalised" },
  { value: "PROMOTION_RECORDED", label: "Promotion recorded" },
  { value: "STUDENT_CREATED", label: "Student created" },
  { value: "STUDENT_UPDATED", label: "Student updated" },
  { value: "STUDENT_STATUS_CHANGED", label: "Student status changed" },
  { value: "USER_CREATED", label: "User created" },
  { value: "USER_UPDATED", label: "User updated" },
  { value: "USER_AUTHORITY_CHANGED", label: "User authority changed" },
];

const ENTITY_OPTIONS = [
  ["GradingSession", "Grading session"],
  ["GradingCandidate", "Candidate"],
  ["CandidateAssessment", "Assessment"],
  ["CandidateAssessmentItem", "Assessment item"],
  ["CandidateOutcome", "Outcome"],
  ["Promotion", "Promotion"],
  ["Student", "Student"],
  ["User", "User"],
] as const;

const ENTITY_LABELS = new Map<string, string>(ENTITY_OPTIONS);

function eventTime(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return {
    date: isToday
      ? "Today"
      : new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
        }).format(date),
    time: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  };
}

function actorLabel(event: AuditEvent): string {
  return event.actor_name.trim() || event.actor_email || "System";
}

function eventMetadata(event: AuditEvent): string {
  if (
    event.metadata === null ||
    event.metadata === undefined ||
    (typeof event.metadata === "object" && Object.keys(event.metadata).length === 0)
  ) {
    return "No additional metadata recorded.";
  }
  return JSON.stringify(event.metadata, null, 2);
}

function visiblePages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

export function AuditScreen(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const eventTriggerRef = useRef<HTMLButtonElement | null>(null);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const action = (searchParams.get("action") ?? "") as AuditAction | "";
  const entityType = searchParams.get("entity_type") ?? "";
  const occurredFrom = searchParams.get("occurred_from") ?? "";
  const occurredTo = searchParams.get("occurred_to") ?? "";
  const appliedSearch = searchParams.get("search") ?? "";


  const updateFilters = (updates: Record<string, string>, preservePage = false) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (!preservePage) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: [
      "auditEvents",
      page,
      action,
      entityType,
      occurredFrom,
      occurredTo,
      appliedSearch,
    ],
    queryFn: () =>
      getAuditEvents({
        page,
        page_size: PAGE_SIZE,
        action: action || undefined,
        entity_type: entityType || undefined,
        occurred_from: occurredFrom || undefined,
        occurred_to: occurredTo || undefined,
        search: appliedSearch || undefined,
      }),
  });

  const events = query.data?.results ?? [];
  const totalCount = query.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageNumbers = useMemo(() => visiblePages(page, totalPages), [page, totalPages]);
  const hasFilters = Boolean(action || entityType || occurredFrom || occurredTo || appliedSearch);

  // The trigger is restored explicitly: a clicked button is not focused in
  // every browser, so the hook's "whatever had focus" may not be it.
  const closeDetails = () => {
    setSelectedEvent(null);
    eventTriggerRef.current?.focus();
  };
  const detailDialogRef = useDialogFocus<HTMLElement>({
    isOpen: selectedEvent !== null,
    onClose: closeDetails,
  });

  return (
    <section aria-labelledby="audit-heading" className="audit-page">
      <header className="audit-header">
        <div>
          <h1 id="audit-heading">Audit</h1>
          <p>A permanent record of sensitive activity</p>
        </div>
        <div className="audit-append-only" aria-label="Audit events are append-only">
          <span aria-hidden="true">●</span>
          Append-only
        </div>
      </header>

      <form
        className="audit-filters"
        aria-label="Audit filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: searchInputRef.current?.value.trim() ?? "" });
        }}
      >
        <label className="audit-filter audit-filter-search">
          <span>Search entity ID or summary</span>
          <div className="audit-search-row">
            <input
              key={appliedSearch}
              ref={searchInputRef}
              type="search"
              defaultValue={appliedSearch}
              placeholder="Search by ID or keyword…"
            />
            <button type="submit" className="audit-search-button">Search</button>
          </div>
        </label>

        <label className="audit-filter">
          <span>Action</span>
          <select
            value={action}
            onChange={(event) => updateFilters({ action: event.target.value })}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span>Entity type</span>
          <select
            value={entityType}
            onChange={(event) => updateFilters({ entity_type: event.target.value })}
          >
            <option value="">All entities</option>
            {ENTITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span>Date from</span>
          <input
            type="date"
            value={occurredFrom}
            max={occurredTo || undefined}
            onChange={(event) => updateFilters({ occurred_from: event.target.value })}
          />
        </label>

        <label className="audit-filter">
          <span>Date to</span>
          <input
            type="date"
            value={occurredTo}
            min={occurredFrom || undefined}
            onChange={(event) => updateFilters({ occurred_to: event.target.value })}
          />
        </label>

        <div className="audit-filter-summary">
          <span>{totalCount} event{totalCount === 1 ? "" : "s"}</span>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchParams({}, { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </form>

      <div className="audit-ledger" aria-live="polite">
        {query.isLoading ? (
          <div className="audit-state" role="status">Loading audit events…</div>
        ) : query.isError ? (
          <div className="audit-state audit-state-error" role="alert">
            <p>
              {query.error instanceof ApiError
                ? query.error.message
                : "Audit events could not be loaded."}
            </p>
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
          </div>
        ) : events.length === 0 ? (
          <div className="audit-state">
            <strong>No audit events found</strong>
            <span>{hasFilters ? "Try clearing or changing the filters." : "No sensitive activity has been recorded yet."}</span>
          </div>
        ) : (
          <>
            <div className="audit-table-scroll">
              <table className="audit-table">
                <caption className="visually-hidden">Audit events, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Action</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Entity</th>
                    <th scope="col"><span className="visually-hidden">Event details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const time = eventTime(event.occurred_at);
                    return (
                      <tr key={event.id}>
                        <td className="audit-time">
                          <span>{time.date}</span>
                          <time dateTime={event.occurred_at}>{time.time}</time>
                        </td>
                        <td className="audit-action">{event.action_display}</td>
                        <td className="audit-summary" title={event.summary}>
                          {event.summary}
                        </td>
                        <td>{actorLabel(event)}</td>
                        <td>
                          <span className="audit-entity-type">
                            {ENTITY_LABELS.get(event.entity_type) ?? event.entity_type}
                          </span>
                          <span className="audit-entity-id">#{event.entity_id}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="audit-view-button"
                            onClick={(clickEvent) => {
                              eventTriggerRef.current = clickEvent.currentTarget;
                              setSelectedEvent(event);
                            }}
                            aria-label={`View ${event.action_display} event`}
                          >
                            View event <span aria-hidden="true">›</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <nav className="audit-pagination" aria-label="Audit event pages">
              <div className="audit-page-buttons">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => updateFilters({ page: String(page - 1) }, true)}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                {pageNumbers.map((pageNumber, index) =>
                  pageNumber === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
                  ) : (
                    <button
                      type="button"
                      key={pageNumber}
                      className={pageNumber === page ? "is-current" : ""}
                      aria-current={pageNumber === page ? "page" : undefined}
                      onClick={() => updateFilters({ page: String(pageNumber) }, true)}
                    >
                      {pageNumber}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => updateFilters({ page: String(page + 1) }, true)}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} events
              </span>
            </nav>
          </>
        )}
      </div>

      <p className="audit-integrity-note">Audit events cannot be changed or deleted.</p>

      {selectedEvent && (
        <div
          className="audit-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetails();
          }}
        >
          <section
            ref={detailDialogRef}
            tabIndex={-1}
            className="audit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-dialog-title"
          >
            <header>
              <div>
                <p>Audit event #{selectedEvent.id}</p>
                <h2 id="audit-dialog-title">{selectedEvent.action_display}</h2>
              </div>
              <button
                data-dialog-autofocus
                type="button"
                className="audit-dialog-close"
                onClick={closeDetails}
                aria-label="Close event details"
              >
                Close
              </button>
            </header>
            <dl className="audit-detail-grid">
              <div><dt>Occurred</dt><dd>{new Date(selectedEvent.occurred_at).toLocaleString("en-GB")}</dd></div>
              <div><dt>Actor</dt><dd>{actorLabel(selectedEvent)}</dd></div>
              <div><dt>Entity</dt><dd>{ENTITY_LABELS.get(selectedEvent.entity_type) ?? selectedEvent.entity_type} #{selectedEvent.entity_id}</dd></div>
              <div><dt>Action code</dt><dd><code>{selectedEvent.action}</code></dd></div>
            </dl>
            <div className="audit-detail-section">
              <h3>Summary</h3>
              <p>{selectedEvent.summary}</p>
            </div>
            <div className="audit-detail-section">
              <h3>Recorded metadata</h3>
              <pre>{eventMetadata(selectedEvent)}</pre>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
