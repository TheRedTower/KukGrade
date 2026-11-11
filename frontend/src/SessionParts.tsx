import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { GradingSession, GradingSessionStatus } from "./api";
import type { EnrichedCandidate } from "./sessionDetail";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { formatSessionDate } from "./dates";
import { labelOf, useChoices } from "./choices";
import { AssessmentBadge, OutcomeBadge } from "./StatusBadge";
import { CandidateRanks } from "./RankTransition";

/** A session's candidate with their assessment and outcome, as the session page shows them. */
/** What a candidate's row offers next: a link, the proposal drawer, or nothing (no url). */
export interface NextAction {
  label: string;
  url: string | null;
  opensProposalDrawer: boolean;
}

/** When and where a session is held, as one line reads it under a page's title. */
export function SessionFacts({ session }: { session: Pick<GradingSession, "grading_date" | "location"> }) {
  return (
    <>
      <span>{formatSessionDate(session.grading_date)}</span> <span aria-hidden="true">·</span>{" "}
      <span>{session.location || "No location specified"}</span>
    </>
  );
}

const STAGES = ["DRAFT", "OPEN", "LOCKED", "COMPLETED"] as const;

/** The four stages a session moves through, with the one it is at. A cancelled session is at none. */
export function SessionLifecycle({ status = "DRAFT" }: { status?: GradingSessionStatus }) {
  const statuses = useChoices().session_statuses;
  const currentIndex = STAGES.indexOf(status as (typeof STAGES)[number]);
  return (
    <section className="card" aria-label="Session progress">
      <div className="gsd-lifecycle-track">
        {STAGES.map((key, index) => {
          const state = currentIndex > index ? "completed" : currentIndex === index ? "current" : "upcoming";
          return (
            <div key={key} className={`row row--3 gsd-step-${state}`}>
              <div className="mark mark--small gsd-step-circle" aria-hidden="true">
                {state === "completed" && "✓"}
              </div>
              <div className="gsd-step-content">
                <span className="item-title">{labelOf(statuses, key)}</span>
                <span className="meta">
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
    <section aria-labelledby="notes-heading">
      <div className="card stack stack--4">
        <div className="action-row gsd-notes-header">
          <div>
            <h2 id="notes-heading" className="gsd-notes-title section-title">Session notes</h2>
            <p className="gsd-notes-sub subtext">
              Everyone who can open this grading can read these notes.
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
            <form onSubmit={save} className="stack stack--3">
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
                <p className="gsd-notes-empty subtext">No notes recorded for this session.</p>
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
  nextActionFor,
  onPropose,
  onMove,
  onRemove,
  onWithdraw,
}: {
  candidates: EnrichedCandidate[];
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
              <span className="gsd-candidate-name item-title">{item.candidate.student_display_name}</span>
              {item.candidate.student_wksa_id && (
                <span className="gsd-candidate-wksa meta">WKSA: {item.candidate.student_wksa_id}</span>
              )}
              {/* Why they withdrew sits with the person, so the status pill stands
                  alone in its cell, on the row's line with the other pills. */}
              {item.candidate.status === "WITHDRAWN" && (
                <span className="gsd-withdrawal-record meta">
                  {item.candidate.withdrawal_reason_display && (
                    <span>{item.candidate.withdrawal_reason_display}</span>
                  )}
                  {item.candidate.withdrawal_note && <span>{item.candidate.withdrawal_note}</span>}
                </span>
              )}
            </>
          ),
        },
        {
          key: "ranks",
          header: "Rank",
          render: (item) => (
            // The rank held at registration, not the live current rank.
            <CandidateRanks candidate={item.candidate} />
          ),
        },
        {
          key: "assessment",
          header: "Assessment",
          render: (item) =>
            item.candidate.status === "WITHDRAWN" ? (
              <Badge tone="neutral">Withdrawn</Badge>
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
            const next = nextActionFor(item);
            return (
              <>
                {next.url === null ? (
                  <span className="meta">{next.label}</span>
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
                {item.candidate.can_be_withdrawn_after_lock && (
                  <Button
                    variant="danger-quiet" small
                    onClick={() => onWithdraw(item)}
                    aria-label={`Withdraw ${item.candidate.student_display_name}`}
                  >
                    Withdraw
                  </Button>
                )}
              </>
            );
          },
        },
      ]}
    />
  );
}
