import { useState, type ReactNode } from "react";
import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { Link } from "react-router-dom";
import { type DataImportBatch } from "./api";
import { useAuth } from "./auth";
import { formatShortDateTime } from "./dates";
import { counted, importKindLabel } from "./importSteps";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { LinkPanel } from "./ImportLinkPanel";
import { type RowFilter, RowsLedger } from "./ImportRowsLedger";
import { SecondLook } from "./ImportSecondLook";
import { VoidDialog } from "./ImportVoidDialog";

/** One more thing to do from the results page, in the side panel. */
function AlsoItem({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="ix-section ix-also">
      <p className="ix-bold">{title}</p>
      <p className="ix-muted ix-small">{body}</p>
      {children}
    </div>
  );
}

/** An import's results: its own page, with the next job on top. */
export function ImportResults({ batch }: { batch: DataImportBatch }) {
  const { user } = useAuth();
  const roster = batch.kind === "STUDENT_ROSTER";
  const [filter, setFilter] = useState<RowFilter>("all");
  const [voiding, setVoiding] = useState(false);
  const summary = batch.summary_json;
  const created = summary.created ?? 0;
  const total = summary.total ?? 0;

  const headline = roster
    ? `${counted(created, "student", "students")} added`
    : `${counted(total, "historical record", "historical records")} imported`;
  const banner = (
    roster
      ? [
          summary.skipped_existing
            ? `${counted(summary.skipped_existing, "student", "students")} already in KukGrade ${summary.skipped_existing === 1 ? "was" : "were"} skipped and not changed.`
            : null,
          summary.excluded
            ? `${counted(summary.excluded, "row", "rows")} you left out ${summary.excluded === 1 ? "was" : "were"} not imported.`
            : null,
        ]
      : [
          summary.excluded
            ? `${counted(summary.excluded, "record", "records")} you left out ${summary.excluded === 1 ? "was" : "were"} not imported.`
            : null,
        ]
  ).filter(Boolean);
  const unresolvedRanks = (summary.unresolved_current_rank ?? 0) + (summary.unresolved_testing_for_rank ?? 0);

  return (
    <section aria-labelledby="ix-results-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title={batch.original_filename}
        titleId="ix-results-title"
        tag={<Badge tone="success">Imported</Badge>}
        subtitle={`${importKindLabel(batch.kind)} · imported by ${batch.committed_by_name} on ${formatShortDateTime(batch.committed_at)}`}
      />

      <div className="ix-banner ix-banner-success" role="status">
        <span aria-hidden="true" className="ix-mark ix-mark-ok ix-mark-large ix-mark-on-surface">
          ✓
        </span>
        <p>
          <strong className="ix-headline">{headline}</strong>
          {banner.length ? <span className="ix-small ix-block">{banner.join(" ")}</span> : null}
        </p>
      </div>

      {roster ? <SecondLook batch={batch} onShow={setFilter} /> : <LinkPanel batch={batch} />}

      <div className="ix-two-col">
        <RowsLedger batch={batch} filter={filter} onFilter={setFilter} />
        <aside aria-labelledby="ix-also-h" className="card ix-section">
          <h2 className="ix-minor" id="ix-also-h">
            Also
          </h2>
          {roster ? (
            <>
              <AlsoItem body="The Students page, showing only those this import added." title="See the new students">
                <Link className={buttonClass({ variant: "secondary" }, "ix-start")} to={`/students?source_import=${batch.id}`}>
                  Go to Students
                </Link>
              </AlsoItem>
              <AlsoItem body="Import the grading record workbook, then link it to these students." title="Bring in their past gradings">
                <Link className={buttonClass({ variant: "secondary" }, "ix-start")} to="/imports/new?kind=LEGACY_GRADINGS">
                  Import past gradings
                </Link>
              </AlsoItem>
            </>
          ) : (
            <>
              {unresolvedRanks ? (
                <AlsoItem body={`${counted(unresolvedRanks, "rank is", "ranks are")} still as written in the workbook.`} title="Match the last ranks">
                  <Link className={buttonClass({ variant: "secondary" }, "ix-start")} to="/imports/records">
                    Match ranks
                  </Link>
                </AlsoItem>
              ) : null}
              {user?.can_reconcile_imported_history ? (
                <AlsoItem body="Void the whole import. Its records are kept, marked void, with your reason." title="Wrong workbook?">
                  <Button variant="ghost" className="ix-danger-text ix-start" onClick={() => setVoiding(true)}>
                    Void this import
                  </Button>
                </AlsoItem>
              ) : null}
            </>
          )}
        </aside>
      </div>
      {voiding ? <VoidDialog batch={batch} onClose={() => setVoiding(false)} /> : null}
    </section>
  );
}
