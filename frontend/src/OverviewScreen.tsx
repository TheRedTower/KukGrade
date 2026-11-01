import { useMemo } from "react";
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
import { useAuth } from "./auth";
import { Button } from "./Button";
import { calendarDaysAgo, formatApiDate, formatSessionDate, formatTime, todayIsoDate } from "./dates";
import "./OverviewScreen.css";
import { CheckIcon } from "./Icons";
import { OUTCOME_LABELS } from "./OutcomeControls";
import { ResponsiveTable } from "./ResponsiveTable";
import { SessionStatusBadge } from "./StatusBadge";

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

function formatRelativeTime(isoString: string): string {
  const daysAgo = calendarDaysAgo(isoString);
  if (daysAgo === null) return isoString;
  const time = formatTime(isoString);
  if (daysAgo === 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  return `${formatApiDate(isoString, { day: "numeric", month: "short" })} ${time}`;
}

type ActivityStatus = "approved" | "warning" | "in-progress" | "neutral";

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
      return { type: "approved" };
    case "OUTCOME_FINALISED": {
      const outcome = metadataString(event, "final_outcome");
      return { type: outcome === "PASS" ? "approved" : "warning", outcome };
    }
    case "OUTCOME_PROPOSED":
      return { type: "in-progress", outcome: metadataString(event, "after", "proposed_outcome") };
    case "ASSESSMENT_STARTED":
      return { type: "in-progress" };
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
    timeDisplay: formatRelativeTime(event.occurred_at),
    actorName: event.actor_name || event.actor_email || "System",
    summary: event.summary,
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
    queryKey: ["gradingSessions", "current"],
    queryFn: () => getGradingSessions({ status: "OPEN", page_size: 1 }),
  });
  const upcomingQuery = useQuery({
    queryKey: ["gradingSessions", "upcoming", today],
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
    queryKey: ["candidateAssessments", "attention", openSession?.id],
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
    queryKey: ["auditEvents", "recent"],
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
      className="page overview-container"
    >
      {/* Top Header */}
      <div className="overview-header">
        <div className="overview-header-left">
          <h1 className="overview-title" id="overview-heading">
            Overview
          </h1>
          <p className="overview-date">{currentDateDisplay}</p>
        </div>
        <div aria-hidden="true" className="overview-motto">
          <span>TRADITION BUILDS PEOPLE</span>
          <span>PEOPLE BUILD TOMORROW</span>
        </div>
      </div>

      {openQuery.isError || upcomingQuery.isError ? (
        <div className="workspace-alert" role="alert">
          <p className="form-error">
            The overview could not be loaded. Check your connection and try again.
          </p>
        </div>
      ) : null}

      {/* Top 3-Column Grid */}
      <div className="overview-grid">
        {/* Card 1: Now */}
        <div className="ledger-card now-card">
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
            <div className="card-empty-state">
              <p className="empty-state-title">No active grading session</p>
              <p className="empty-state-desc">
                No grading session in progress on the mat.
              </p>
              <Button onClick={() => navigate("/gradings")}>
                View all gradings <span aria-hidden="true">&rarr;</span>
              </Button>
            </div>
          )}
        </div>

        {/* Card 2: Needs attention */}
        <div className="ledger-card needs-attention-card">
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
            <div className="card-empty-state all-clear-state">
              <div aria-hidden="true" className="all-clear-icon-box">
                <CheckCircleIcon />
              </div>
              <p className="empty-state-title">All clear</p>
              <p className="empty-state-desc">
                No candidate assessments currently requiring review.
              </p>
            </div>
          )}
        </div>

        {/* Card 3: Upcoming */}
        <div className="ledger-card upcoming-card">
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
            <div className="card-empty-state">
              <p className="empty-state-title">No upcoming gradings</p>
              <p className="empty-state-desc">
                No future grading sessions are currently scheduled.
              </p>
              <Button onClick={() => navigate("/gradings")}>
                Schedule a grading <span aria-hidden="true">&rarr;</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Recent Activity - the audit log's latest entries,
          so only for someone who may read it; nobody else is told there is
          nothing. */}
      {canViewAudit && (
      <div className="recent-activity-section">
        <div className="activity-section-header">
          <h2 className="activity-section-title">Recent activity</h2>
          <button
            className="view-all-activity-link"
            onClick={() => navigate("/audit")}
            type="button"
          >
            View all activity <span aria-hidden="true">&rarr;</span>
          </button>
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
                  <span className={`status-pill-badge status-pill-${activity.statusType}`}>
                    {activity.statusType === "approved" ? (
                      <CheckIcon size={14} className="overview-icon" />
                    ) : activity.statusType === "warning" ? (
                      <AlertIcon />
                    ) : activity.statusType === "in-progress" ? (
                      <ClockIcon />
                    ) : null}
                    <span>{activity.statusLabel}</span>
                  </span>
                ),
              },
            ]}
          />
        ) : (
          <div className="activity-empty-state" role="status">
            <p>
              {isInitialLoading
                ? "Loading recent activity…"
                : "No recent activity recorded."}
            </p>
          </div>
        )}
      </div>
      )}
    </section>
  );
}
