import { useState } from "react";
import { Badge } from "./Badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ErrorText } from "./ErrorText";
import { type LegacyGradingRecord, type LegacyPerson, errorMessage, getAllLegacyGradingRecords } from "./api";
import { counted } from "./importSteps";
import { type Chosen, periodRange, recordMonth, recordsToLink } from "./linkRecords";
import { RankFix, SomeoneElse, VoidRecord } from "./LinkRecordParts";
import { useLegacyLinking } from "./useLegacyLinking";
import { Button } from "./Button";
import { type Column, ResponsiveTable } from "./ResponsiveTable";

export type NameView = "todo" | "clear" | "choose" | "none" | "left" | "done";

const PILLS = {
  clear: ["Clear suggestion", "info"],
  choose: ["Choose between", "warning"],
  none: ["No suggestion", "warning"],
  left: ["Left for now", "neutral"],
  done: ["Linked", "success"],
} as const;

function recordRanks(record: LegacyGradingRecord): string {
  const held = record.source_current_rank_text || "(blank)";
  const tested = record.source_testing_for_rank_text;
  return tested ? `${held} → ${tested}` : held;
}

/** One name's records beside the students it could be. */
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
  onLeave?: () => void;
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
          Records <span className="subtext">· tick the ones to link</span>
        </h3>
        <ul className="ix-detail-list">
          {records.isPending ? (
            <li className="subtext" role="status">
              Loading the records…
            </li>
          ) : records.isError ? (
            <ErrorText as="li">
              {errorMessage(records.error, "The records could not be loaded.")}
            </ErrorText>
          ) : (
            records.data.results.map((record) => (
              <li className="ix-detail-item" key={record.id}>
                <label className="ix-tick-hit">
                  <input
                    aria-label={`Link the ${recordMonth(record)} record`}
                    checked={!unticked.includes(record.id)}
                    className="ix-tick"
                    type="checkbox"
                    onChange={() => onTick(record.id)}
                  />
                </label>
                <div className="ix-row-main">
                  <p className="item-title">
                    {recordMonth(record)} · {recordRanks(record)}
                    {record.outcome_display ? ` · ${record.outcome_display}` : ""}
                    {record.record_kind === "DID_NOT_ATTEND" ? " · Did not attend" : ""}
                  </p>
                  {record.report || record.note ? <p className="subtext">“{record.report || record.note}”</p> : null}
                  <RankFix record={record} onDone={refresh} />
                </div>
                <Button
                  aria-label={`Void the ${recordMonth(record)} record`}
                  variant="ghost" className="ix-danger-text"
                  onClick={() => setVoiding(record)}
                >
                  Void…
                </Button>
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
                <span className="item-title">{candidate.full_name}</span>{" "}
                <span className="subtext">
                  {candidate.current_rank_name} now · {candidate.status_display} · {candidate.wksa_id}
                </span>
                {candidate.reasons.map((reason) => (
                  <span className="item-title" key={reason}>
                    {" "}
                    {reason}
                  </span>
                ))}
              </button>
            ))}
          </div>
        ) : (
          <p className="subtext ix-flush">No student looks like this. Search every student below.</p>
        )}
        <SomeoneElse chosen={chosen} onChoose={onChoose} />
        {error ? (
          <ErrorText>
            {errorMessage(error, "Those records could not be linked.")}
          </ErrorText>
        ) : null}
        <div className="ix-actions ix-actions-split">
          {onLeave ? (
            <Button variant="ghost" onClick={onLeave}>
              Leave for now
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" disabled={!chosen || ticked === 0 || pending} onClick={onLink}>
            {pending ? "Linking…" : linkLabel}
          </Button>
        </div>
      </div>
      {voiding ? <VoidRecord record={voiding} onClose={() => setVoiding(null)} onDone={refresh} /> : null}
    </div>
  );
}

/** Everything one name's row shows and does, as the linking page hands it over. */
export interface NameItem {
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
}

function kindOf({ view, left, person }: NameItem) {
  return view === "done" ? "done" : left ? "left" : person.suggestion;
}

