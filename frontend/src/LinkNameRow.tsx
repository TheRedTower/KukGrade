import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { type LegacyGradingRecord, type LegacyPerson, errorMessage, getAllLegacyGradingRecords } from "./api";
import { counted } from "./importSteps";
import { type Chosen, periodRange, recordMonth, recordsToLink } from "./linkRecords";
import { RankFix, SomeoneElse, VoidRecord } from "./LinkRecordParts";
import { useLegacyLinking } from "./useLegacyLinking";

export type NameView = "todo" | "clear" | "choose" | "none" | "left" | "done";

const PILLS = {
  clear: ["Clear suggestion", "ix-pill-info"],
  choose: ["Choose between", "ix-pill-warning"],
  none: ["No suggestion", "ix-pill-warning"],
  left: ["Left for now", "ix-pill-neutral"],
  done: ["Linked", "ix-pill-success"],
} as const;

function recordRanks(record: LegacyGradingRecord): string {
  const held = record.source_current_rank_text || "(blank)";
  const tested = record.source_testing_for_rank_text;
  return tested ? `${held} → ${tested}` : held;
}

/** One name's records beside the students it could be (FDR-059). */
function NameDetails({
  person,
  batch,
  chosen,
  unticked,
  pending,
  error,
  onChoose,
  onTick,
  onLink,
  onLeave,
}: {
  person: LegacyPerson;
  batch: number | undefined;
  chosen: Chosen | null;
  unticked: number[];
  pending: boolean;
  error: unknown;
  onChoose: (choice: Chosen) => void;
  onTick: (record: number) => void;
  onLink: () => void;
  onLeave: () => void;
}) {
  const { refresh } = useLegacyLinking();
  const [voiding, setVoiding] = useState<LegacyGradingRecord | null>(null);
  const records = useQuery({
    queryKey: ["legacyRecords", "group", person.group_key, batch],
    queryFn: () => getAllLegacyGradingRecords({ group_key: person.group_key, batch, linked: false, voided: false }),
  });
  const ticked = recordsToLink(person, unticked).length;
  const everyRecord = ticked === person.record_ids.length;
  const linkLabel = chosen
    ? `Link ${everyRecord ? (ticked === 1 ? "it" : `all ${ticked}`) : `${ticked} of ${person.record_ids.length}`} to ${chosen.name}`
    : "Choose a student first";

  return (
    <div className="ix-name-detail">
      <div className="ix-section ix-name-records">
        <h3 className="ix-minor">
          Records <span className="ix-muted">· tick the ones to link</span>
        </h3>
        <ul className="ix-detail-list">
          {records.isPending ? (
            <li className="ix-muted" role="status">
              Loading the records…
            </li>
          ) : records.isError ? (
            <li className="ix-danger-text" role="alert">
              {errorMessage(records.error, "The records could not be loaded.")}
            </li>
          ) : (
            records.data.results.map((record) => (
              <li className="ix-detail-item" key={record.id}>
                <input
                  aria-label={`Link the ${recordMonth(record)} record`}
                  checked={!unticked.includes(record.id)}
                  className="ix-tick"
                  type="checkbox"
                  onChange={() => onTick(record.id)}
                />
                <div className="ix-row-main">
                  <p className="ix-bold">
                    {recordMonth(record)} · {recordRanks(record)}
                    {record.outcome_display ? ` · ${record.outcome_display}` : ""}
                    {record.record_kind === "DID_NOT_ATTEND" ? " · Did not attend" : ""}
                  </p>
                  {record.report || record.note ? <p className="ix-muted ix-small">“{record.report || record.note}”</p> : null}
                  <RankFix record={record} onDone={refresh} />
                </div>
                <button
                  aria-label={`Void the ${recordMonth(record)} record`}
                  className="btn-ghost ix-danger-text"
                  type="button"
                  onClick={() => setVoiding(record)}
                >
                  Void…
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="ix-section ix-name-students">
        <h3 className="ix-minor">Which student?</h3>
        {person.candidates.length > 0 ? (
          <div className="ix-student-list">
            {person.candidates.map((candidate) => (
              <button
                aria-pressed={chosen?.student === candidate.student}
                className="ix-student-option"
                key={candidate.student}
                type="button"
                onClick={() => onChoose({ student: candidate.student, name: candidate.full_name })}
              >
                <span className="ix-bold">{candidate.full_name}</span>{" "}
                <span className="ix-muted ix-small">
                  {candidate.current_rank_name} now · {candidate.status_display} · {candidate.wksa_id}
                </span>
                {candidate.reasons.map((reason) => (
                  <span className="ix-small ix-semibold" key={reason}>
                    {" "}
                    {reason}
                  </span>
                ))}
              </button>
            ))}
          </div>
        ) : (
          <p className="ix-muted ix-small ix-flush">No student looks like this. Search every student below.</p>
        )}
        <SomeoneElse chosen={chosen} onChoose={onChoose} />
        {error ? (
          <p className="ix-danger-text" role="alert">
            {errorMessage(error, "Those records could not be linked.")}
          </p>
        ) : null}
        <div className="ix-actions ix-actions-split">
          <button className="btn-ghost" type="button" onClick={onLeave}>
            Leave for now
          </button>
          <button className="btn-primary" disabled={!chosen || ticked === 0 || pending} type="button" onClick={onLink}>
            {pending ? "Linking…" : linkLabel}
          </button>
        </div>
      </div>
      {voiding ? <VoidRecord record={voiding} onClose={() => setVoiding(null)} onDone={refresh} /> : null}
    </div>
  );
}

/** A name as written, the student suggested for it, and what can be done with it (FDR-059). */
export function NameRow({
  person,
  view,
  batch,
  chosen,
  open,
  selected,
  left,
  unticked,
  sameAs,
  pending,
  error,
  onSelect,
  onToggle,
  onChoose,
  onTick,
  onLink,
  onLeave,
  onPutBack,
  onUndo,
}: {
  person: LegacyPerson;
  view: NameView;
  batch: number | undefined;
  chosen: Chosen | null;
  open: boolean;
  selected: boolean;
  left: boolean;
  unticked: number[];
  sameAs: string | null;
  pending: boolean;
  error: unknown;
  onSelect: () => void;
  onToggle: () => void;
  onChoose: (choice: Chosen) => void;
  onTick: (record: number) => void;
  onLink: () => void;
  onLeave: () => void;
  onPutBack: () => void;
  onUndo: () => void;
}) {
  const done = view === "done";
  const kind = done ? "done" : left ? "left" : person.suggestion;
  const [pill, tone] = PILLS[kind];
  const suggested = chosen ? person.candidates.find((candidate) => candidate.student === chosen.student) : undefined;
  const studentLine = done
    ? null
    : chosen
      ? chosen.name
      : kind === "choose"
        ? `${person.candidates.length} students could be this person`
        : kind === "left"
          ? "Put aside for now"
          : "No student looks like this";
  const detail = done
    ? ""
    : chosen
      ? suggested
        ? suggested.reasons.join(" · ")
        : "Found by search"
      : kind === "choose"
        ? "Open the row to choose"
        : "Open the row to search every student";

  return (
    <li className={`ix-name${open ? " ix-name-open" : ""}`}>
      <div className="ix-name-row">
        {done ? (
          <span />
        ) : (
          <input
            aria-label={`Select “${person.source_name}”`}
            checked={selected}
            className="ix-tick"
            disabled={!chosen}
            type="checkbox"
            onChange={onSelect}
          />
        )}
        <div className="ix-name-main">
          <p className="ix-bold ix-name-title">“{person.source_name}”</p>
          <p className="ix-muted ix-small ix-flush">
            {counted(person.records, "record", "records")} · {periodRange(person)}
          </p>
        </div>
        <p className="ix-small ix-flush">
          {person.ranks.join(" · ")}
          {person.needs_rank ? <span className="ix-warning-text ix-semibold ix-block">A rank is not matched yet</span> : null}
        </p>
        <div className="ix-name-student">
          <span className={`ix-pill ${tone}`}>{pill}</span>
          <p className="ix-semibold ix-flush">
            {done ? (
              person.linked_student ? (
                <>
                  Linked to <Link to={`/students/${person.linked_student}`}>{person.linked_student_name}</Link>
                </>
              ) : (
                "Linked to more than one student"
              )
            ) : (
              studentLine
            )}
          </p>
          {detail ? <p className="ix-muted ix-small ix-flush">{detail}</p> : null}
          {sameAs && !done ? <p className="ix-small ix-semibold ix-flush">Same student as “{sameAs}”, just linked</p> : null}
        </div>
        <div className="ix-actions ix-name-actions">
          {done ? (
            <button aria-label={`Undo linking “${person.source_name}”`} className="btn-ghost" disabled={pending} type="button" onClick={onUndo}>
              Undo
            </button>
          ) : (
            <>
              {chosen && !open ? (
                <button
                  aria-label={`Link “${person.source_name}” to ${chosen.name}`}
                  className="btn-primary"
                  disabled={pending}
                  type="button"
                  onClick={onLink}
                >
                  Link
                </button>
              ) : null}
              {left ? (
                <button aria-label={`Put “${person.source_name}” back`} className="btn-ghost" type="button" onClick={onPutBack}>
                  Put back
                </button>
              ) : null}
              <button
                aria-expanded={open}
                aria-label={`${open ? "Close" : kind === "clear" ? "Review" : "Choose a student for"} “${person.source_name}”`}
                className="btn-ghost"
                type="button"
                onClick={onToggle}
              >
                {open ? "Close" : kind === "clear" ? "Review" : "Choose"}
              </button>
            </>
          )}
        </div>
      </div>
      {open && !done ? (
        <NameDetails
          batch={batch}
          chosen={chosen}
          error={error}
          pending={pending}
          person={person}
          unticked={unticked}
          onChoose={onChoose}
          onLeave={onLeave}
          onLink={onLink}
          onTick={onTick}
        />
      ) : null}
    </li>
  );
}
