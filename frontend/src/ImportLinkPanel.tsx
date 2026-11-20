import { Link } from "react-router-dom";

import { errorMessage, type DataImportBatch } from "./api";
import { useAuth } from "./auth";
import { buttonClass } from "./buttonClass";
import { ErrorText } from "./ErrorText";
import { LoadingState } from "./LoadingState";
import { peoplePath } from "./peopleLists";
import { counted } from "./plural";
import { Progress } from "./Progress";
import { usePeopleSummary } from "./usePerson";

/** Past gradings: the next job, sorting the people their records are about. */
export function LinkPanel({ batch }: { batch: DataImportBatch }) {
  const { user } = useAuth();
  const canSort = Boolean(user?.can_reconcile_imported_history);
  const summary = usePeopleSummary(batch.id, canSort);
  const counts = summary.data;
  const left = counts ? counts.people - counts.sorted : 0;

  return (
    <section aria-labelledby="ix-link-h" className="card stack stack--3 ix-gold-edge">
      <p className="ix-eyebrow eyebrow">Next job</p>
      <h2 className="ix-title" id="ix-link-h">
        Who is each person?
      </h2>
      <p className="subtext">
        KukGrade grouped the records into the people they are about. Nothing is linked to a student until you say so.
      </p>
      {!canSort ? null : summary.isPending ? (
        <LoadingState compact>Counting the people…</LoadingState>
      ) : summary.isError ? (
        <ErrorText>{errorMessage(summary.error, "The people could not be counted.")}</ErrorText>
      ) : counts ? (
        <>
          <Progress done={counts.sorted} total={counts.people} what="people sorted" />
          <p className="ix-flush">
            {left ? (
              <>
                <strong>{counted(left, "person", "people")}</strong> still to sort
              </>
            ) : (
              "Every person from this import is sorted."
            )}
          </p>
        </>
      ) : null}
      {canSort ? (
        <div>
          <Link
            className={buttonClass({ variant: left ? "primary" : "secondary" })}
            to={peoplePath({ batch: batch.id })}
          >
            Sort the people
          </Link>
        </div>
      ) : (
        <p className="subtext">An administrator sorts the people.</p>
      )}
    </section>
  );
}
