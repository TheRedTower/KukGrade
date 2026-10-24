import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type LegacyPerson,
  errorMessage,
  getAllDataImportBatches,
  getLegacyPeople,
  getLegacyPeopleSummary,
} from "./api";
import { ImportPager } from "./ImportPager";
import { counted } from "./importSteps";
import { NameRow, type NameView } from "./LinkNameRow";
import { type Chosen, recordsToLink } from "./linkRecords";
import { useDebouncedValue } from "./useDebouncedValue";
import { useLeftNames } from "./useLeftNames";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";

const PAGE_SIZE = 50;

const VIEWS: { view: NameView; label: string }[] = [
  { view: "todo", label: "To link" },
  { view: "clear", label: "Clear suggestion" },
  { view: "choose", label: "Choose between" },
  { view: "none", label: "No suggestion" },
  { view: "left", label: "Left for now" },
  { view: "done", label: "Linked" },
];

function chosenFor(person: LegacyPerson, picks: Record<string, Chosen>): Chosen | null {
  const picked = picks[person.group_key];
  if (picked) return picked;
  const [best] = person.candidates;
  return person.suggestion === "clear" && best ? { student: best.student, name: best.full_name } : null;
}

/**
 * Linking historical records to students: every name as written in the
 * workbook, many at a time (FDR-059). KukGrade only suggests; nothing is
 * linked until a person says so, and a link can be undone.
 */
