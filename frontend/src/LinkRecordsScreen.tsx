import { useState } from "react";
import { PageHeader } from "./PageHeader";
import { ChoiceGroup } from "./ChoiceGroup";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  type LegacyPerson,
  errorMessage,
  getAllDataImportBatches,
  getLegacyPeople,
  getLegacyPeopleSummary,
} from "./api";
import { ErrorText } from "./ErrorText";
import { Pagination } from "./Pagination";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { type NameItem, type NameView, NamesTable } from "./LinkNameRow";
import { type Chosen, recordsToLink } from "./linkRecords";
import { useSiteSettingsQuery } from "./queries";
import { useLeftNames } from "./useLeftNames";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";
import { Button } from "./Button";
import { keys } from "./queryKeys";
import { agreeing, counted } from "./plural";
import { CheckIcon } from "./Icons";
import { LoadingState } from "./LoadingState";
import { Field } from "./Field";
import { Select } from "./Select";

const PAGE_SIZE = 50;

const NAME_VIEWS: readonly NameView[] = ["todo", "clear", "choose", "none", "left", "done"];

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
 * workbook, many at a time. KukGrade only suggests; nothing is
 * linked until a person says so, and a link can be undone.
 */
export function LinkRecordsScreen() {
  const { link, undo } = useLegacyLinking();
  // The most records one link request takes, as the server serves it.
  const linkLimit = useSiteSettingsQuery().data?.imports.bulk_link_limit;
  const { leave, putBack, error: leftError, reset: resetLeft } = useLeftNames();
  const filters = useUrlFilters();
  const view = filters.oneOf("view", NAME_VIEWS, "todo");
  const batch = filters.value("batch");
  const search = filters.value("search");
  const page = filters.page;
  const setPage = filters.setPage;
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, Chosen>>({});
  const [unticked, setUnticked] = useState<number[]>([]);
  const [linkedHere, setLinkedHere] = useState<Record<number, string[]>>({});
  const [notice, setNotice] = useState("");
  // The open row a link was started from, so its failure shows in that row.
  const [linkedFrom, setLinkedFrom] = useState<string | null>(null);
  const debouncedSearch = search.trim();

  const batchId = batch ? Number(batch) : undefined;

  const imports = useQuery({
    queryKey: keys.imports.historical(),
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const summary = useQuery({
    queryKey: keys.legacyPeople.summary(batchId),
    queryFn: () => getLegacyPeopleSummary({ batch: batchId, set_aside: "exclude" }),
  });
  const paged = usePagedQuery({
    queryKey: keys.legacyPeople.list(view, batchId, debouncedSearch, page),
    placeholderData: keepPreviousData,
    page,
    pageSize: PAGE_SIZE,
    onPage: (next) => {
      setPage(next);
      resetRows();
    },
    queryFn: () =>
      getLegacyPeople({
        batch: batchId,
        linked: view === "done",
        search: debouncedSearch || undefined,
        page,
        page_size: PAGE_SIZE,
        ...(view === "done" ? {} : { set_aside: view === "left" ? ("only" as const) : ("exclude" as const) }),
        ...(view === "clear" || view === "choose" || view === "none" ? { suggestion: view } : {}),
      }),
  });
  const people = paged.query;

  const counts: Record<NameView, number | undefined> = {
    todo: summary.data?.names,
    clear: summary.data?.clear,
    choose: summary.data?.choose,
    none: summary.data?.none,
    left: summary.data?.set_aside,
    done: summary.data?.with_a_link,
  };
  // Disjoint, so a name partly linked counts once, as still to link.
  const linkedNames = summary.data?.linked ?? 0;
  const totalNames = linkedNames + (counts.todo ?? 0) + (counts.left ?? 0);

  const loading = people.isPending || people.isPlaceholderData;
  const rows = loading ? [] : (people.data?.results ?? []);
  const pageSelected = rows.filter(
    (person) =>
      selected.includes(person.group_key) && chosenFor(person, picks) && recordsToLink(person, unticked).length > 0,
  );
  const selectedRecords = pageSelected.reduce((total, person) => total + recordsToLink(person, unticked).length, 0);
  const tooMany = linkLimit !== undefined && selectedRecords > linkLimit;
  const clearOnPage = rows.filter((person) => view !== "done" && person.suggestion === "clear");

  // Selection and an open row belong to the rows on screen.
  function resetRows() {
    setOpen(null);
    setSelected([]);
  }

  // A filter changed: the first page of what it shows, nothing carried over.
  function refilter(updates: Parameters<typeof filters.set>[0]) {
    filters.set(updates);
    setNotice("");
    resetRows();
  }

  function show(next: NameView) {
    refilter({ view: next === "todo" ? null : next });
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
        setPage(1);
        setOpen(null);
        setNotice(
          names.length === 1
            ? `Linked “${names[0].source_name}” to ${chosenFor(names[0], picks)?.name}.`
            : `Linked ${counted(names.length, "name", "names")} to their students.`,
        );
      },
    });
  }

  // The row closes once the server has the name aside; if it fails, it stays open and says so.
  function leaveName(key: string) {
    resetLeft();
    leave(key, {
      onSuccess: () => {
        setPage(1);
        setOpen(null);
        setSelected((current) => current.filter((other) => other !== key));
      },
    });
  }

  const everyNameLinked = view === "todo" && !debouncedSearch && counts.todo === 0 && counts.left === 0;

  return (
    <section aria-labelledby="ix-link-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title="Link historical records"
        titleId="ix-link-title"
        subtitle="Each row is a name as written in the workbook. Tick the ones whose suggestion is right and link them together, or open a row to choose a student, match a rank or void a record. Nothing is linked until you say so, and a link can be undone."
      >
        <div className="ix-link-progress">
          <p className="ix-flush">
            <strong className="stat__value">{linkedNames}</strong> of {totalNames} names linked
          </p>
          <progress aria-label="Names linked" max={Math.max(totalNames, 1)} value={linkedNames} />
        </div>
      </PageHeader>

      <div className="filter-bar" role="search" aria-label="Name filters">
        <SearchField
          label="Find a name"
          placeholder="Name as written"
          value={search}
          onChange={(value) => {
            filters.set({ search: value });
            resetRows();
          }}
        />
        <Field label="Import" look="label">
          {(control) => (
            <Select
              {...control}
              all="Every import"
              options={(imports.data?.results ?? []).map((item) => ({
                value: String(item.id),
                label: item.original_filename,
              }))}
              value={batch}
              onChange={(value) => refilter({ batch: value })}
            />
          )}
        </Field>
      </div>

      <ChoiceGroup
        choices={VIEWS.map((item) => ({ value: item.view, label: item.label, count: counts[item.view] ?? "–" }))}
        label="Show"
        look="chips"
        value={view}
        onChange={show}
      />

      {view !== "done" ? (
        <div className="card ix-gold-edge ix-bulk">
          <p className="ix-flush">
            <strong>{counted(pageSelected.length, "name", "names")} selected.</strong>{" "}
            <span className="subtext">
              {pageSelected.length > 0
                ? "Each is linked to the student shown on its row."
                : "Tick rows, or select every clear suggestion on this page."}
            </span>
          </p>
          <div className="row row--wrap">
            <Button
              variant="ghost"
              disabled={clearOnPage.length === 0}
              onClick={() => setSelected([...new Set([...selected, ...clearOnPage.map((person) => person.group_key)])])}
            >
              Select the {clearOnPage.length} clear {agreeing(clearOnPage.length, "suggestion", "suggestions")}
            </Button>
            <Button variant="ghost" disabled={pageSelected.length === 0} onClick={() => setSelected([])}>
              Clear selection
            </Button>
            <Button
              variant="primary"
              disabled={pageSelected.length === 0 || tooMany || link.isPending}
              onClick={() => linkNames(pageSelected)}
            >
              {link.isPending
                ? "Linking…"
                : pageSelected.length > 0
                  ? `Link ${counted(pageSelected.length, "name", "names")} to their students`
                  : "Link selected"}
            </Button>
          </div>
        </div>
      ) : null}

      {tooMany ? (
        <p className="ix-warning-text item-title ix-flush" role="status">
          {`${selectedRecords} records are selected; link at most ${linkLimit} at a time. Untick some names.`}
        </p>
      ) : null}
      {notice ? (
        <p className="ix-success-text item-title ix-flush" role="status">
          {notice}
        </p>
      ) : null}
      {leftError ? (
        <ErrorText>{errorMessage(leftError, "That name could not be left for now or put back. Try again.")}</ErrorText>
      ) : null}
      {link.isError && !(linkedFrom && linkedFrom === open) ? (
        <ErrorText>{errorMessage(link.error, "Those records could not be linked.")}</ErrorText>
      ) : null}
      {undo.isError ? <ErrorText>{errorMessage(undo.error, "That link could not be undone.")}</ErrorText> : null}

      <div className="card card--flush">
        {loading ? (
          <LoadingState>Loading the names…</LoadingState>
        ) : people.isError ? (
          <div className="ix-card-pad stack stack--3">
            <ErrorText className="ix-flush">
              {errorMessage(people.error, "The names could not be loaded. Try again in a moment.")}
            </ErrorText>
            {page > 1 ? (
              <Button variant="ghost" onClick={() => setPage(1)}>
                Back to the first page
              </Button>
            ) : null}
          </div>
        ) : rows.length === 0 ? (
          <div className="ix-card-pad">
            {everyNameLinked ? (
              <p className="row ix-success-text item-title ix-flush">
                <CheckIcon /> Every imported record is linked to a student.
              </p>
            ) : (
              <p className="subtext ix-flush">
                {view === "todo" && !debouncedSearch && (counts.left ?? 0) > 0
                  ? `Nothing else to link. ${counted(counts.left ?? 0, "name is", "names are")} left for now.`
                  : view === "left"
                    ? "No names are left for now."
                    : "No names match."}
              </p>
            )}
          </div>
        ) : (
          <NamesTable
            items={rows.map((person): NameItem => {
              const chosen = chosenFor(person, picks);
              return {
                batch: batchId,
                chosen,
                error: linkedFrom === person.group_key ? link.error : null,
                // The server keeps the list: only that view shows names left for now.
                left: view === "left",
                open: open === person.group_key,
                pending: link.isPending || undo.isPending,
                person,
                sameAs: chosen
                  ? ((linkedHere[chosen.student] ?? []).find((name) => name !== person.source_name) ?? null)
                  : null,
                selected: selected.includes(person.group_key),
                unticked,
                view,
                onChoose: (choice) => setPicks((current) => ({ ...current, [person.group_key]: choice })),
                onLeave: () => leaveName(person.group_key),
                onLink: () => linkNames([person], open === person.group_key ? person.group_key : null),
                onPutBack: () => {
                  resetLeft();
                  putBack(person.group_key, { onSuccess: () => setPage(1) });
                },
                onSelect: () =>
                  setSelected((current) =>
                    current.includes(person.group_key)
                      ? current.filter((key) => key !== person.group_key)
                      : [...current, person.group_key],
                  ),
                onTick: (record) =>
                  setUnticked((current) =>
                    current.includes(record) ? current.filter((id) => id !== record) : [...current, record],
                  ),
                onToggle: () => {
                  if (!link.isPending) link.reset();
                  setOpen(open === person.group_key ? null : person.group_key);
                },
                onUndo: () => {
                  setNotice("");
                  undo.mutate(person.record_ids, { onSuccess: () => setPage(1) });
                },
              };
            })}
          />
        )}
        <Pagination flush label="Pages of names" noun={["name", "names"]} {...paged.pager} />
      </div>
    </section>
  );
}
