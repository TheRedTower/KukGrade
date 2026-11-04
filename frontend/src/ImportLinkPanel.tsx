import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type DataImportBatch, type LegacyPerson, errorMessage, getLegacyGradingRecords, getLegacyPeople } from "./api";
import { ErrorText } from "./ErrorText";
import { useAuth } from "./auth";
import { counted } from "./importSteps";
import { periodRange } from "./linkRecords";
import { PartialUnlinkError, useLegacyLinking } from "./useLegacyLinking";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";

const LINK_GROUPS_SHOWN = 4;

/** Past gradings: who each record is, linked on the spot. */
export function LinkPanel({ batch }: { batch: DataImportBatch }) {
  const { user } = useAuth();
  const canLink = Boolean(user?.can_reconcile_imported_history);
  const { link, undo } = useLegacyLinking();
  // Linked here, so a name stays on screen (with Undo) once it leaves the
  // "not linked" list the server returns.
  const [linked, setLinked] = useState<Record<string, { person: LegacyPerson; name: string }>>({});

  const awaiting = useQuery({
    queryKey: ["legacyRecords", "awaitingLinkCount", batch.id],
    queryFn: () => getLegacyGradingRecords({ batch: batch.id, awaiting_link: true, page_size: 1 }),
  });
  const people = useQuery({
    queryKey: ["legacyPeople", batch.id, "unlinked"],
    queryFn: () => getLegacyPeople({ batch: batch.id, linked: false, page_size: LINK_GROUPS_SHOWN }),
    enabled: canLink,
  });

  function linkAll(person: LegacyPerson, student: number, name: string) {
    undo.reset();
    link.mutate(
      person.record_ids.map((record) => ({ record, student })),
      { onSuccess: () => setLinked((current) => ({ ...current, [person.source_name]: { person, name } })) },
    );
  }

  function undoLink(person: LegacyPerson) {
    link.reset();
    undo.mutate(person.record_ids, {
      onSettled: (unlinkedIds, error) => {
        const removed = unlinkedIds ?? (error instanceof PartialUnlinkError ? error.unlinkedIds : []);
        setLinked((current) => {
          const entry = current[person.source_name];
          if (!entry || removed.length === 0) return current;
          const next = { ...current };
          const remaining = entry.person.record_ids.filter((id) => !removed.includes(id));
          if (remaining.length === 0) delete next[person.source_name];
          else next[person.source_name] = {
            ...entry,
            person: { ...entry.person, record_ids: remaining, records: remaining.length },
          };
          return next;
        });
      },
    });
  }

  const fromServer = people.data?.results ?? [];
  const shown = [
    ...Object.values(linked).map((entry) => entry.person),
    ...fromServer.filter((person) => !linked[person.source_name]),
  ].slice(0, LINK_GROUPS_SHOWN + Object.keys(linked).length);
  const waiting = awaiting.data?.count;
  const busy = link.isPending || undo.isPending;
  const failed = link.isError
    ? errorMessage(link.error, "Those records could not be linked.")
    : undo.isError
      ? undo.error instanceof PartialUnlinkError ? undo.error.message : errorMessage(undo.error, "Those records could not be unlinked.")
      : null;

  return (
    <section aria-labelledby="ix-link-h" className="card card--flush ix-gold-edge">
      <div className="ix-row ix-align-end">
        <div className="ix-row-main">
          <p className="ix-eyebrow">Next job</p>
          <h2 className="ix-title" id="ix-link-h">
            Who is each record?
          </h2>
          <p className="ix-muted ix-small">
            Grouped by the name as written. KukGrade suggests a student; nothing is linked until
            you say so. A linked record shows in that student’s history.
          </p>
        </div>
        {waiting !== undefined ? (
          <p className="ix-small ix-flush">
            <strong>{counted(waiting, "record", "records")}</strong> still to link
          </p>
        ) : null}
      </div>
      {!canLink ? (
        <p className="ix-row ix-muted">An administrator links these records to students.</p>
      ) : people.isPending ? (
        <p className="ix-row ix-muted" role="status">
          Loading suggestions…
        </p>
      ) : people.isError ? (
        <ErrorText className="ix-row">
          {errorMessage(people.error, "Suggestions could not be loaded.")}
        </ErrorText>
      ) : shown.length === 0 ? (
        <p className="ix-row ix-success-text">Every record from this import is linked.</p>
      ) : (
        shown.map((person) => {
          const done = linked[person.source_name];
          const [best] = person.candidates;
          return (
            <div className={`ix-row${done ? " ix-row-done" : ""}`} key={person.source_name}>
              <div className="ix-row-main ix-row-name">
                <p className="ix-strong">
                  “{person.source_name}” · {counted(person.records, "record", "records")}
                </p>
                <p className="ix-muted ix-small">{periodRange(person)}</p>
              </div>
              <div className="ix-actions ix-row-choice">
                {done ? (
                  <>
                    <span className="ix-success-text ix-bold">✓ Linked to {done.name}</span>
                    <Button
                      aria-label={`Undo linking “${person.source_name}”`}
                      variant="link"
                      disabled={busy}
                      onClick={() => undoLink(person)}
                    >
                      Undo
                    </Button>
                  </>
                ) : person.suggestion === "choose" ? (
                  <>
                    <span className="ix-warning-text ix-small ix-semibold ix-full">Students share this name. Choose one.</span>
                    {person.candidates.slice(0, 3).map((candidate) => (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        key={candidate.student}
                        onClick={() => linkAll(person, candidate.student, candidate.full_name)}
                      >
                        {candidate.full_name} · {candidate.current_rank_name}
                      </Button>
                    ))}
                  </>
                ) : best ? (
                  <>
                    <span className="ix-suggested">
                      <span className="ix-muted ix-small">Suggested</span>
                      <span className="ix-semibold">
                        {best.full_name} · {best.current_rank_name}
                      </span>
                      {best.reasons.length ? <span className="ix-muted ix-small">{best.reasons.join(" · ")}</span> : null}
                    </span>
                    <Button
                      aria-label={`${person.records === 1 ? "Link it" : `Link all ${person.records}`}: “${person.source_name}” to ${best.full_name}`}
                      variant="primary"
                      disabled={busy}
                      onClick={() => linkAll(person, best.student, best.full_name)}
                    >
                      {person.records === 1 ? "Link it" : `Link all ${person.records}`}
                    </Button>
                    <Link className={buttonClass({ variant: "ghost" })} to="/imports/records">
                      Someone else
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="ix-muted ix-small">No student looks like this.</span>
                    <Link className={buttonClass({ variant: "secondary" })} to="/imports/records">
                      Find a student
                    </Link>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      {failed ? (
        <ErrorText className="ix-row">
          {failed}
        </ErrorText>
      ) : null}
      {canLink ? (
        <div className="ix-row ix-actions-split">
          <span className="ix-muted ix-small">
            {people.data && people.data.count > fromServer.length
              ? `${fromServer.length} of ${people.data.count} names shown. The rest are on the linking page.`
              : "Every name still to link is shown."}
          </span>
          <Link className={buttonClass({ variant: "secondary" })} to="/imports/records">
            Open the linking page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
