import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { CandidateAssessment, CandidateOutcome, GradingCandidate, GradingSessionStatus } from "./api";
import { Badge } from "./Badge";
import { RankBelt } from "./Belt";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { SESSION_STATUS_LABELS } from "./sessionStatus";
import { AssessmentBadge, OutcomeBadge } from "./StatusBadge";

/** A session's candidate with their assessment and outcome, as the session page shows them. */
export interface EnrichedCandidate {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome;
}

/** What a candidate's row offers next: a link, or the proposal drawer. */
interface NextAction {
  label: string;
  url: string;
  opensProposalDrawer: boolean;
}

const STAGES = ["DRAFT", "OPEN", "LOCKED", "COMPLETED"] as const;

/** The four stages a session moves through, with the one it is at. A cancelled session is at none. */
export function SessionLifecycle({ status = "DRAFT" }: { status?: GradingSessionStatus }) {
  const currentIndex = STAGES.indexOf(status as (typeof STAGES)[number]);
  return (
    <section className="gsd-lifecycle-section" aria-label="Session progress">
      <div className="gsd-lifecycle-track">
        {STAGES.map((key, index) => {
          const state = currentIndex > index ? "completed" : currentIndex === index ? "current" : "upcoming";
          return (
            <div key={key} className={`gsd-lifecycle-step gsd-step-${state}`}>
              <div className="gsd-step-circle" aria-hidden="true">
                {state === "completed" && "✓"}
              </div>
              <div className="gsd-step-content">
                <span className="gsd-step-label">{SESSION_STATUS_LABELS[key]}</span>
                <span className="gsd-step-subtext">
                  {state === "completed" ? "Completed" : state === "current" ? "Current" : "Upcoming"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The session's notes, read, or edited in place; `saved` closes the editor once they are kept. */
export function SessionNotes({
  notes,
  saving,
  onSave,
}: {
  notes: string | null | undefined;
  saving: boolean;
  onSave: (notes: string, saved: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    onSave(draft, () => setEditing(false));
  }

  return (
    <section className="gsd-notes-section" aria-labelledby="notes-heading">
      <div className="gsd-notes-card">
        <div className="action-row gsd-notes-header">
          <div>
            <h2 id="notes-heading" className="gsd-notes-title">Session notes</h2>
            <p className="gsd-notes-sub">
              Notes are only visible to authorised instructors for this session.
            </p>
          </div>
          {!editing && (
            <Button
              variant="ghost" small
              onClick={() => {
                setEditing(true);
                setDraft(notes || "");
              }}
              data-testid="gsd-edit-notes-btn"
            >
              <span aria-hidden="true">📝</span> {notes ? "Edit notes" : "Add note"}
            </Button>
          )}
        </div>

        <div>
          {editing ? (
            <form onSubmit={save} className="gsd-notes-form">
              <textarea
                className="gsd-notes-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Enter notes, observations, or logistics for this grading session..."
                rows={4}
                data-testid="gsd-notes-textarea"
              />
              <div className="action-row gsd-notes-actions">
                <Button type="submit" variant="primary" disabled={saving} data-testid="gsd-save-notes-btn">
                  {saving ? "Saving..." : "Save notes"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(notes || "");
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              {notes ? (
                <p className="gsd-notes-text">{notes}</p>
              ) : (
                <p className="gsd-notes-empty">No notes recorded for this session.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** The session's candidates: ranks, assessment, outcome and what each row offers next. */
export function SessionCandidateTable({
  candidates,
  sessionStatus,
  canOverrideLocked,
  nextActionFor,
  onPropose,
  onMove,
  onRemove,
  onWithdraw,
}: {
  candidates: EnrichedCandidate[];
  sessionStatus?: GradingSessionStatus;
  canOverrideLocked: boolean;
  nextActionFor: (item: EnrichedCandidate) => NextAction;
  onPropose: (item: EnrichedCandidate) => void;
  onMove: (item: EnrichedCandidate) => void;
  onRemove: (item: EnrichedCandidate) => void;
  onWithdraw: (item: EnrichedCandidate) => void;
}) {
  return (
    <ResponsiveTable
      label="Candidates"
      testId="gsd-candidates-table"
      rows={candidates}
      rowKey={(item) => item.candidate.id}
      rowTestId={(item) => `candidate-row-${item.candidate.id}`}
      columns={[
        {
          key: "candidate",
          header: "Candidate",
          primary: true,
          render: (item) => (
            <>
              <span className="gsd-candidate-name">{item.candidate.student_display_name}</span>
              {item.candidate.student_wksa_id && (
                <span className="gsd-candidate-wksa">WKSA: {item.candidate.student_wksa_id}</span>
              )}
            </>
          ),
        },
        {
          key: "ranks",
          header: "Rank",
          render: (item) => (
            <div className="gsd-rank-flow">
              {/* The rank held at registration, not the live current rank. */}
              <span className="gsd-rank-item">
                <RankBelt rankId={item.candidate.from_rank} />
                <span>{item.candidate.from_rank_name}</span>
              </span>
              <span aria-hidden="true">→</span>
              <span className="visually-hidden">, grading for: </span>
              <span className="gsd-rank-item">
                <RankBelt rankId={item.candidate.testing_for_rank} />
                <span>{item.candidate.testing_for_rank_name}</span>
              </span>
            </div>
          ),
        },
        {
          key: "assessment",
          header: "Assessment",
          render: (item) =>
            item.candidate.status === "WITHDRAWN" ? (
              <>
                <Badge tone="neutral">Withdrawn</Badge>
                <span className="gsd-withdrawal-record">
                  {item.candidate.withdrawal_reason_display && (
                    <span>{item.candidate.withdrawal_reason_display}</span>
                  )}
                  {item.candidate.withdrawal_note && <span>{item.candidate.withdrawal_note}</span>}
                </span>
              </>
            ) : (
              <AssessmentBadge assessment={item.assessment} />
            ),
        },
        {
          key: "outcome",
          header: "Outcome",
          render: (item) =>
            item.candidate.status === "WITHDRAWN" ? (
              <Badge tone="neutral">No outcome</Badge>
            ) : (
              <OutcomeBadge outcome={item.outcome} />
            ),
        },
        {
          key: "action",
          header: "Next action",
          actions: true,
          render: (item) => {
            const candidateId = item.candidate.id;
            const outcomeStatus = item.outcome?.status;
            const isWithdrawn = item.candidate.status === "WITHDRAWN";
            const canWithdrawLocked =
              sessionStatus === "LOCKED" &&
              canOverrideLocked &&
              !isWithdrawn &&
              outcomeStatus !== "FINALISED";
            const next = nextActionFor(item);
            return (
              <div className="gsd-row-actions">
                {isWithdrawn ? (
                  <span className="gsd-withdrawal-record">No further action</span>
                ) : next.opensProposalDrawer ? (
                  <Button
                    variant="ghost" small
                    onClick={() => onPropose(item)}
                    data-testid={`propose-outcome-btn-${candidateId}`}
                  >
                    {next.label}
                  </Button>
                ) : (
                  <Link to={next.url} className={buttonClass({ variant: "ghost", small: true })}>
                    {next.label}
                  </Link>
                )}
                {item.candidate.can_be_moved && (
                  <Button
                    variant="ghost" small
                    onClick={() => onMove(item)}
                    aria-label={`Move ${item.candidate.student_display_name} to another session`}
                  >
                    Move…
                  </Button>
                )}
                {item.candidate.can_be_removed && (
                  <Button
                    variant="danger-quiet" small
                    onClick={() => onRemove(item)}
                    aria-label={`Remove ${item.candidate.student_display_name}'s registration`}
                  >
                    Remove
                  </Button>
                )}
                {canWithdrawLocked && (
                  <Button
                    variant="danger-quiet" small
                    onClick={() => onWithdraw(item)}
                  >
                    Withdraw candidate
                  </Button>
                )}
              </div>
            );
          },
        },
      ]}
    />
  );
}