export function LinkRecordsScreen() {
  const { link, undo } = useLegacyLinking();
  const { left, leave, putBack } = useLeftNames();
  const [view, setView] = useState<NameView>("todo");
  const [batch, setBatch] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, Chosen>>({});
  const [unticked, setUnticked] = useState<number[]>([]);
  const [linkedHere, setLinkedHere] = useState<Record<number, string[]>>({});
  const [notice, setNotice] = useState("");
  // The open row a link was started from, so its failure shows in that row.
  const [linkedFrom, setLinkedFrom] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const batchId = batch ? Number(batch) : undefined;
  const leftKeys = left.join(",") || undefined;

  const imports = useQuery({
    queryKey: ["imports", "historical"],
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const summary = useQuery({
    queryKey: ["legacyPeople", "summary", batchId, leftKeys],
    queryFn: () => getLegacyPeopleSummary({ batch: batchId, exclude_group_keys: leftKeys }),
  });
  const leftCount = useQuery({
    queryKey: ["legacyPeople", "count", "left", batchId, leftKeys],
    queryFn: () => getLegacyPeople({ batch: batchId, linked: false, group_keys: leftKeys, page_size: 1 }),
    enabled: left.length > 0,
  });
  const linkedCount = useQuery({
    queryKey: ["legacyPeople", "count", "linked", batchId],
    queryFn: () => getLegacyPeople({ batch: batchId, linked: true, page_size: 1 }),
  });
  const people = useQuery({
    queryKey: ["legacyPeople", "list", view, batchId, debouncedSearch, leftKeys, page],
    placeholderData: keepPreviousData,
    enabled: view !== "left" || left.length > 0,
    queryFn: () =>
      getLegacyPeople({
        batch: batchId,
        linked: view === "done",
        search: debouncedSearch || undefined,
        page,
        page_size: PAGE_SIZE,
        ...(view === "left" ? { group_keys: leftKeys } : view === "done" ? {} : { exclude_group_keys: leftKeys }),
        ...(view === "clear" || view === "choose" || view === "none" ? { suggestion: view } : {}),
      }),
  });

  const counts: Record<NameView, number | undefined> = {
    todo: summary.data?.names,
    clear: summary.data?.clear,
    choose: summary.data?.choose,
    none: summary.data?.none,
    left: left.length > 0 ? leftCount.data?.count : 0,
    done: linkedCount.data?.count,
  };
  const linkedNames = counts.done ?? 0;
  const totalNames = linkedNames + (counts.todo ?? 0) + (counts.left ?? 0);

  const noneLeft = view === "left" && left.length === 0;
  const loading = !noneLeft && (people.isPending || people.isPlaceholderData);
  const rows = loading || noneLeft ? [] : people.data?.results ?? [];
  const listed = noneLeft ? 0 : people.data?.count ?? 0;
  const pageSelected = rows.filter((person) => selected.includes(person.group_key) && chosenFor(person, picks));
  const clearOnPage = rows.filter((person) => view !== "done" && person.suggestion === "clear");

  // Selection and an open row belong to the rows on screen.
  function resetRows() {
    setOpen(null);
    setSelected([]);
  }

  function show(next: NameView) {
    setView(next);
    setPage(1);
    setNotice("");
    resetRows();
  }

  function linkNames(names: LegacyPerson[], from: string | null = null) {
    setLinkedFrom(from);
    const links = names.flatMap((person) => {
      const student = chosenFor(person, picks)?.student;
      return student === undefined ? [] : recordsToLink(person, unticked).map((record) => ({ record, student }));
    });
    link.mutate(links, {
      onSuccess: () => {
        const grouped = { ...linkedHere };
        for (const person of names) {
          const student = chosenFor(person, picks)?.student;
          if (student !== undefined) grouped[student] = [...(grouped[student] ?? []), person.source_name];
        }
        setLinkedHere(grouped);
        setSelected((current) => current.filter((key) => !names.some((person) => person.group_key === key)));
        setUnticked((current) => current.filter((id) => !names.some((person) => person.record_ids.includes(id))));
        setOpen(null);
        setNotice(
          names.length === 1
            ? `Linked “${names[0].source_name}” to ${chosenFor(names[0], picks)?.name}.`
            : `Linked ${counted(names.length, "name", "names")} to their students.`,
        );
      },
    });
  }

  function leaveName(key: string) {
    leave(key);
    setOpen(null);
    setSelected((current) => current.filter((other) => other !== key));
  }

  const everyNameLinked = view === "todo" && !debouncedSearch && counts.todo === 0 && counts.left === 0;

  return (
    <section aria-labelledby="ix-link-title" className="ix-page ix-page-wide">
      <div className="ix-header">
        <div className="ix-header-text">
          <Link className="ix-back" to="/imports">
            ‹ Imports
          </Link>
          <h1 id="ix-link-title">Link historical records</h1>
          <p className="ix-lead">
            Each row is a name as written in the workbook. Tick the ones whose suggestion is right and link them
            together, or open a row to choose a student, match a rank or void a record. Nothing is linked until you say
            so, and a link can be undone.
          </p>
        </div>
        <div className="ix-link-progress">
          <p className="ix-small ix-flush">
            <strong className="ix-big-count">{linkedNames}</strong> of {totalNames} names linked
          </p>
          <progress aria-label="Names linked" max={Math.max(totalNames, 1)} value={linkedNames} />
        </div>
      </div>

      <div className="ix-filters">
        <label className="ix-field ix-field-wide">
          Find a name
          <input
            placeholder="Name as written"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              resetRows();
            }}
          />
        </label>
        <label className="ix-field">
          Import
          <select
            value={batch}
            onChange={(event) => {
              setBatch(event.target.value);
              show(view);
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

      <div aria-label="Show" className="ix-chips" role="group">
        {VIEWS.map((item) => (
          <button aria-pressed={view === item.view} className="ix-chip" key={item.view} type="button" onClick={() => show(item.view)}>
            {item.label} <span className="ix-chip-count">{counts[item.view] ?? "–"}</span>
          </button>
        ))}
      </div>

      {view !== "done" ? (
        <div className="ix-card ix-card-pad ix-gold-edge ix-bulk">
          <p className="ix-flush">
            <strong>{counted(pageSelected.length, "name", "names")} selected.</strong>{" "}
            <span className="ix-muted">
              {pageSelected.length > 0 ? "Each is linked to the student shown on its row." : "Tick rows, or select every clear suggestion on this page."}
            </span>
          </p>
          <div className="ix-actions">
            <button
              className="btn-ghost"
              disabled={clearOnPage.length === 0}
              type="button"
              onClick={() => setSelected([...new Set([...selected, ...clearOnPage.map((person) => person.group_key)])])}
            >
              Select the {clearOnPage.length} clear {clearOnPage.length === 1 ? "suggestion" : "suggestions"}
            </button>
            <button className="btn-ghost" disabled={pageSelected.length === 0} type="button" onClick={() => setSelected([])}>
              Clear selection
            </button>
            <button className="btn-primary" disabled={pageSelected.length === 0 || link.isPending} type="button" onClick={() => linkNames(pageSelected)}>
              {link.isPending ? "Linking…" : pageSelected.length > 0 ? `Link ${counted(pageSelected.length, "name", "names")} to their students` : "Link selected"}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="ix-success-text ix-bold ix-flush" role="status">
          {notice}
        </p>
      ) : null}
      {link.isError && !(linkedFrom && linkedFrom === open) ? (
        <p className="ix-danger-text" role="alert">
          {errorMessage(link.error, "Those records could not be linked.")}
        </p>
      ) : null}
      {undo.isError ? (
        <p className="ix-danger-text" role="alert">
          {errorMessage(undo.error, "That link could not be undone.")}
        </p>
      ) : null}

      <div className="ix-card">
        <div aria-hidden="true" className="ix-name-row ix-name-head">
          <span />
          <span>Name as written</span>
          <span>Ranks in the records</span>
          <span>Student</span>
          <span />
        </div>
        {loading ? (
          <p className="ix-card-pad ix-muted" role="status">
            Loading the names…
          </p>
        ) : people.isError ? (
          <p className="ix-card-pad ix-danger-text" role="alert">
            {errorMessage(people.error, "The names could not be loaded. Try again in a moment.")}
          </p>
        ) : rows.length === 0 ? (
          <div className="ix-card-pad">
            {everyNameLinked ? (
              <p className="ix-success-text ix-bold ix-flush">✓ Every imported record is linked to a student.</p>
            ) : (
              <p className="ix-muted ix-flush">
                {view === "todo" && !debouncedSearch && (counts.left ?? 0) > 0
                  ? `Nothing else to link. ${counted(counts.left ?? 0, "name is", "names are")} left for now.`
                  : noneLeft
                    ? "No names are left for now."
                    : "No names match."}
              </p>
            )}
          </div>
        ) : (
          <ul className="ix-names">
            {rows.map((person) => {
              const chosen = chosenFor(person, picks);
              const isLeft = left.includes(person.group_key);
              return (
                <NameRow
                  batch={batchId}
                  chosen={chosen}
                  error={linkedFrom === person.group_key ? link.error : null}
                  key={person.group_key}
                  left={isLeft}
                  open={open === person.group_key}
                  pending={link.isPending || undo.isPending}
                  person={person}
                  sameAs={chosen ? (linkedHere[chosen.student] ?? []).find((name) => name !== person.source_name) ?? null : null}
                  selected={selected.includes(person.group_key)}
                  unticked={unticked}
                  view={view}
                  onChoose={(choice) => setPicks((current) => ({ ...current, [person.group_key]: choice }))}
                  onLeave={() => leaveName(person.group_key)}
                  onLink={() => linkNames([person], open === person.group_key ? person.group_key : null)}
                  onPutBack={() => putBack(person.group_key)}
                  onSelect={() =>
                    setSelected((current) =>
                      current.includes(person.group_key) ? current.filter((key) => key !== person.group_key) : [...current, person.group_key],
                    )
                  }
                  onTick={(record) =>
                    setUnticked((current) => (current.includes(record) ? current.filter((id) => id !== record) : [...current, record]))
                  }
                  onToggle={() => {
                    link.reset();
                    setOpen(open === person.group_key ? null : person.group_key);
                  }}
                  onUndo={() => {
                    setNotice("");
                    undo.mutate(person.record_ids);
                  }}
                />
              );
            })}
          </ul>
        )}
        <ImportPager
          page={page}
          pages={Math.ceil(listed / PAGE_SIZE)}
          total={listed}
          onPage={(next) => {
            setPage(next);
            resetRows();
          }}
        />
      </div>
    </section>
  );
}
