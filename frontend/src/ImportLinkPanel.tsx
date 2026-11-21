import { Link } from "react-router-dom";

import { errorMessage, type DataImportBatch } from "./api";
import { useAuth } from "./auth";
import { buttonClass } from "./buttonClass";
import { ErrorText } from "./ErrorText";
import { LoadingState } from "./LoadingState";
import { peoplePath } from "./peopleLists";
import { agreeing, counted } from "./plural";
import { Progress } from "./Progress";
import { usePeopleSummary } from "./usePerson";

/** Past gradings: the next job, sorting the people their records are about, and how far it has gone. */
export function LinkPanel({ batch }: { batch: DataImportBatch }) {
  const { user } = useAuth();
  const canSort = Boolean(user?.can_reconcile_imported_history);
  const summary = usePeopleSummary(batch.id, canSort);
  const counts = summary.data;
  const left = counts ? counts.people - counts.sorted : 0;
  const lines = counts
    ? [
        counts.linked ? `${counted(counts.linked, "person", "people")} linked to a student` : null,
        counts.not_a_student
          ? `${counted(counts.not_a_student, "person", "people")} not ${agreeing(counts.not_a_student, "a current student", "current students")}`
          : null,
        counts.later ? `${counted(counts.later, "person", "people")} left for later` : null,
      ].filter(Boolean)
    : [];

  return (
    <section aria-labelledby="ix-link-h" className="card stack stack--3 ix-gold-edge">
      <p className="ix-eyebrow eyebrow">Next job</p>
      <h2 className="ix-title" id="ix-link-h">
        Who is each person?
      </h2>
      <p className="subtext">
        KukGrade grouped the records into the people they are about. Nothing is linked to a student until you say so.
      </p>
      {!canSort ? (
        <p className="subtext">An administrator sorts the people.</p>
      ) : summary.isPending ? (
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
          {lines.length ? (
            <ul className="list-plain stack stack--1">
              {lines.map((line) => (
                <li className="subtext" key={line}>
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** The one thing to do next from a finished import of past gradings, in the foot bar. */
export function PeopleNext({ batch }: { batch: DataImportBatch }) {
  const canSort = Boolean(useAuth().user?.can_reconcile_imported_history);
  const counts = usePeopleSummary(batch.id, canSort).data;
  const left = counts ? counts.people - counts.sorted : 0;
  return canSort && left ? (
    <Link className={buttonClass({ variant: "primary" })} to={peoplePath({ batch: batch.id })}>
      Sort the {counted(left, "person", "people")} left
    </Link>
  ) : (
    <Link className={buttonClass({ variant: "primary" })} to="/imports">
      Done
    </Link>
  );
}
