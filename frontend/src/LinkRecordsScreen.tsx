import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type LegacyGradingRecord,
  type LegacyPerson,
  errorMessage,
  getAllDataImportBatches,
  getAllLegacyGradingRecords,
  getLegacyPeople,
  getStudents,
  resolveLegacyCurrentRank,
  resolveLegacyTestingForRank,
  voidLegacyGradingRecord,
} from "./api";
import { formatMonthYear } from "./dates";
import { ImportDialog } from "./ImportDialog";
import { ImportPager } from "./ImportPager";
import { counted } from "./importSteps";
import { useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";

const QUEUE_SIZE = 50;

type Chosen = { student: number; name: string };

function recordMonth(record: LegacyGradingRecord): string {
  return formatMonthYear(record.cycle_year, record.cycle_month);
}

function ranksText(record: LegacyGradingRecord): string {
  const held = record.source_current_rank_text || "(blank)";
  const tested = record.source_testing_for_rank_text;
  return tested ? `${held} → ${tested}` : held;
}

/** A record's ranks still as written, each with a rank to choose. */
export function RankFix({ record, onDone, showAll = false }: { record: LegacyGradingRecord; onDone: () => Promise<void>; showAll?: boolean }) {
  const ranks = useRanksQuery().data?.results ?? [];
  const fix = useMutation({
    mutationFn: ({ which, rank }: { which: "held" | "tested"; rank: number | null }) =>
      which === "held" ? resolveLegacyCurrentRank(record.id, rank) : resolveLegacyTestingForRank(record.id, rank),
    onSuccess: onDone,
  });
  const open: { which: "held" | "tested"; text: string }[] = [];
  if (showAll || (record.source_current_rank_text && record.current_rank === null)) open.push({ which: "held", text: record.source_current_rank_text });
  if (showAll || (record.source_testing_for_rank_text && record.testing_for_rank === null)) open.push({ which: "tested", text: record.source_testing_for_rank_text });
  if (open.length === 0) return null;
  return (
    <span className="ix-actions ix-rank-fix">
      {open.map((item) => (
        <label className="ix-field ix-warning-text" key={item.which}>
          {showAll ? `${item.which === "held" ? "Held rank" : "Testing for"} (as written: “${item.text || "blank"}”)` : `“${item.text}” is not matched to a rank yet`}
          <select
            disabled={fix.isPending}
            value={showAll ? (item.which === "held" ? record.current_rank : record.testing_for_rank) ?? "" : ""}
            onChange={(event) => fix.mutate({ which: item.which, rank: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">{showAll ? "No mapped rank" : "Match it…"}</option>
            {ranks.map((rank) => (
              <option key={rank.id} value={rank.id}>
                {rank.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {fix.isError ? (
        <span className="ix-danger-text ix-small" role="alert">
          {errorMessage(fix.error, "That rank could not be saved.")}
        </span>
      ) : null}
    </span>
  );
}

export function VoidRecord({ record, onClose, onDone }: { record: LegacyGradingRecord; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const voiding = useMutation({
    mutationFn: () => voidLegacyGradingRecord(record.id, reason.trim()),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  return (
    <ImportDialog
      confirmDisabled={!reason.trim()}
      confirmLabel="Void the record"
      danger
      error={voiding.isError ? errorMessage(voiding.error, "The record could not be voided.") : null}
      pending={voiding.isPending}
      pendingLabel="Voiding…"
      title={`Void the ${recordMonth(record)} record for “${record.source_name}”?`}
      onClose={onClose}
      onConfirm={() => voiding.mutate()}
    >
      <p className="ix-muted">It is kept, marked void with your reason, and is never linked to anyone.</p>
      <label className="ix-field" htmlFor="ix-void-record-reason">
        Why
      </label>
      <textarea id="ix-void-record-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    </ImportDialog>
  );
}

export function SomeoneElse({ chosen, onChoose }: { chosen: Chosen | null; onChoose: (choice: Chosen) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const found = useQuery({
    queryKey: ["students", "linkSearch", debounced],
    queryFn: () => getStudents({ search: debounced, page_size: 6 }),
    enabled: debounced.length >= 2,
  });
  return (
    <div className="ix-candidate ix-candidate-other">
      <label className="ix-field ix-field-wide">
        Someone else
        <input placeholder="Search every student" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {(found.data?.results ?? []).map((student) => {
        const name = `${student.first_name} ${student.last_name}`;
        return (
          <button
            aria-pressed={chosen?.student === student.id}
            className="ix-link-button ix-found"
            key={student.id}
            type="button"
            onClick={() => onChoose({ student: student.id, name })}
          >
            {[name, student.current_rank_name, student.wksa_id].filter(Boolean).join(" · ")}
          </button>
        );
      })}
    </div>
  );
}

/** One name in focus: its records beside the students it could be (FDR-055). */
function NameInFocus({
  person,
  batch,
  onLinked,
  onSkip,
}: {
  person: LegacyPerson;
  batch: number | undefined;
  onLinked: (name: string, recordIds: number[]) => void;
  onSkip: () => void;
}) {
  const { link, refresh } = useLegacyLinking();
  const [chosen, setChosen] = useState<Chosen | null>(
    !person.shared && person.candidates.length > 0
      ? { student: person.candidates[0].student, name: person.candidates[0].full_name }
      : null,
  );
  const [left, setLeft] = useState<number[]>([]);
  const [voiding, setVoiding] = useState<LegacyGradingRecord | null>(null);

  const records = useQuery({
    queryKey: ["legacyRecords", "group", person.group_key, batch],
    queryFn: () => getAllLegacyGradingRecords({ group_key: person.group_key, batch, linked: false, voided: false }),
  });
  const own = records.data?.results ?? [];
  const ticked = own.filter((record) => !left.includes(record.id));

  function linkTicked(choice: Chosen) {
    link.mutate(
      { records: ticked.map((record) => record.id), student: choice.student },
      { onSuccess: (linked) => {
        setLeft([]);
        onLinked(choice.name, linked.map((record) => record.id));
      } },
    );
  }

  const linkLabel = chosen
    ? `Link ${ticked.length === own.length ? (own.length === 1 ? "it" : `all ${own.length}`) : `${ticked.length} of ${own.length}`} to ${chosen.name}`
    : "Choose a student first";
  const hint = person.shared
    ? "Students share this name: choose one"
    : person.candidates.length === 0
      ? "No student looks like this"
      : "One clear suggestion";

  return (
    <section aria-labelledby="ix-focus-h" className="ix-section ix-roomy">
      <div className="ix-card">
        <div className="ix-row ix-align-baseline">
          <h2 className="ix-title ix-flush ix-grow" id="ix-focus-h" tabIndex={-1}>
            “{person.source_name}” in the workbook
          </h2>
          <span className="ix-muted ix-small">{counted(own.length || person.records, "record", "records")} · tick the ones to link</span>
        </div>
        {records.isPending ? (
          <p className="ix-row ix-muted" role="status">
            Loading the records…
          </p>
        ) : records.isError ? (
          <p className="ix-row ix-danger-text" role="alert">
            {errorMessage(records.error, "The records could not be loaded.")}
          </p>
        ) : (
          own.map((record) => (
            <div className="ix-row ix-align-start" key={record.id}>
              <input
                aria-label={`Link the ${recordMonth(record)} record`}
                checked={!left.includes(record.id)}
                className="ix-tick"
                type="checkbox"
                onChange={() =>
                  setLeft(left.includes(record.id) ? left.filter((id) => id !== record.id) : [...left, record.id])
                }
              />
              <div className="ix-row-main">
                <p className="ix-bold">
                  {recordMonth(record)} · {ranksText(record)}
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
            </div>
          ))
        )}
      </div>

      <fieldset className="ix-card ix-card-pad ix-section ix-choice">
        <legend className="ix-visually-hidden">Who could it be?</legend>
        <div className="ix-section-head">
          <h3 aria-hidden="true" className="ix-minor">
            Who could it be?
          </h3>
          <span className={`ix-small ix-semibold ${person.candidates.length === 1 && !person.shared ? "ix-muted" : "ix-warning-text"}`}>
            {hint}
          </span>
        </div>
        <div className="ix-candidates">
          {person.candidates.map((candidate) => (
            <label className={`ix-candidate${chosen?.student === candidate.student ? " ix-picked" : ""}`} key={candidate.student}>
              <span className="ix-candidate-name">
                <input
                  checked={chosen?.student === candidate.student}
                  name="ix-candidate"
                  type="radio"
                  onChange={() => setChosen({ student: candidate.student, name: candidate.full_name })}
                />
                {candidate.full_name}
              </span>
              <span className="ix-muted ix-small">
                {candidate.current_rank_name} now · {candidate.wksa_id} · {candidate.status_display}
              </span>
              {candidate.reasons.map((reason) => (
                <span className="ix-small ix-semibold" key={reason}>
                  {reason}
                </span>
              ))}
            </label>
          ))}
          <SomeoneElse chosen={chosen} onChoose={setChosen} />
        </div>
        {link.isError ? (
          <p className="ix-danger-text" role="alert">
            {errorMessage(link.error, "Those records could not be linked.")}
          </p>
        ) : null}
        <div className="ix-actions ix-actions-split ix-ruled">
          <button className="btn-ghost" type="button" onClick={onSkip}>
            Leave for now
          </button>
          <button
            className="btn-primary"
            disabled={!chosen || ticked.length === 0 || link.isPending}
            type="button"
            onClick={() => chosen && linkTicked(chosen)}
          >
            {link.isPending ? "Linking…" : linkLabel}
          </button>
        </div>
      </fieldset>
      {voiding ? <VoidRecord record={voiding} onClose={() => setVoiding(null)} onDone={refresh} /> : null}
    </section>
  );
}

/**
 * Linking historical records to students, one name at a time, side by side
 * with the students it could be (FDR-055). KukGrade only suggests.
 */
export function LinkRecordsScreen() {
  const { undo } = useLegacyLinking();
  const [batch, setBatch] = useState("");
  const [page, setPage] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [linked, setLinked] = useState<{ person: LegacyPerson; name: string; recordIds: number[] }[]>([]);

  const imports = useQuery({
    queryKey: ["imports", "historical"],
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const people = useQuery({
    queryKey: ["legacyPeople", "queue", batch, page],
    placeholderData: keepPreviousData,
    queryFn: () => getLegacyPeople({ batch: batch ? Number(batch) : undefined, linked: false, page, page_size: QUEUE_SIZE }),
  });

  function undoLink(entry: (typeof linked)[number]) {
    undo.mutate(entry.recordIds, {
      onSuccess: () => setLinked((current) => current.filter((other) => other !== entry)),
    });
  }

  const waiting = people.isPlaceholderData ? [] : people.data?.results ?? [];
  const nextUp = (after: string | null) => {
    const order = waiting.filter((person) => !skipped.includes(person.group_key) || person.group_key === after);
    const index = order.findIndex((person) => person.group_key === after);
    return order[index + 1]?.group_key ?? order.find((person) => person.group_key !== after)?.group_key ?? null;
  };
  const current =
    waiting.find((person) => person.group_key === focus) ??
    waiting.find((person) => !skipped.includes(person.group_key));

  return (
    <section aria-labelledby="ix-link-title" className="ix-page ix-page-wide">
      <div className="ix-header">
        <div className="ix-header-text">
          <Link className="ix-back" to="/imports">
            ‹ Imports
          </Link>
          <h1 id="ix-link-title">Link historical records</h1>
          <p className="ix-lead">
            One name at a time: its records beside the students it could be. Nothing is linked
            until you say so, and a link can be undone.
          </p>
        </div>
        <p className="ix-small ix-flush">
          <strong className="ix-big-count">{linked.length}</strong> linked here ·{" "}
          {counted(people.data?.count ?? 0, "name", "names")} still to link
        </p>
      </div>

      <div className="ix-two-col ix-two-col-queue">
        <div className="ix-section">
          {people.isPending || people.isPlaceholderData ? (
            <p className="ix-muted" role="status">
              Loading the names…
            </p>
          ) : people.isError ? (
            <p className="ix-danger-text" role="alert">
              {errorMessage(people.error, "The names could not be loaded. Try again in a moment.")}
            </p>
          ) : current ? (
            <NameInFocus
              key={current.group_key}
              person={current}
              batch={batch ? Number(batch) : undefined}
              onLinked={(name, recordIds) => {
                setLinked((previous) => [...previous, { person: current, name, recordIds }]);
                setPage(1);
                setFocus(nextUp(current.group_key));
              }}
              onSkip={() => {
                setSkipped((previous) => [...previous, current.group_key]);
                if (waiting.every((person) => person.group_key === current.group_key || skipped.includes(person.group_key)) && people.data?.next) {
                  setPage(page + 1);
                  setFocus(null);
                } else {
                  setFocus(nextUp(current.group_key));
                }
              }}
            />
          ) : (
            <div className="ix-card ix-card-pad">
              {people.data?.count === 0 ? (
                <p className="ix-success-text ix-bold">✓ Every imported record is linked to a student.</p>
              ) : (
                <>
                  <p className="ix-muted">No more names to work on from this page.</p>
                  <button className="btn-ghost" type="button" onClick={() => { setPage(1); setFocus(null); setSkipped([]); }}>
                    Return to the first page
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <nav aria-label="Names to link" className="ix-card">
          <div className="ix-section ix-queue-head">
            <label className="ix-field">
              Import
              <select
                value={batch}
                onChange={(event) => {
                  setBatch(event.target.value);
                  setPage(1);
                  setFocus(null);
                  setSkipped([]);
                }}
              >
                <option value="">Every import</option>
                {(imports.data?.results ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.original_filename}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {undo.isError ? (
            <p className="ix-danger-text ix-small ix-queue-note" role="alert">
              {errorMessage(undo.error, "That link could not be undone.")}
            </p>
          ) : null}
          <ol className="ix-queue">
            {linked.map((entry) => (
              <li key={`linked-${entry.recordIds.join("-")}`}>
                <div className="ix-queue-done">
                  <span aria-hidden="true" className="ix-mark ix-mark-ok">
                    ✓
                  </span>
                  <span className="ix-queue-text">
                    <span className="ix-queue-name">“{entry.person.source_name}”</span>
                    <span className="ix-small">Linked to {entry.name}</span>
                  </span>
                  <button
                    aria-label={`Undo linking “${entry.person.source_name}”`}
                    className="ix-link-button"
                    disabled={undo.isPending}
                    type="button"
                    onClick={() => undoLink(entry)}
                  >
                    Undo
                  </button>
                </div>
              </li>
            ))}
            {waiting.map((person) => {
              const mark = person.candidates.length === 0 ? "?" : person.shared ? "2" : "1";
              const tone = person.candidates.length === 1 && !person.shared ? "ix-pill-info" : "ix-pill-warning";
              return (
                <li key={person.group_key}>
                  <button aria-current={current?.group_key === person.group_key} type="button" onClick={() => setFocus(person.group_key)}>
                    <span aria-hidden="true" className={`ix-mark ${tone}`}>
                      {mark}
                    </span>
                    <span className="ix-queue-text">
                      <span className="ix-queue-name">
                        “{person.source_name}” · {person.records}
                      </span>
                      <span className="ix-muted ix-small">
                        {skipped.includes(person.group_key)
                          ? "Left for now"
                          : person.candidates.length === 0
                            ? "No suggestion"
                            : person.shared
                              ? "Students share this name"
                              : `Suggested: ${person.candidates[0].full_name}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <ImportPager
            page={page}
            pages={Math.ceil((people.data?.count ?? 0) / QUEUE_SIZE)}
            total={people.data?.count ?? 0}
            onPage={(next) => {
              setPage(next);
              setFocus(null);
            }}
          />
        </nav>
      </div>
    </section>
  );
}
