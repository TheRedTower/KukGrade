import { useMemo } from "react";
import { keys } from "./queryKeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import {
  type AuditEvent,
  type CandidateAssessment,
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
import { AlertCircleIcon, CalendarIcon, CheckCircleIcon, CheckIcon, ClockIcon } from "./Icons";
import { eventSummary } from "./auditText";
import { ResponsiveTable } from "./ResponsiveTable";
import { PageHeader } from "./PageHeader";
import { SessionStatusBadge } from "./StatusBadge";
import { Badge } from "./Badge";

type FormattedActivityItem = {
  id: number;
  timeDisplay: string;
  actorName: string;
  summary: string;
  statusType: AuditEvent["tone"];
  statusLabel: string;
};

/** The server says how an event reads and which outcome it records. */
function formatAuditEvent(event: AuditEvent): FormattedActivityItem {
  return {
    id: event.id,
    timeDisplay: formatRecentTime(event.occurred_at),
    actorName: event.actor_name || event.actor_email || "System",
    summary: eventSummary(event),
    statusType: event.tone,
    statusLabel: event.outcome_display ? `${event.action_display} · ${event.outcome_display}` : event.action_display,
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
  const upcomingSession: GradingSession | undefined = upcomingQuery.data?.results.find((s) => s.id !== openSession?.id);

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
    return assessmentsQuery.data?.results ?? [];
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
    return (auditQuery.data?.results ?? []).map(formatAuditEvent);
  }, [auditQuery.data]);

  const isInitialLoading =
    openQuery.isLoading ||
    upcomingQuery.isLoading ||
    (canViewAudit && auditQuery.isLoading) ||
    (!!openSession && assessmentsQuery.isLoading);

  return (
    <section aria-labelledby="overview-heading" className="page">
      <PageHeader
        title="Overview"
        titleId="overview-heading"
        subtitle={currentDateDisplay}
        actions={
          <div aria-hidden="true" className="overview-motto eyebrow--muted">
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
        <section className="card">
          <h2 className="section-title section-title--ruled">Now</h2>

          {openSession ? (
            <div className="stack">
              <div>
                <div className="action-row">
                  <h3 className="session-title">{openSession.title}</h3>
                  <SessionStatusBadge status={openSession.status} label={openSession.status_display} />
                </div>
                {openSession.location && <p className="session-location subtext">{openSession.location}</p>}
              </div>

              <div className="stats">
                <div className="stat">
                  <span className="stat__value">{candidatesCount}</span>
                  <span className="stat__label">Candidates</span>
                </div>
                <div className="stat">
                  <span className="stat__value">
                    {completedAssessmentsCount} / {candidatesCount}
                  </span>
                  <span className="stat__label">Assessments complete</span>
                </div>
                <div className="stat">
                  <span className="stat__value">{awaitingDecisionCount}</span>
                  <span className="stat__label">Awaiting final decision</span>
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
        </section>

        {/* Card 2: Needs attention */}
        <section className="card">
          <h2 className="section-title section-title--ruled">Needs attention</h2>

          {attentionItems.length > 0 ? (
            <div className="attention-list" role="list">
              {attentionItems.map((item) => (
                <div key={item.id} role="listitem">
                  <Link className="attention-item-row" to={item.path}>
                    <span aria-hidden="true" className="mark" data-tone="warning">
                      !
                    </span>
                    <div className="attention-item-info">
                      <strong className="item-title">{item.candidate_student_name}</strong>
                      <span className="meta">{item.statusDescription}</span>
                    </div>
                    <span aria-hidden="true" className="chevron-icon">
                      &rsaquo;
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              fill
              icon={
                <span className="all-clear-icon">
                  <CheckCircleIcon className="overview-icon" size={20} />
                </span>
              }
              title="All clear"
            >
              No candidate assessments currently requiring review.
            </EmptyState>
          )}
        </section>

        {/* Card 3: Upcoming */}
        <section className="card">
          <h2 className="section-title section-title--ruled">Upcoming</h2>

          {upcomingSession ? (
            <Link className="upcoming-session-row" to={`/gradings/${upcomingSession.id}`}>
              <div aria-hidden="true" className="calendar-icon-box">
                <CalendarIcon className="overview-icon" size={20} />
              </div>
              <div className="upcoming-session-info">
                <strong className="item-title">{upcomingSession.title}</strong>
                <span className="upcoming-session-date meta">{formatSessionDate(upcomingSession.grading_date)}</span>
                {upcomingSession.location && <span className="meta">{upcomingSession.location}</span>}
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
        </section>
      </div>

      {/* Bottom Section: Recent Activity - the audit log's latest entries,
          so only for someone who may read it; nobody else is told there is
          nothing. */}
      {canViewAudit && (
        <section className="stack">
          <div className="action-row">
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
                {
                  key: "time",
                  header: "Time",
                  render: (activity) => <span className="meta">{activity.timeDisplay}</span>,
                },
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
                          <AlertCircleIcon className="overview-icon" size={14} />
                        ) : activity.statusType === "info" ? (
                          <ClockIcon className="overview-icon" size={14} />
                        ) : null
                      }
                    >
                      {activity.statusLabel}
                    </Badge>
                  ),
                },
              ]}
            />
          ) : isInitialLoading ? (
            <LoadingState>Loading recent activity…</LoadingState>
          ) : (
            <EmptyState title="No recent activity recorded." />
          )}
        </section>
      )}
    </section>
  );
}
