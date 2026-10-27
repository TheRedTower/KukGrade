import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type DataImportBatch,
  type DataImportRow,
  type LegacyPerson,
  errorMessage,
  getDataImportRows,
  getLegacyGradingRecords,
  getLegacyPeople,
  voidDataImportRecords,
} from "./api";
import { useAuth } from "./auth";
import { formatShortDateTime } from "./dates";
import { ImportDialog } from "./ImportDialog";
import { ImportPager } from "./ImportPager";
import { usePagedRows } from "./useImportRows";
import { counted, importKindLabel, importRowName } from "./importSteps";
import { useDebouncedValue } from "./useDebouncedValue";
import { periodRange } from "./linkRecords";
import { PartialUnlinkError, useLegacyLinking } from "./useLegacyLinking";

const ROWS_PAGE_SIZE = 50;
const LINK_GROUPS_SHOWN = 4;

type RowFilter = "all" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "corrected" | "status" | "current_rank";

function rowDetail(row: DataImportRow, batch: DataImportBatch): string {
  const values = row.values;
  if (batch.kind === "STUDENT_ROSTER") {
    const names = row.corrected_fields.map(
      (field) => batch.target_fields.find((target) => target.field === field)?.name ?? field,
    );
    const fixes = names.length ? `your fix: ${names.join(", ")}` : "";
    return [values.wksa_id, values.current_rank, fixes].filter(Boolean).join(" · ");
  }
  if (values.note && !values.current_rank && !values.testing_for_rank) return `“${values.note}”`;
  const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
  return [ranks, values.outcome].filter(Boolean).join(" · ") || values.report || "";
}

function rowState(row: DataImportRow, roster: boolean): { label: string; tone: string } {
  if (row.outcome === "EXCLUDED") return { label: "Left out", tone: "neutral" };
  if (row.outcome === "SKIP_EXISTING") return { label: "Already in KukGrade", tone: "neutral" };
  if (!roster) return { label: "Imported", tone: "success" };
  return { label: row.corrected_fields.length ? "Added, your fix" : "Added", tone: "success" };
}

