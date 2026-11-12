import { Badge } from "./Badge";
import { Button } from "./Button";
import type { RankGroup } from "./cohortBuilder";
import { RankTransition, rankEnd } from "./RankTransition";
import { ResponsiveTable } from "./ResponsiveTable";
import { CheckIcon } from "./Icons";

interface CohortRankGroupsSectionProps {
  groups: RankGroup[];
  /** How many students the filters leave, to say why there are no groups. */
  filteredCount: number;
  inCohort: Set<number>;
  onAddGroup: (group: RankGroup) => void;
  onRemoveGroup: (rankId: number) => void;
}

/** Step 2: add everyone who holds a rank in one go. */
export function CohortRankGroupsSection({
  groups,
  filteredCount,
  inCohort,
  onAddGroup,
  onRemoveGroup,
}: CohortRankGroupsSectionProps) {
  return (
    <section className="stack stack--3" aria-labelledby="bgc-rank-groups-heading">
      <h2 id="bgc-rank-groups-heading" className="section-title">
        2. Add whole rank groups
      </h2>
      <p className="bgc-section-subtext">
        Students are grouped by their current rank. Add whole groups to register them for the next rank.
      </p>

      <ResponsiveTable
        label="Eligible rank groups"
        rows={groups}
        rowKey={(group) => group.rank.id}
        empty={
          filteredCount === 0
            ? "No eligible students match the selected filters."
            : "No eligible students found to register."
        }
        columns={[
          {
            key: "rank",
            header: "Rank",
            primary: true,
            render: (group) => (
              <RankTransition from={{ rank: group.rank, name: group.rank.name }} to={rankEnd(group.destinationRank)} />
            ),
          },
          {
            key: "age-mix",
            header: "Age mix",
            render: (group) => (
              <Badge tone="neutral">
                {group.programmeCounts.map((entry) => `${entry.label} ${entry.count}`).join(" | ")}
              </Badge>
            ),
          },
          {
            key: "eligible",
            header: "Eligible",
            render: (group) => (
              <div className="bgc-eligible-count-cell">
                <span className="item-title">{group.students.length}</span>
                <span className="meta">
                  ({group.activeCount} active
                  {group.inactiveCount > 0 && (
                    <>
                      , <span className="bgc-inactive-alert">{group.inactiveCount} inactive</span>
                    </>
                  )}
                  )
                </span>
              </div>
            ),
          },
          {
            key: "action",
            header: "Action",
            actions: "inline",
            render: (group) => {
              const allGroupAdded = group.students.every((student) => inCohort.has(student.id));
              const someGroupAdded = group.students.some((student) => inCohort.has(student.id));
              return allGroupAdded ? (
                <Button
                  variant="ghost"
                  small
                  onClick={() => onRemoveGroup(group.rank.id)}
                  aria-label={`Added: remove the ${group.rank.name} group from the cohort`}
                  title="Click to remove the group"
                  data-testid={`bgc-group-added-${group.rank.id}`}
                >
                  Added <CheckIcon />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  small
                  onClick={() => onAddGroup(group)}
                  data-testid={`bgc-add-group-${group.rank.id}`}
                >
                  {someGroupAdded ? `Add remaining` : `Add all ${group.students.length}`}
                </Button>
              );
            },
          },
        ]}
      />
    </section>
  );
}
