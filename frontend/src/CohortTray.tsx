import { Link } from "react-router-dom";

import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import type { cohortBreakdown } from "./cohortBuilder";
import { RankTransition, rankEnd } from "./RankTransition";
import { ResponsiveTable } from "./ResponsiveTable";
import { counted } from "./plural";

interface CohortTrayProps {
  sessionId: number;
  count: number;
  breakdown: ReturnType<typeof cohortBreakdown>;
  generateAssessments: boolean;
  onGenerateAssessments: (generate: boolean) => void;
  submitting: boolean;
  onRegister: () => void;
  onRemoveGroup: (rankId: number) => void;
  onReview: () => void;
}

/** The cohort so far, by rank, and the button that registers it. */
export function CohortTray({
  sessionId,
  count,
  breakdown,
  generateAssessments,
  onGenerateAssessments,
  submitting,
  onRegister,
  onRemoveGroup,
  onReview,
}: CohortTrayProps) {
  return (
    <aside className="stack stack--3" aria-labelledby="bgc-tray-heading">
      <div className="action-row">
        <h2 id="bgc-tray-heading" className="section-title">
          Cohort to register
        </h2>
        <span className="bgc-cohort-count item-title" data-testid="bgc-cohort-count">
          {counted(count, "candidate", "candidates")} selected
        </span>
      </div>
      <p className="bgc-section-subtext">The groups added so far, by rank.</p>

      <div className="card stack">
        {/* Selected groups table */}
        <ResponsiveTable
          label="Selected cohort groups"
          rows={breakdown}
          rowKey={(item) => item.rankId}
          empty="No rank groups added yet. Add a group from the left panel to begin."
          columns={[
            {
              key: "rank",
              header: "Rank",
              primary: true,
              render: (item) => (
                <RankTransition
                  from={{ rank: item.currentRank, name: item.currentRank?.name ?? "Unknown" }}
                  to={rankEnd(item.destinationRank)}
                />
              ),
            },
            { key: "count", header: "Count", render: (item) => <span className="item-title">{item.count}</span> },
            {
              key: "remove",
              header: "Remove",
              actions: "inline",
              render: (item) => (
                <Button
                  variant="danger-quiet"
                  small
                  onClick={() => onRemoveGroup(item.rankId)}
                  aria-label={`Remove ${item.currentRank?.name} group`}
                >
                  ✕
                </Button>
              ),
            },
          ]}
        />

        {/* Review exceptions link */}
        <div className="stack stack--1 bgc-exceptions-callout">
          <Button
            variant="link"
            onClick={() => onReview()}
            disabled={count === 0}
            data-testid="bgc-review-exceptions-btn"
          >
            Review exceptions →
          </Button>
          <p className="bgc-exceptions-help meta">
            Remove individual students from the selected roster before registering. Only needed if there are exceptions.
          </p>
        </div>

        {/* Prepare the assessment forms with the registrations */}
        <div className="bgc-assessment-toggle-row">
          <label className="check">
            <input
              type="checkbox"
              checked={generateAssessments}
              onChange={(e) => onGenerateAssessments(e.target.checked)}
              data-testid="bgc-assessments-toggle"
            />
            <span className="check__text">
              <span className="item-title">Prepare assessment forms now</span>
              <span className="meta">Forms will be created as Not started.</span>
            </span>
          </label>
        </div>

        {/* Action buttons */}
        <div className="action-row">
          <Link
            to={`/gradings/${sessionId}`}
            className={buttonClass({ variant: "ghost" })}
            data-testid="bgc-cancel-btn"
          >
            Cancel
          </Link>
          <Button
            variant="primary"
            className="bgc-tray-primary"
            onClick={onRegister}
            disabled={submitting || count === 0}
            data-testid="bgc-register-candidates-btn"
          >
            {submitting ? "Registering..." : `Register ${counted(count, "candidate", "candidates")}`}
          </Button>
        </div>
      </div>
    </aside>
  );
}
