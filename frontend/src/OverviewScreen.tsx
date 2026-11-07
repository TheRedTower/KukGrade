import { useMemo } from "react";
import { keys } from "./queryKeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import {
  type AuditEvent,
  type CandidateAssessment,
  type CandidateOutcomeOutcome,
  type GradingSession,
  getCandidateAssessments,
  getGradingSessions,
  getAuditEvents,
} from "./api";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { useAuth } from "./auth";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { formatRecentTime, formatSessionDate, todayIsoDate } from "./dates";
import "./OverviewScreen.css";
import { CheckIcon } from "./Icons";
import { OUTCOME_LABELS } from "./OutcomeControls";
import { eventSummary } from "./auditText";
import { ResponsiveTable } from "./ResponsiveTable";
import { PageHeader } from "./PageHeader";
import { SessionStatusBadge } from "./StatusBadge";
import { Badge } from "./Badge";
import type { BadgeTone } from "./badgeClass";

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="overview-icon"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="overview-icon"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="overview-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      className="overview-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

/** A badge tone: done, needs a look, under way, or neither. */
type ActivityStatus = Extract<BadgeTone, "success" | "warning" | "info" | "neutral">;

type FormattedActivityItem = {
  id: number;
  timeDisplay: string;
  actorName: string;
  summary: string;
  statusType: ActivityStatus;
  statusLabel: string;
};