/** Past gradings: who each record is, linked on the spot. */
function LinkPanel({ batch }: { batch: DataImportBatch }) {
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
    <section aria-labelledby="ix-link-h" className="ix-card ix-gold-edge">
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
        <p className="ix-row ix-danger-text" role="alert">
          {errorMessage(people.error, "Suggestions could not be loaded.")}
        </p>
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
                    <button
                      aria-label={`Undo linking “${person.source_name}”`}
                      className="ix-link-button"
                      disabled={busy}
                      type="button"
                      onClick={() => undoLink(person)}
                    >
                      Undo
                    </button>
                  </>
                ) : person.suggestion === "choose" ? (
                  <>
                    <span className="ix-warning-text ix-small ix-semibold ix-full">Students share this name. Choose one.</span>
                    {person.candidates.slice(0, 3).map((candidate) => (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        key={candidate.student}
                        type="button"
                        onClick={() => linkAll(person, candidate.student, candidate.full_name)}
                      >
                        {candidate.full_name} · {candidate.current_rank_name}
                      </button>
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
                    <button
                      aria-label={`${person.records === 1 ? "Link it" : `Link all ${person.records}`}: “${person.source_name}” to ${best.full_name}`}
                      className="btn-primary"
                      disabled={busy}
                      type="button"
                      onClick={() => linkAll(person, best.student, best.full_name)}
                    >
                      {person.records === 1 ? "Link it" : `Link all ${person.records}`}
                    </button>
                    <Link className="btn-ghost" to="/imports/records">
                      Someone else
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="ix-muted ix-small">No student looks like this.</span>
                    <Link className="btn-secondary" to="/imports/records">
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
        <p className="ix-row ix-danger-text" role="alert">
          {failed}
        </p>
      ) : null}
      {canLink ? (
        <div className="ix-row ix-actions-split">
          <span className="ix-muted ix-small">
            {people.data && people.data.count > fromServer.length
              ? `${fromServer.length} of ${people.data.count} names shown. The rest are on the linking page.`
              : "Every name still to link is shown."}
          </span>
          <Link className="btn-secondary" to="/imports/records">
            Open the linking page
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** How many of a roster's added rows match a filter, for the second look. */
function useAddedCount(batch: DataImportBatch, filter: "corrected" | "status" | "current_rank") {
  return useQuery({
    queryKey: ["imports", "rows", batch.id, "addedCount", filter],
    queryFn: () =>
      getDataImportRows(batch.id, {
        outcome: "READY",
        ...(filter === "corrected" ? { corrected: true } : { filled: filter }),
        page_size: 1,
      }),
  }).data?.count;
}

/** Students: what KukGrade filled in, for a second look. */
function SecondLook({ batch, onShow }: { batch: DataImportBatch; onShow: (filter: RowFilter) => void }) {
  const fixed = useAddedCount(batch, "corrected") ?? 0;
  const givenStatus = useAddedCount(batch, "status") ?? 0;
  const givenRank = useAddedCount(batch, "current_rank") ?? 0;
  const items: { title: string; body: string; show?: RowFilter; count?: number }[] = [];
  if (givenStatus) {
    const status = batch.defaults.status ?? "ACTIVE";
    items.push({
      title: `${counted(givenStatus, "student", "students")} given the status ${status.charAt(0)}${status.slice(1).toLowerCase()}`,
      body: batch.defaults.status
        ? "The file gave them no status, so the status you set for the whole file was used."
        : "The file gave them no status, so KukGrade used Active.",
      show: "status",
      count: givenStatus,
    });
  }
  if (givenRank && batch.defaults.current_rank) {
    items.push({
      title: `${counted(givenRank, "student", "students")} given the rank ${batch.defaults.current_rank}`,
      body: "The file gave them no rank, so the rank you set for the whole file was used.",
      show: "current_rank",
      count: givenRank,
    });
  }
  if (fixed) {
    items.push({
      title: counted(fixed, "student with your fixes", "students with your fixes"),
      body: "Values you typed in or corrected before importing.",
      show: "corrected",
      count: fixed,
    });
  }
  if (batch.extra_columns.length) {
    items.push({
      title: `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept`,
      body: "Shown under Extra information on each student’s page.",
    });
  }

  return (
    <section aria-labelledby="ix-look-h" className="ix-card ix-gold-edge">
      <div className="ix-row">
        <div className="ix-row-main">
          <p className="ix-eyebrow">Worth a second look</p>
          <h2 className="ix-title" id="ix-look-h">
            What KukGrade filled in for you
          </h2>
          <p className="ix-muted ix-small">
            Everything was imported. These are the details that did not all come straight from
            the file.
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="ix-row ix-success-text">Every detail came straight from the file.</p>
      ) : (
        items.map((item) => (
          <div className="ix-row" key={item.title}>
            <div className="ix-row-main">
              <p className="ix-bold">{item.title}</p>
              <p className="ix-muted ix-small">{item.body}</p>
            </div>
            {item.show ? (
              <button className="btn-secondary" type="button" onClick={() => onShow(item.show!)}>
                See the {item.count}
              </button>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

function RowsLedger({
  batch,
  filter,
  onFilter,
}: {
  batch: DataImportBatch;
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
}) {
  const roster = batch.kind === "STUDENT_ROSTER";
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const rows = usePagedRows(
    batch.id,
    {
      outcome: filter === "READY" || filter === "SKIP_EXISTING" || filter === "EXCLUDED" ? filter : undefined,
      corrected: filter === "corrected" ? true : undefined,
      filled: filter === "status" || filter === "current_rank" ? filter : undefined,
      search: debounced || undefined,
    },
    ROWS_PAGE_SIZE,
  );
  const summary = batch.summary_json;
  const tabs: { key: RowFilter; label: string; count?: number }[] = roster
    ? [
        { key: "all", label: "All rows", count: summary.total },
        { key: "READY", label: "Added", count: summary.created },
        { key: "SKIP_EXISTING", label: "Already in KukGrade", count: summary.skipped_existing },
        { key: "EXCLUDED", label: "Left out", count: summary.excluded },
        { key: "corrected", label: "Your fixes" },
      ]
    : [
        { key: "all", label: "All records" },
        { key: "READY", label: "Imported", count: summary.total },
        { key: "EXCLUDED", label: "Left out", count: summary.excluded },
      ];
  // A second-look filter shows as a chip of its own while it is in use.
  if (filter === "status") tabs.push({ key: "status", label: "Given a status" });
  if (filter === "current_rank") tabs.push({ key: "current_rank", label: "Given a rank" });
  const list = rows.query.data?.results ?? [];
  const cleared = !rows.query.isPending && rows.total === 0 && filter === "all" && !debounced;

  return (
    <section aria-labelledby="ix-rows-h" className="ix-card">
      <div className="ix-row ix-align-end">
        <h2 className="ix-heading ix-flush ix-grow" id="ix-rows-h">
          {roster ? "Every row" : "Every record"}
        </h2>
        <label className="ix-field">
          Search
          <input
            placeholder={roster ? "Name or WKSA ID" : "Name or comment"}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div aria-label="Show" className="ix-chips ix-chips-inset" role="group">
        {tabs.map((tab) => (
          <button aria-pressed={filter === tab.key} className="ix-chip" key={tab.key} type="button" onClick={() => onFilter(tab.key)}>
            {tab.label}
            {tab.count !== undefined ? <span className="ix-chip-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>
      {rows.query.isError ? (
        <p className="ix-row ix-danger-text" role="alert">
          {errorMessage(rows.query.error, "The rows could not be loaded.")}
        </p>
      ) : cleared ? (
        <p className="ix-row ix-muted">
          The row-by-row list is kept for 30 days after an import, and this one’s has been
          cleared. The counts above stay for good.
        </p>
      ) : list.length === 0 && !rows.query.isPending ? (
        <p className="ix-row ix-muted">Nothing here.</p>
      ) : (
        <div className="ix-table-wrap ix-ruled">
          <table className="ix-table">
            <thead>
              <tr>
                <th scope="col">{roster ? "Row" : "Sheet · row"}</th>
                <th scope="col">Name</th>
                <th scope="col">Details</th>
                <th scope="col">{roster ? "What happened" : "Now"}</th>
                <th scope="col">
                  <span className="ix-visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => {
                const state = rowState(row, roster);
                const name = importRowName(row, batch.kind);
                return (
                  <tr key={row.row_number}>
                    <td className="ix-muted ix-nowrap">
                      {roster ? row.row_number : row.source_locator.replaceAll("!", " · ")}
                    </td>
                    <td className="ix-semibold">{name}</td>
                    <td className="ix-muted">{rowDetail(row, batch)}</td>
                    <td>
                      <span className={`ix-pill ix-pill-${state.tone}`}>{state.label}</span>
                    </td>
                    <td className="ix-cell-action">
                      {roster && row.created_id ? (
                        <Link aria-label={`Open ${name}`} className="ix-link-button" to={`/students/${row.created_id}`}>
                          Open
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ImportPager page={rows.page} pages={rows.pages} total={rows.total} onPage={rows.setPage} />
    </section>
  );
}

function VoidDialog({ batch, onClose }: { batch: DataImportBatch; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const voiding = useMutation({
    mutationFn: () => voidDataImportRecords(batch.id, reason.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["legacyRecords"] }),
        queryClient.invalidateQueries({ queryKey: ["legacyPeople"] }),
      ]);
      onClose();
    },
  });
  return (
    <ImportDialog
      confirmDisabled={!reason.trim()}
      confirmLabel="Void every record"
      danger
      error={voiding.isError ? errorMessage(voiding.error, "The records could not be voided.") : null}
      pending={voiding.isPending}
      pendingLabel="Voiding…"
      title={`Void the records from ${batch.original_filename}?`}
      onClose={onClose}
      onConfirm={() => voiding.mutate()}
    >
      <p className="ix-muted">
        They are kept, marked void with your reason, and leave every student’s history. This
        cannot be undone except by importing the workbook again.
      </p>
      <label className="ix-field" htmlFor="ix-void-reason">
        Why
      </label>
      <textarea id="ix-void-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    </ImportDialog>
  );
}

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
    <section aria-labelledby="ix-results-title" className="ix-page">
      <div>
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 className="ix-page-title ix-results-title" id="ix-results-title">
          {batch.original_filename}
          <span className="ix-pill ix-pill-success">Imported</span>
        </h1>
        <p className="ix-muted ix-small">
          {importKindLabel(batch.kind)} · imported by {batch.committed_by_name} on {formatShortDateTime(batch.committed_at)}
        </p>
      </div>

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
        <aside aria-labelledby="ix-also-h" className="ix-card ix-card-pad ix-section">
          <h2 className="ix-minor" id="ix-also-h">
            Also
          </h2>
          {roster ? (
            <>
              <AlsoItem body="The Students page, showing only those this import added." title="See the new students">
                <Link className="btn-secondary ix-start" to={`/students?source_import=${batch.id}`}>
                  Go to Students
                </Link>
              </AlsoItem>
              <AlsoItem body="Import the grading record workbook, then link it to these students." title="Bring in their past gradings">
                <Link className="btn-secondary ix-start" to="/imports/new?kind=LEGACY_GRADINGS">
                  Import past gradings
                </Link>
              </AlsoItem>
            </>
          ) : (
            <>
              {unresolvedRanks ? (
                <AlsoItem body={`${counted(unresolvedRanks, "rank is", "ranks are")} still as written in the workbook.`} title="Match the last ranks">
                  <Link className="btn-secondary ix-start" to="/imports/records">
                    Match ranks
                  </Link>
                </AlsoItem>
              ) : null}
              {user?.can_reconcile_imported_history ? (
                <AlsoItem body="Void the whole import. Its records are kept, marked void, with your reason." title="Wrong workbook?">
                  <button className="btn-ghost ix-danger-text ix-start" type="button" onClick={() => setVoiding(true)}>
                    Void this import
                  </button>
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
