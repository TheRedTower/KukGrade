import { useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type AuditAction,
  type AuditEntity,
  type AuditEvent,
  type AuditSubject,
  getAuditEvents,
  getAuditLabels,
  getAuditSubject,
  errorMessage,
} from "./api";
import { EmptyState } from "./EmptyState";
import { Alert } from "./Alert";
import { LoadingState } from "./LoadingState";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Pagination } from "./Pagination";
import { eventSummary } from "./auditText";
import { ResponsiveTable } from "./ResponsiveTable";
import "./AuditScreen.css";
import { calendarDaysAgo, currentYear, formatApiDate, formatDateTime, formatTime } from "./dates";
import { keys } from "./queryKeys";
import { counted } from "./plural";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { ArrowRightIcon } from "./Icons";

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
  return event.actor_name || "System";
}

/** Where the app opens the record a history is of: the routes are the app's own. */
function subjectPath(subject: AuditSubject): string {
  switch (subject.kind) {
    case "session":
      return `/gradings/${subject.id}`;
    case "candidate":
      return `/gradings/${subject.session_id}/assessments/${subject.id}/review`;
    case "student":
      return `/students/${subject.id}`;
    default:
      return `/users/${subject.id}`;
  }
}

export function AuditScreen(): React.ReactElement {
  const filters = useUrlFilters();
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const eventTriggerRef = useRef<HTMLButtonElement | null>(null);

  const page = filters.page;
  const action = filters.value("action") as AuditAction | "";
  const entityType = filters.value("entity_type") as AuditEntity | "";
  // The names come from the server, which owns the list (audit/models.py).
  const labels = useQuery({ queryKey: keys.auditLabels(), queryFn: getAuditLabels });
  const entityLabel = labels.data?.entities.find((option) => option.value === entityType)?.label;
  const occurredFrom = filters.value("occurred_from");
  const occurredTo = filters.value("occurred_to");
  const search = filters.value("search");
  const appliedSearch = search.trim();
  // Set by links from a record ("View audit events"); no control edits it.
  const entityId = filters.value("entity_id");
  // A record's history: its own events and everything that belongs to it
  // ("session:3", "student:5", "candidate:9", "user:<id>"), from a link on that record.
  const subject = filters.value("subject");
  const subjectQuery = useQuery({
    queryKey: keys.auditSubject(subject),
    queryFn: () => getAuditSubject(subject),
    enabled: subject !== "",
  });

  const paged = usePagedQuery({
    queryKey: keys.auditEvents.log(
      page,
      action,
      entityType,
      entityId,
      subject,
      occurredFrom,
      occurredTo,
      appliedSearch,
    ),
    queryFn: () =>
      getAuditEvents({
        page,
        page_size: PAGE_SIZE,
        action: action || undefined,
        entity_type: entityType || undefined,
        entity_id: entityId || undefined,
        subject: subject || undefined,
        occurred_from: occurredFrom || undefined,
        occurred_to: occurredTo || undefined,
        search: appliedSearch || undefined,
      }),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
  });
  const query = paged.query;
  const events = paged.results;
  const totalCount = paged.count;
  const hasFilters = Boolean(action || entityType || entityId || subject || occurredFrom || occurredTo || search);

  // The trigger is restored explicitly: a clicked button is not focused in
  // every browser, so the hook's "whatever had focus" may not be it.
  const closeDetails = () => {
    setSelectedEvent(null);
    eventTriggerRef.current?.focus();
  };

  return (
    <section aria-labelledby="audit-heading" className="page">
      <PageHeader
        title="Audit"
        titleId="audit-heading"
        subtitle="A permanent record of sensitive activity"
        tag={
          <Badge tone="neutral" dot>
            Permanent
          </Badge>
        }
      />

      {subject !== "" && (
        <Alert tone="info" data-testid="audit-subject">
          {subjectQuery.isLoading ? (
            "Finding the record…"
          ) : subjectQuery.data?.exists ? (
            <>
              <strong>History of {subjectQuery.data.name}</strong>: the record itself and everything that belongs to it.{" "}
              <Link to={subjectPath(subjectQuery.data)}>
                Open the record <ArrowRightIcon />
              </Link>
            </>
          ) : (
            <>
              <strong>History of a record that no longer exists</strong>: what was recorded about it is kept.
            </>
          )}
        </Alert>
      )}

      <div className="filter-bar" role="search" aria-label="Audit filters">
        <SearchField
          className="filter-bar__full"
          label="Search student name, record number or summary"
          placeholder="Search by number or keyword…"
          value={search}
          onChange={(value) => filters.set({ search: value })}
        />

        <label className="field">
          <span>Action</span>
          <select value={action} onChange={(event) => filters.set({ action: event.target.value })}>
            <option value="">All actions</option>
            {labels.data?.actions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Record type</span>
          <select value={entityType} onChange={(event) => filters.set({ entity_type: event.target.value })}>
            <option value="">All record types</option>
            {labels.data?.entities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Date from</span>
          <input
            type="date"
            value={occurredFrom}
            max={occurredTo || undefined}
            onChange={(event) => filters.set({ occurred_from: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Date to</span>
          <input
            type="date"
            value={occurredTo}
            min={occurredFrom || undefined}
            onChange={(event) => filters.set({ occurred_to: event.target.value })}
          />
        </label>

        <div className="action-row filter-bar__full audit-filter-summary meta">
          <span>
            {counted(totalCount, "event", "events")}
            {entityId && (
              <>
                {" "}
                for {entityLabel ?? "record"} #{entityId}
              </>
            )}
          </span>
          {hasFilters && (
            <Button
              variant="link"
              onClick={() =>
                filters.clear("action", "entity_type", "entity_id", "subject", "occurred_from", "occurred_to", "search")
              }
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div className="stack stack--4" aria-live="polite">
        {query.isLoading ? (
          <LoadingState>Loading audit events…</LoadingState>
        ) : query.isError ? (
          <Alert
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, "Audit events could not be loaded.")}
          </Alert>
        ) : events.length === 0 ? (
          <EmptyState framed title="No audit events found">
            {hasFilters ? "Try clearing or changing the filters." : "No sensitive activity has been recorded yet."}
          </EmptyState>
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
                        <time className="audit-time meta" dateTime={event.occurred_at}>
                          {time.time}
                        </time>
                      </>
                    );
                  },
                },
                { key: "action", header: "Action", primary: true, render: (event) => event.action_display },
                { key: "summary", header: "Summary", render: (event) => eventSummary(event) },
                {
                  key: "actor",
                  header: "Actor",
                  render: (event) => <span className="audit-actor">{actorLabel(event)}</span>,
                },
                {
                  key: "record",
                  header: "Record",
                  render: (event) => (
                    <>
                      <span className="audit-entity-type item-title">{event.entity_type_display}</span>
                      <span className="audit-entity-id meta">#{event.entity_id}</span>
                    </>
                  ),
                },
                {
                  key: "details",
                  header: "Event details",
                  actions: true,
                  render: (event) => (
                    <Button
                      variant="ghost"
                      small
                      onClick={(clickEvent) => {
                        eventTriggerRef.current = clickEvent.currentTarget;
                        setSelectedEvent(event);
                      }}
                      aria-label={`View ${event.action_display} event`}
                    >
                      View event <span aria-hidden="true">›</span>
                    </Button>
                  ),
                },
              ]}
            />

            <Pagination label="Audit event pages" noun={["event", "events"]} {...paged.pager} />
          </>
        )}
      </div>

      <p className="audit-integrity-note meta">Audit events cannot be changed or deleted.</p>

      {selectedEvent && (
        <Dialog
          title={selectedEvent.action_display}
          eyebrow={`Audit event #${selectedEvent.id}`}
          closeLabel="Close event details"
          onClose={closeDetails}
        >
          <dl className="facts tiles tiles--narrow">
            <div>
              <dt>Occurred</dt>
              <dd>{formatDateTime(selectedEvent.occurred_at)}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>{actorLabel(selectedEvent)}</dd>
            </div>
            <div>
              <dt>Record</dt>
              <dd>
                {selectedEvent.entity_type_display} #{selectedEvent.entity_id}
              </dd>
            </div>
          </dl>
          <div className="audit-detail-section">
            <h3>Summary</h3>
            <p>{eventSummary(selectedEvent)}</p>
          </div>
          <div className="audit-detail-section">
            <h3>Recorded details</h3>
            {selectedEvent.details.length === 0 ? (
              <p className="meta">No further details recorded.</p>
            ) : (
              <dl className="facts tiles tiles--narrow">
                {selectedEvent.details.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