/** The student a name is (or could be) linked to, and why. */
function NameStudent(item: NameItem) {
  const { person, chosen, sameAs } = item;
  const kind = kindOf(item);
  const done = kind === "done";
  const [pill, tone] = PILLS[kind];
  const suggested = chosen ? person.candidates.find((candidate) => candidate.student === chosen.student) : undefined;
  const studentLine = chosen
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
    <>
      <Badge dot tone={tone}>
        {pill}
      </Badge>
      <p className="item-title ix-flush">
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
      {detail ? <p className="subtext ix-flush">{detail}</p> : null}
      {sameAs && !done ? <p className="item-title ix-flush">Same student as “{sameAs}”, just linked</p> : null}
    </>
  );
}

/** What can be done with a name from its row. */
function NameActions({ person, view, chosen, open, left, unticked, pending, onLink, onPutBack, onToggle, onUndo }: NameItem) {
  if (view === "done") {
    return (
      <Button aria-label={`Undo linking “${person.source_name}”`} variant="ghost" disabled={pending} onClick={onUndo}>
        Undo
      </Button>
    );
  }
  return (
    <>
      {chosen && !open ? (
        <Button
          aria-label={`Link “${person.source_name}” to ${chosen.name}`}
          variant="primary"
          disabled={pending || recordsToLink(person, unticked).length === 0}
          onClick={onLink}
        >
          Link
        </Button>
      ) : null}
      {left ? (
        <Button aria-label={`Put “${person.source_name}” back`} variant="ghost" onClick={onPutBack}>
          Put back
        </Button>
      ) : null}
      <Button
        aria-expanded={open}
        aria-label={`${open ? "Close" : person.suggestion === "clear" ? "Review" : "Choose a student for"} “${person.source_name}”`}
        variant="ghost"
        onClick={onToggle}
      >
        {open ? "Close" : person.suggestion === "clear" ? "Review" : "Choose"}
      </Button>
    </>
  );
}

/** The linking page's columns: a name as written, the student suggested for it, and what can be done with it. */
const NAME_COLUMNS: readonly Column<NameItem>[] = [
  {
    key: "select",
    header: "Select",
    actions: "inline",
    render: ({ person, view, chosen, selected, onSelect }) =>
      view === "done" ? null : (
        <label className="ix-tick-hit">
          <input
            aria-label={`Select “${person.source_name}”`}
            checked={selected}
            className="ix-tick"
            disabled={!chosen}
            type="checkbox"
            onChange={onSelect}
          />
        </label>
      ),
  },
  {
    key: "name",
    header: "Name as written",
    primary: true,
    render: ({ person }) => (
      <>
        <p className="ix-flush">“{person.source_name}”</p>
        <p className="subtext ix-flush">
          {counted(person.records, "record", "records")} · {periodRange(person)}
        </p>
      </>
    ),
  },
  {
    key: "ranks",
    header: "Ranks in the records",
    render: ({ person }) => (
      <>
        {person.ranks.join(" · ")}
        {person.needs_rank ? <span className="ix-warning-text item-title ix-block">A rank is not matched yet</span> : null}
      </>
    ),
  },
  { key: "student", header: "Student", render: (item) => <NameStudent {...item} /> },
  { key: "actions", header: "Actions", actions: true, render: (item) => <NameActions {...item} /> },
];

/** Every name on the page, one row each; the open one shows its records and students beneath it. */
export function NamesTable({ items }: { items: readonly NameItem[] }) {
  return (
    <ResponsiveTable
      label="Names as written"
      flush
      columns={NAME_COLUMNS}
      rowKey={(item) => item.person.group_key}
      rows={items}
      detail={(item) =>
        item.open && item.view !== "done" ? (
          <NameDetails
            batch={item.batch}
            chosen={item.chosen}
            error={item.error}
            pending={item.pending}
            person={item.person}
            unticked={item.unticked}
            onChoose={item.onChoose}
            onLeave={item.left ? undefined : item.onLeave}
            onLink={item.onLink}
            onTick={item.onTick}
          />
        ) : null
      }
    />
  );
}
