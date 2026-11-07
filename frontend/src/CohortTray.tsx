import { Link } from "react-router-dom";

import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import type { cohortBreakdown } from "./cohortBuilder";
import { RankFlow } from "./CohortRank";
import { ResponsiveTable } from "./ResponsiveTable";

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
export function CohortTray({ sessionId, count, breakdown, generateAssessments, onGenerateAssessments, submitting, onRegister, onRemoveGroup, onReview }: CohortTrayProps) {
  return (
          <aside className="bgc-section" aria-labelledby="bgc-tray-heading">
            <div className="action-row">
              <h2 id="bgc-tray-heading" className="section-title">Cohort to register</h2>
              <span className="bgc-cohort-count" data-testid="bgc-cohort-count">
                {count} candidate{count === 1 ? "" : "s"} selected
              </span>
            </div>
            <p className="bgc-section-subtext">
              The groups added so far, by rank.
            </p>

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
                      <RankFlow from={item.currentRank} to={item.destinationRank} />
                    ),
                  },
                  { key: "count", header: "Count", render: (item) => <span className="bgc-tray-count">{item.count}</span> },
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
              <div className="bgc-exceptions-callout">
                <Button
                  variant="link"
                  onClick={() => onReview()}
                  disabled={count === 0}
                  data-testid="bgc-review-exceptions-btn"
                >
                  Review exceptions →
                </Button>
                <p className="bgc-exceptions-help">
                  Remove individual students from the selected roster before registering. Only needed if there are exceptions.
                </p>
              </div>

              {/* Assessment form pre-generation toggle */}
              <div className="bgc-assessment-toggle-row">
                <label className="bgc-switch-label" htmlFor="bgc-assessments-toggle">
                  <div className="bgc-switch">
                    <input
                      id="bgc-assessments-toggle"
                      type="checkbox"
                      checked={generateAssessments}
                      onChange={(e) => onGenerateAssessments(e.target.checked)}
                      data-testid="bgc-assessments-toggle"
                    />
                    <span className="bgc-switch-slider" aria-hidden="true" />
                  </div>
                  <div className="bgc-switch-text">
                    <span className="bgc-switch-title">Prepare assessment forms now</span>
                    <span className="bgc-switch-desc">Forms will be created as Not started.</span>
                  </div>
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
                  variant="primary" className="bgc-tray-primary"
                  onClick={onRegister}
                  disabled={submitting || count === 0}
                  data-testid="bgc-register-candidates-btn"
                >
                  {submitting ? "Registering..." : `Register ${count} candidate${count === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </aside>
  );
}
