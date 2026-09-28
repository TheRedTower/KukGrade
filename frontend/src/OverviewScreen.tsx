import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  type AuditEvent,
  type CandidateAssessment,
  type GradingCandidate,
  type GradingSession,
  getAllCandidateAssessments,
  getAllGradingCandidates,
  getAllGradingSessions,
  getAuditEvents,
} from "./api";
import { useAuth } from "./auth";
import { calendarDaysAgo, formatApiDate, formatSessionDate, formatTime, todayIsoDate } from "./dates";
import "./OverviewScreen.css";
import { CheckIcon } from "./Icons";

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

type FormattedActivityItem = {
  id: number;
  timeDisplay: string;
  targetName: string;
  summary: string;
  statusType: "approved" | "warning" | "in-progress" | "neutral";
  statusLabel: string;
};

function formatAuditEvent(event: AuditEvent): FormattedActivityItem {
  const summaryLower = (event.summary || "").toLowerCase();
  const actionLower = (event.action || "").toLowerCase();

  let statusType: "approved" | "warning" | "in-progress" | "neutral" = "neutral";
  let statusLabel = event.action_display || "Recorded";

  if (
    summaryLower.includes("promot") ||
    summaryLower.includes("approv") ||
    summaryLower.includes("pass") ||
    summaryLower.includes("complete") ||
    actionLower.includes("promote") ||
    actionLower.includes("complete")
  ) {
    statusType = "approved";
    statusLabel = "Approved";
  } else if (
    summaryLower.includes("ready for review") ||
    summaryLower.includes("awaiting") ||
    summaryLower.includes("propos") ||
    summaryLower.includes("flag") ||
    summaryLower.includes("withdraw") ||
    actionLower.includes("propose")
  ) {
    statusType = "warning";
    statusLabel = "Awaiting review";
  } else if (
    summaryLower.includes("started") ||
    summaryLower.includes("progress") ||
    actionLower.includes("start")
  ) {
    statusType = "in-progress";
    statusLabel = "In progress";
  }

  // Target extraction: prefer actor_name or entity info from summary
  let targetName = event.actor_name || "System";
  if (event.entity_type === "Student" || event.entity_type === "GradingCandidate") {
    // If summary starts with or mentions a student/candidate name
    const match = event.summary.match(/^([^:]+):/);
    if (match) {
      targetName = match[1].trim();
    }
  }

  return {
    id: event.id,
    timeDisplay: formatRelativeTime(event.occurred_at),
    targetName,
    summary: event.summary,
    statusType,
    statusLabel,
  };
}