function metadataString(event: AuditEvent, ...path: string[]): string | undefined {
  let value: unknown = event.metadata;
  for (const key of path) {
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

/**
 * An event's status, from its action and structured outcome - never from
 * words in the prose summary, which labelled a password reset or a failed
 * grading "Approved". Unknown actions stay neutral under the
 * server's own label.
 */
function activityStatus(event: AuditEvent): { type: ActivityStatus; outcome?: string } {
  switch (event.action) {
    case "PROMOTION_RECORDED":
      return { type: "success" };
    case "OUTCOME_FINALISED": {
      const outcome = metadataString(event, "final_outcome");
      return { type: outcome === "PASS" ? "success" : "warning", outcome };
    }
    case "OUTCOME_PROPOSED":
      return { type: "info", outcome: metadataString(event, "after", "proposed_outcome") };
    case "ASSESSMENT_STARTED":
      return { type: "info" };
    case "CANDIDATE_WITHDRAWN":
      return { type: "warning" };
    default:
      return { type: "neutral" };
  }
}

function formatAuditEvent(event: AuditEvent): FormattedActivityItem {
  const { type, outcome } = activityStatus(event);
  const outcomeLabel = outcome ? OUTCOME_LABELS[outcome as CandidateOutcomeOutcome] : undefined;
  return {
    id: event.id,
    timeDisplay: formatRecentTime(event.occurred_at),
    actorName: event.actor_name || event.actor_email || "System",
    summary: eventSummary(event),
    statusType: type,
    statusLabel: outcomeLabel ? `${event.action_display} · ${outcomeLabel}` : event.action_display,
  };
}

export function OverviewScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const canViewAudit = Boolean(user?.can_read_audit_log);

  const currentDateDisplay = useMemo(() => formatSessionDate(todayIsoDate()), []);

  // 1. The session on the mat and the next one after it.
  const today = todayIsoDate();
  const openQuery = useQuery({
    queryKey: keys.gradingSessions.current(),
    queryFn: () => getGradingSessions({ status: "OPEN", page_size: 1 }),
  });
  const upcomingQuery = useQuery({
    queryKey: keys.gradingSessions.upcoming(today),
    queryFn: () =>
      getGradingSessions({
        status: "DRAFT,OPEN,LOCKED",
        grading_date_from: today,
        ordering: "grading_date",
        page_size: 2,
      }),
  });

  const openSession: GradingSession | undefined = openQuery.data?.results[0];
  const upcomingSession: GradingSession | undefined =
    upcomingQuery.data?.results.find((s) => s.id !== openSession?.id);

  // 2. Fetch assessments for open session
  const assessmentsQuery = useQuery({
    queryKey: keys.candidateAssessments.attention(openSession?.id),
    queryFn: () =>
      getCandidateAssessments({
        session: openSession!.id,
        status: "COMPLETED,IN_PROGRESS",
        page_size: 4,
      }),
    enabled: !!openSession,
  });

  // 3. Fetch recent audit events
  const auditQuery = useQuery({
    queryKey: keys.auditEvents.recent(),
    queryFn: () => getAuditEvents({ page_size: 6 }),
    enabled: canViewAudit,
    retry: false,
  });

  const assessments = useMemo<CandidateAssessment[]>(() => {
    return Array.isArray(assessmentsQuery.data?.results)
      ? assessmentsQuery.data.results
      : [];
  }, [assessmentsQuery.data]);

  // Counted on the server, so they agree with every other screen.
  const candidatesCount = openSession?.candidate_count ?? 0;
  const completedAssessmentsCount = openSession?.completed_assessment_count ?? 0;
  const awaitingDecisionCount = openSession?.awaiting_decision_count ?? 0;

  // Assessments needing attention in the open session: those still being
  // scored, and completed ones, which wait for the session to lock before an
  // outcome can be proposed. Each opens its own assessment.
  const attentionItems = useMemo(() => {
    return assessments.map((a) => {
      const base = `/gradings/${openSession?.id}/assessments/${a.candidate}`;
      return a.status === "COMPLETED"
        ? {
            id: a.id,
            candidate_student_name: a.candidate_student_name,
            statusDescription: "Assessment complete · Awaiting lock",
            path: `${base}/review`,
          }
        : {
            id: a.id,
            candidate_student_name: a.candidate_student_name,
            statusDescription: "Assessment in progress · Scoring pending",
            path: base,
          };
    });
  }, [assessments, openSession?.id]);

  // Recent activity items
  const recentActivities: FormattedActivityItem[] = useMemo(() => {
    if (!Array.isArray(auditQuery.data?.results)) return [];
    return auditQuery.data.results.map(formatAuditEvent);
  }, [auditQuery.data]);

  const isInitialLoading =
    openQuery.isLoading ||
    upcomingQuery.isLoading ||
    (canViewAudit && auditQuery.isLoading) ||
    (!!openSession && assessmentsQuery.isLoading);

  return (
    <section
      aria-labelledby="overview-heading"
      className="page"
    >
      <PageHeader
        title="Overview"
        titleId="overview-heading"
        subtitle={currentDateDisplay}
        actions={
          <div aria-hidden="true" className="overview-motto">
            <span>TRADITION BUILDS PEOPLE</span>
            <span>PEOPLE BUILD TOMORROW</span>
          </div>
        }
      />

      {openQuery.isError || upcomingQuery.isError ? (
        <div className="workspace-alert">
            <Alert>The overview could not be loaded. Check your connection and try again.</Alert>
          </div>
      ) : null}

      {/* Top 3-Column Grid */}
      <div className="overview-grid">
        {/* Card 1: Now */}
        <div className="ledger-card">
          <div className="card-top-label">
            <span>Now</span>
          </div>

          {openSession ? (
            <div className="card-content-now">
              <div className="session-title-row">
                <h2 className="session-title">{openSession.title}</h2>
                <SessionStatusBadge status={openSession.status} label={openSession.status_display} />
              </div>
              {openSession.location && <p className="session-location">{openSession.location}</p>}

              <div className="metrics-row">
                <div className="metric-box">
                  <span className="metric-number">{candidatesCount}</span>
                  <span className="metric-label">Candidates</span>
                </div>
                <div className="metric-divider" aria-hidden="true" />
                <div className="metric-box">
                  <span className="metric-number">
                    {completedAssessmentsCount} / {candidatesCount}
                  </span>
                  <span className="metric-label">Assessments complete</span>
                </div>
                <div className="metric-divider" aria-hidden="true" />
                <div className="metric-box">
                  <span className="metric-number">{awaitingDecisionCount}</span>
                  <span className="metric-label">Awaiting final decision</span>
                </div>
              </div>

              <Button variant="primary" block onClick={() => navigate(`/gradings/${openSession.id}`)}>
                Open session <span aria-hidden="true">&rarr;</span>
              </Button>
            </div>
          ) : (
            <EmptyState
              fill
              title="No active grading session"
              action={
                <Button onClick={() => navigate("/gradings")}>
                  View all gradings <span aria-hidden="true">&rarr;</span>
                </Button>
              }
            >
              No grading session in progress on the mat.
            </EmptyState>
          )}
        </div>

        {/* Card 2: Needs attention */}
        <div className="ledger-card">
          <div className="card-top-label">
            <span>Needs attention</span>
          </div>

          {attentionItems.length > 0 ? (
            <div className="attention-list" role="list">
              {attentionItems.map((item) => (
                <div key={item.id} role="listitem">
                  <Link className="attention-item-row" to={item.path}>
                    <span aria-hidden="true" className="attention-badge">
                      !
                    </span>
                    <div className="attention-item-info">
                      <strong className="attention-student-name">
                        {item.candidate_student_name}
                      </strong>
                      <span className="attention-status-desc">
                        {item.statusDescription}
                      </span>
                    </div>
                    <span aria-hidden="true" className="chevron-icon">
                      &rsaquo;
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState fill icon={<span className="all-clear-icon"><CheckCircleIcon /></span>} title="All clear">
              No candidate assessments currently requiring review.
            </EmptyState>
          )}
        </div>

        {/* Card 3: Upcoming */}
        <div className="ledger-card">
          <div className="card-top-label">
            <span>Upcoming</span>
          </div>

          {upcomingSession ? (
            <Link className="upcoming-session-row" to={`/gradings/${upcomingSession.id}`}>
              <div aria-hidden="true" className="calendar-icon-box">
                <CalendarIcon />
              </div>
              <div className="upcoming-session-info">
                <strong className="upcoming-session-title">
                  {upcomingSession.title}
                </strong>
                <span className="upcoming-session-date">
                  {formatSessionDate(upcomingSession.grading_date)}
                </span>
                {upcomingSession.location && (
                  <span className="upcoming-session-location">{upcomingSession.location}</span>
                )}
              </div>
              <span aria-hidden="true" className="chevron-icon">
                &rsaquo;
              </span>
            </Link>
          ) : (
            <EmptyState
              fill
              title="No upcoming gradings"
              action={
                <Button onClick={() => navigate("/gradings")}>
                  Schedule a grading <span aria-hidden="true">&rarr;</span>
                </Button>
              }
            >
              No future grading sessions are currently scheduled.
            </EmptyState>
          )}
        </div>
      </div>

      {/* Bottom Section: Recent Activity - the audit log's latest entries,
          so only for someone who may read it; nobody else is told there is
          nothing. */}
      {canViewAudit && (
      <div className="recent-activity-section">
        <div className="activity-section-header">
          <h2 className="section-title">Recent activity</h2>
          <Link className={buttonClass({ variant: "link" })} to="/audit">
            View all activity <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        {recentActivities.length > 0 ? (
          <ResponsiveTable
            label="Recent activity"
            rows={recentActivities}
            rowKey={(activity) => activity.id}
            columns={[
              { key: "time", header: "Time", render: (activity) => <span className="cell-time">{activity.timeDisplay}</span> },
              { key: "actor", header: "By", render: (activity) => <strong>{activity.actorName}</strong> },
              { key: "event", header: "Event", primary: true, render: (activity) => activity.summary },
              {
                key: "status",
                header: "Status",
                render: (activity) => (
                  <Badge
                    tone={activity.statusType}
                    icon={
                      activity.statusType === "success" ? (
                        <CheckIcon size={14} />
                      ) : activity.statusType === "warning" ? (
                        <AlertIcon />
                      ) : activity.statusType === "info" ? (
                        <ClockIcon />
                      ) : null
                    }
                  >
                    {activity.statusLabel}
                  </Badge>
                ),
              },
            ]}
          />
        ) : (
          isInitialLoading ? (
            <LoadingState>Loading recent activity…</LoadingState>
          ) : (
            <EmptyState title="No recent activity recorded." />
          )
        )}
      </div>
      )}
    </section>
  );
}
