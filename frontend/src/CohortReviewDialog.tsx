import { Button } from "./Button";
import type { CohortItem } from "./cohortBuilder";
import { Dialog } from "./Dialog";
import { StudentStatusBadge } from "./StatusBadge";

interface CohortReviewDialogProps {
  cohort: CohortItem[];
  onRemove: (studentId: number) => void;
  onClose: () => void;
}

/** Every student in the cohort, each with a way to take them out. */
export function CohortReviewDialog({ cohort, onRemove, onClose }: CohortReviewDialogProps) {
  return (
        <Dialog
          title={`Review cohort candidates (${cohort.length})`}
          onClose={onClose}
        >
          <p className="gsd-modal-message subtext">
            Remove individual students who should not be registered in this grading cohort.
          </p>

          <ul className="bgc-modal-list">
            {cohort.map((item) => (
              <li key={item.student.id} className="bgc-modal-list-item">
                <div className="bgc-modal-student-info">
                  <span className="item-title">
                    {item.student.first_name} {item.student.last_name}
                  </span>
                  <span className="meta">{item.student.wksa_id}</span>
                  <span className="meta">
                    {item.currentRank?.name} ➔ {item.destinationRank?.name || "—"}
                  </span>
                  <StudentStatusBadge status={item.student.status} label={item.student.status_display} />
                </div>
                <Button
                  variant="danger-quiet" small
                  onClick={() => onRemove(item.student.id)}
                  data-testid={`bgc-remove-student-${item.student.id}`}
                >
                  ✕ Remove
                </Button>
              </li>
            ))}
          </ul>

          <div className="action-row dialog__actions">
            <Button
              variant="primary"
              onClick={onClose}
              data-testid="bgc-modal-done-btn"
              data-dialog-autofocus
            >
              Done
            </Button>
          </div>
        </Dialog>
  );
}
