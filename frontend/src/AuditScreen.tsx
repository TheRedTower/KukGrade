import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  type AuditAction,
  type AuditEntity,
  type AuditEvent,
  getAuditEvents,
  getAuditLabels,
  errorMessage,
} from "./api";
import { Dialog } from "./Dialog";
import { Pagination } from "./Pagination";
import { ResponsiveTable } from "./ResponsiveTable";
import "./AuditScreen.css";
import { calendarDaysAgo, currentYear, formatApiDate, formatDateTime, formatTime } from "./dates";

const PAGE_SIZE = 10;

function eventTime(value: string): { date: string; time: string } {
  const daysAgo = calendarDaysAgo(value);
  if (daysAgo === null) return { date: value, time: "" };
  const sameYear = formatApiDate(value, { year: "numeric" }) === String(currentYear());

  return {
    date:
      daysAgo === 0
        ? "Today"
        : formatApiDate(value, {
            day: "numeric",
            month: "short",
            year: sameYear ? undefined : "numeric",
          }),
    time: formatTime(value),
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
    return "No further details recorded.";
  }
  return JSON.stringify(event.metadata, null, 2);
}

export function AuditScreen(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const eventTriggerRef = useRef<HTMLButtonElement | null>(null);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const action = (searchParams.get("action") ?? "") as AuditAction | "";
  const entityType = (searchParams.get("entity_type") ?? "") as AuditEntity | "";
  // The names come from the server, which owns the list (audit/models.py).
  const labels = useQuery({ queryKey: ["auditLabels"], queryFn: getAuditLabels });
  const entityLabel = labels.data?.entities.find((option) => option.value === entityType)?.label;
  const occurredFrom = searchParams.get("occurred_from") ?? "";
  const occurredTo = searchParams.get("occurred_to") ?? "";
  const appliedSearch = searchParams.get("search") ?? "";
  // Set by links from a record ("View audit events"); no control edits it.
  const entityId = searchParams.get("entity_id") ?? "";


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
      entityId,
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
        entity_id: entityId || undefined,
        occurred_from: occurredFrom || undefined,
        occurred_to: occurredTo || undefined,
        search: appliedSearch || undefined,
      }),
  });

  const events = query.data?.results ?? [];
  const totalCount = query.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(
    action || entityType || entityId || occurredFrom || occurredTo || appliedSearch,
  );

  // The trigger is restored explicitly: a clicked button is not focused in
  // every browser, so the hook's "whatever had focus" may not be it.
  const closeDetails = () => {
    setSelectedEvent(null);
    eventTriggerRef.current?.focus();
  };

  return (
    <section aria-labelledby="audit-heading" className="page page--wide audit-page">
      <header className="action-row audit-header">
        <div>
          <h1 id="audit-heading">Audit</h1>
          <p>A permanent record of sensitive activity</p>
        </div>
        <div className="audit-append-only" aria-label="Audit events are permanent">
          <span aria-hidden="true">●</span>
          Permanent
        </div>
      </header>

      <form
        className="filter-bar"
        aria-label="Audit filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: searchInputRef.current?.value.trim() ?? "" });
        }}
      >
        <label className="field filter-bar__full">
          <span>Search record number or summary</span>
          <div className="field__row">
            <input
              key={appliedSearch}
              ref={searchInputRef}
              type="search"
              defaultValue={appliedSearch}
              placeholder="Search by number or keyword…"
            />
            <button type="submit">Search</button>
          </div>
        </label>

        <label className="field">
          <span>Action</span>
          <select
            value={action}
            onChange={(event) => updateFilters({ action: event.target.value })}
          >
            <option value="">All actions</option>
            {labels.data?.actions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Record type</span>
          <select
            value={entityType}
            onChange={(event) => updateFilters({ entity_type: event.target.value })}
          >
            <option value="">All record types</option>
            {labels.data?.entities.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Date from</span>
          <input
            type="date"
            value={occurredFrom}
            max={occurredTo || undefined}
            onChange={(event) => updateFilters({ occurred_from: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Date to</span>
          <input
            type="date"
            value={occurredTo}
            min={occurredFrom || undefined}
            onChange={(event) => updateFilters({ occurred_to: event.target.value })}
          />
        </label>

        <div className="action-row filter-bar__full audit-filter-summary">
          <span>
            {totalCount} event{totalCount === 1 ? "" : "s"}
            {entityId && (
              <>
                {" "}
                for {entityLabel ?? "record"} #{entityId}
              </>
            )}
          </span>
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
          <div className="card audit-state audit-state-error" role="alert">
            <p>
              {errorMessage(query.error, "Audit events could not be loaded.")}
            </p>
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
          </div>
        ) : events.length === 0 ? (
          <div className="card audit-state">
            <strong>No audit events found</strong>
            <span>{hasFilters ? "Try clearing or changing the filters." : "No sensitive activity has been recorded yet."}</span>
          </div>
        ) : (
          <>
            <ResponsiveTable
              label="Audit events, newest first"
              rows={events}
              rowKey={(event) => event.id}
              columns={[
                {
                  key: "time",
                  header: "Time",
                  render: (event) => {
                    const time = eventTime(event.occurred_at);
                    return (
                      <>
                        <span className="audit-date">{time.date}</span>
                        <time className="audit-time" dateTime={event.occurred_at}>{time.time}</time>
                      </>
                    );
                  },
                },
                { key: "action", header: "Action", primary: true, render: (event) => event.action_display },
                { key: "summary", header: "Summary", render: (event) => event.summary },
                { key: "actor", header: "Actor", render: (event) => actorLabel(event) },
                {
                  key: "record",
                  header: "Record",
                  render: (event) => (
                    <>
                      <span className="audit-entity-type">{event.entity_type_display}</span>
                      <span className="audit-entity-id">#{event.entity_id}</span>
                    </>
                  ),
                },
                {
                  key: "details",
                  header: "Event details",
                  actions: true,
                  render: (event) => (
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
                  ),
                },
              ]}
            />

            <Pagination
              label="Audit event pages"
              page={page}
              totalPages={totalPages}
              onPage={(next) => updateFilters({ page: String(next) }, true)}
              summary={`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount} events`}
            />
          </>
        )}
      </div>

      <p className="audit-integrity-note">Audit events cannot be changed or deleted.</p>

      {selectedEvent && (
        <Dialog
          title={selectedEvent.action_display}
          eyebrow={`Audit event #${selectedEvent.id}`}
          closeLabel="Close event details"
          onClose={closeDetails}
        >
          <dl className="facts">
            <div><dt>Occurred</dt><dd>{formatDateTime(selectedEvent.occurred_at)}</dd></div>
            <div><dt>Actor</dt><dd>{actorLabel(selectedEvent)}</dd></div>
            <div><dt>Record</dt><dd>{selectedEvent.entity_type_display} #{selectedEvent.entity_id}</dd></div>
          </dl>
          <div className="audit-detail-section">
            <h3>Summary</h3>
            <p>{selectedEvent.summary}</p>
          </div>
          <div className="audit-detail-section">
            <h3>Recorded details</h3>
            <pre className="code-block">{eventMetadata(selectedEvent)}</pre>
          </div>
        </Dialog>
      )}
    </section>
  );
}