export function OverviewScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const canViewAudit = Boolean(user?.can_read_audit_log);

  const currentDateDisplay = useMemo(() => formatSessionDate(todayIsoDate()), []);

  // 1. Fetch grading sessions
  const sessionsQuery = useQuery({
    queryKey: ["gradingSessions", "all"],
    queryFn: () => getAllGradingSessions(),
  });

  const sessions = useMemo<GradingSession[]>(() => {
    return Array.isArray(sessionsQuery.data?.results)
      ? sessionsQuery.data.results
      : [];
  }, [sessionsQuery.data]);

  // Resolve current open session on the mat
  const openSession: GradingSession | undefined = useMemo(() => {
    return sessions.find((s) => s.status === "OPEN");
  }, [sessions]);

  // Resolve next upcoming session
  const upcomingSession: GradingSession | undefined = useMemo(() => {
    const today = todayIsoDate();
    const candidates = sessions
      .filter(
        (s) =>
          s.id !== openSession?.id &&
          s.status !== "CANCELLED" &&
          s.status !== "COMPLETED" &&
          s.grading_date >= today,
      )
      .sort((a, b) => a.grading_date.localeCompare(b.grading_date));
    return candidates[0];
  }, [sessions, openSession]);

  // 2. Fetch candidates for open session
  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", openSession?.id],
    queryFn: () => getAllGradingCandidates({ session: openSession!.id }),
    enabled: !!openSession,
  });

  // 3. Fetch assessments for open session
  const assessmentsQuery = useQuery({
    queryKey: ["candidateAssessments", openSession?.id],
    queryFn: () => getAllCandidateAssessments({ session: openSession!.id }),
    enabled: !!openSession,
  });

  // 4. Fetch recent audit events
  const auditQuery = useQuery({
    queryKey: ["auditEvents", "recent"],
    queryFn: () => getAuditEvents({ page_size: 6 }),
    enabled: canViewAudit,
    retry: false,
  });

  // Derived metrics for open session
  const candidates = useMemo<GradingCandidate[]>(() => {
    return Array.isArray(candidatesQuery.data?.results)
      ? candidatesQuery.data.results
      : [];
  }, [candidatesQuery.data]);

  const assessments = useMemo<CandidateAssessment[]>(() => {
    return Array.isArray(assessmentsQuery.data?.results)
      ? assessmentsQuery.data.results
      : [];
  }, [assessmentsQuery.data]);

  const candidatesCount = candidates.length;
  const completedAssessmentsCount = assessments.filter(
    (a) => a.status === "COMPLETED",
  ).length;

  // Assessments needing attention:
  // - Completed assessments awaiting proposal/decision
  // - Assessments in progress
  const attentionItems = useMemo(() => {
    return assessments
      .filter((a) => a.status === "COMPLETED" || a.status === "IN_PROGRESS")
      .map((a) => {
        let statusDescription = "Assessment in progress · Scoring pending";
        if (a.status === "COMPLETED") {
          statusDescription = "Assessment complete · Awaiting your review";
        }
        return {
          id: a.id,
          candidate_student_name: a.candidate_student_name,
          statusDescription,
          status: a.status,
        };
      })
      .slice(0, 4);
  }, [assessments]);

  const awaitingDecisionCount = assessments.filter(
    (a) => a.status === "COMPLETED",
  ).length;

  // Recent activity items
  const recentActivities: FormattedActivityItem[] = useMemo(() => {
    if (!Array.isArray(auditQuery.data?.results)) return [];
    return auditQuery.data.results.map(formatAuditEvent);
  }, [auditQuery.data]);

  const isInitialLoading =
    sessionsQuery.isLoading ||
    (canViewAudit && auditQuery.isLoading) ||
    (!!openSession && (candidatesQuery.isLoading || assessmentsQuery.isLoading));

  return (
    <section
      aria-labelledby="overview-heading"
      className="ledger-section overview-container"
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

      {sessionsQuery.isError ? (
        <div className="workspace-alert" role="alert">
          <p className="form-error">
            Failed to load operational ledger. Please check your connection.
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
                <span className="session-status-pill">
                  <span aria-hidden="true" className="status-dot" />
                  Open
                </span>
              </div>
              <p className="session-location">
                {openSession.location || "Colchester Dojang"}
              </p>

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

              <button
                className="action-button-gold"
                onClick={() => navigate("/gradings")}
                type="button"
              >
                Open session <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          ) : (
            <div className="card-empty-state">
              <p className="empty-state-title">No active grading session</p>
              <p className="empty-state-desc">
                No grading session in progress on the mat.
              </p>
              <button
                className="card-link-button"
                onClick={() => navigate("/gradings")}
                type="button"
              >
                View all gradings <span aria-hidden="true">&rarr;</span>
              </button>
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
                <div
                  className="attention-item-row"
                  key={item.id}
                  onClick={() => navigate("/gradings")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate("/gradings");
                    }
                  }}
                  role="listitem"
                  tabIndex={0}
                >
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
            <div
              className="upcoming-session-row"
              onClick={() => navigate("/gradings")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate("/gradings");
                }
              }}
              role="button"
              tabIndex={0}
            >
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
                <span className="upcoming-session-location">
                  {upcomingSession.location || "Colchester Dojang"}
                </span>
              </div>
              <span aria-hidden="true" className="chevron-icon">
                &rsaquo;
              </span>
            </div>
          ) : (
            <div className="card-empty-state">
              <p className="empty-state-title">No upcoming gradings</p>
              <p className="empty-state-desc">
                No future grading sessions are currently scheduled.
              </p>
              <button
                className="card-link-button"
                onClick={() => navigate("/gradings")}
                type="button"
              >
                Schedule a grading <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Recent Activity */}
      <div className="recent-activity-section">
        <div className="activity-section-header">
          <h2 className="activity-section-title">Recent activity</h2>
          {canViewAudit ? (
            <button
              className="view-all-activity-link"
              onClick={() => navigate("/audit")}
              type="button"
            >
              View all activity <span aria-hidden="true">&rarr;</span>
            </button>
          ) : null}
        </div>

        {recentActivities.length > 0 ? (
          <div className="ledger-table-wrapper">
            <table className="ledger-table" aria-label="Recent activity ledger">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Student</th>
                  <th scope="col">Event</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentActivities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="cell-time">{activity.timeDisplay}</td>
                    <td className="cell-student">
                      <strong>{activity.targetName}</strong>
                    </td>
                    <td className="cell-event">{activity.summary}</td>
                    <td className="cell-status">
                      <span
                        className={`status-pill-badge status-pill-${activity.statusType}`}
                      >
                        {activity.statusType === "approved" ? (
                          <CheckIcon size={14} className="overview-icon" />
                        ) : activity.statusType === "warning" ? (
                          <AlertIcon />
                        ) : activity.statusType === "in-progress" ? (
                          <ClockIcon />
                        ) : null}
                        <span>{activity.statusLabel}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="activity-empty-state" role="status">
            <p>
              {isInitialLoading
                ? "Loading activity ledger..."
                : "No recent activity recorded."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
