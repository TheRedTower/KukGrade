import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  type DataImportBatch,
  type DataImportRow,
  type LegacyPerson,
  bulkLinkLegacyRecords,
  errorMessage,
  getDataImportRows,
  getLegacyGradingRecords,
  getLegacyPeople,
  unlinkLegacyGradingRecord,
  voidDataImportRecords,
} from "./api";
import { useAuth } from "./auth";
import { formatShortDateTime } from "./dates";
import { ImportDialog } from "./ImportDialog";
import { useDebouncedValue } from "./useDebouncedValue";

const ROWS_PAGE_SIZE = 50;
const LINK_GROUPS_SHOWN = 4;

type RowFilter = "all" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "corrected";

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2025-06" as "Jun 2025". */
function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function periodRange(person: LegacyPerson): string {
  const first = periodLabel(person.first_period);
  const last = periodLabel(person.last_period);
  return first === last ? first : `${first} to ${last}`;
}

function rowName(row: DataImportRow, roster: boolean): string {
  if (!roster) return row.values.name || "(no name)";
  return [row.values.first_name, row.values.last_name].filter(Boolean).join(" ") || "(no name)";
}

function rowDetail(row: DataImportRow, roster: boolean): string {
  const values = row.values;
  if (roster) {
    const fixes = row.corrected_fields.length
      ? `your fix to ${row.corrected_fields.map((field) => field.replaceAll("_", " ")).join(", ")}`
      : "";
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

/** Past gradings: who each record is, linked on the spot (FDR-054). */
function LinkPanel({ batch }: { batch: DataImportBatch }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canLink = Boolean(user?.can_reconcile_imported_history);
  // Linked here, so a name stays on screen (with Undo) once it leaves the
  // "not linked" list the server returns.
  const [linked, setLinked] = useState<Record<string, { person: LegacyPerson; name: string }>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const awaiting = useQuery({
    queryKey: ["legacyRecords", "awaitingLinkCount", batch.id],
    queryFn: () => getLegacyGradingRecords({ batch: batch.id, awaiting_link: true, page_size: 1 }),
  });
  const people = useQuery({
    queryKey: ["legacyPeople", batch.id, "unlinked"],
    queryFn: () => getLegacyPeople({ batch: batch.id, linked: false, page_size: LINK_GROUPS_SHOWN }),
    enabled: canLink,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["legacyRecords"] });
    await queryClient.invalidateQueries({ queryKey: ["legacyPeople"] });
  }

  const link = useMutation({
    mutationFn: ({ person, student }: { person: LegacyPerson; student: number; name: string }) =>
      bulkLinkLegacyRecords(person.record_ids.map((record) => ({ record, student }))),
    onSuccess: async (_records, { person, name }) => {
      setFailed(null);
      setLinked((current) => ({ ...current, [person.source_name]: { person, name } }));
      await refresh();
    },
    onError: (error) => setFailed(errorMessage(error, "Those records could not be linked.")),
  });
  const undo = useMutation({
    mutationFn: (person: LegacyPerson) =>
      Promise.all(person.record_ids.map((id) => unlinkLegacyGradingRecord(id))),
    onSuccess: async (_records, person) => {
      setFailed(null);
      setLinked((current) => {
        const next = { ...current };
        delete next[person.source_name];
        return next;
      });
      await refresh();
    },
    onError: (error) => setFailed(errorMessage(error, "Those records could not be unlinked.")),
  });

  const fromServer = people.data?.results ?? [];
  const shown = [
    ...Object.values(linked).map((entry) => entry.person),
    ...fromServer.filter((person) => !linked[person.source_name]),
  ].slice(0, LINK_GROUPS_SHOWN + Object.keys(linked).length);
  const waiting = awaiting.data?.count;
  const busy = link.isPending || undo.isPending;

  return (
    <section aria-labelledby="ix-link-h" className="ix-card ix-gold-edge">
      <div className="ix-row" style={{ alignItems: "flex-end" }}>
        <div className="ix-row-main" style={{ flexBasis: "24rem" }}>
          <p className="ix-eyebrow">Next job</p>
          <h2 id="ix-link-h" style={{ margin: "0 0 0.25rem", fontSize: "1.375rem" }}>
            Who is each record?
          </h2>
          <p className="ix-muted ix-small">
            Grouped by the name as written. KukGrade suggests a student; nothing is linked until
            you say so. A linked record shows in that student’s history.
          </p>
        </div>
        {waiting !== undefined ? (
          <p className="ix-small" style={{ margin: 0 }}>
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
            <div
              className="ix-row"
              key={person.source_name}
              style={done ? { background: "var(--color-success-surface)" } : undefined}
            >
              <div className="ix-row-main" style={{ flexBasis: "14rem" }}>
                <p className="ix-strong">
                  “{person.source_name}” · {counted(person.records, "record", "records")}
                </p>
                <p className="ix-muted ix-small">{periodRange(person)}</p>
              </div>
              <div className="ix-actions" style={{ flex: "2 1 20rem" }}>
                {done ? (
                  <>
                    <span className="ix-success-text" style={{ fontWeight: 700 }}>
                      ✓ Linked to {done.name}
                    </span>
                    <button
                      className="ix-link-button"
                      disabled={busy}
                      type="button"
                      onClick={() => undo.mutate(person)}
                    >
                      Undo
                    </button>
                  </>
                ) : person.shared && person.candidates.length > 1 ? (
                  <>
                    <span className="ix-warning-text ix-small" style={{ flexBasis: "100%", fontWeight: 600 }}>
                      Students share this name. Choose one.
                    </span>
                    {person.candidates.slice(0, 3).map((candidate) => (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        key={candidate.student}
                        type="button"
                        onClick={() =>
                          link.mutate({ person, student: candidate.student, name: candidate.full_name })
                        }
                      >
                        {candidate.full_name} · {candidate.current_rank_name}
                      </button>
                    ))}
                  </>
                ) : best ? (
                  <>
                    <span style={{ flex: "1 1 12rem", minWidth: 0 }}>
                      <span className="ix-muted ix-small" style={{ display: "block" }}>
                        Suggested
                      </span>
                      <span style={{ display: "block", fontWeight: 600 }}>
                        {best.full_name} · {best.current_rank_name}
                      </span>
                      {best.reasons.length ? (
                        <span className="ix-muted ix-small" style={{ display: "block" }}>
                          {best.reasons.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <button
                      className="btn-primary"
                      disabled={busy}
                      type="button"
                      onClick={() => link.mutate({ person, student: best.student, name: best.full_name })}
                    >
                      {person.records === 1 ? "Link it" : `Link all ${person.records}`}
                    </button>
                    <Link className="btn-ghost" to="/gradings/legacy-records">
                      Someone else
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="ix-muted ix-small">No student looks like this.</span>
                    <Link className="btn-secondary" to="/gradings/legacy-records">
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
        <div className="ix-row" style={{ justifyContent: "space-between" }}>
          <span className="ix-muted ix-small">
            {people.data && people.data.count > fromServer.length
              ? `${fromServer.length} of ${people.data.count} names shown. The rest are on the linking page.`
              : "Every name still to link is shown."}
          </span>
          <Link className="btn-secondary" to="/gradings/legacy-records">
            Open the linking page
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Students: what KukGrade filled in, for a second look (FDR-054). */
function SecondLook({
  batch,
  onShowFixes,
}: {
  batch: DataImportBatch;
  onShowFixes: () => void;
}) {
  const fixes = useQuery({
    queryKey: ["imports", "rows", batch.id, "correctedCount"],
    queryFn: () => getDataImportRows(batch.id, { corrected: true, page_size: 1 }),
  });
  const items: { title: string; body: string; action?: { label: string; run: () => void } }[] = [];
  const fixed = fixes.data?.count ?? 0;
  if (fixed) {
    items.push({
      title: counted(fixed, "student with your fixes", "students with your fixes"),
      body: "Values you typed in or corrected before importing.",
      action: { label: `See the ${fixed}`, run: onShowFixes },
    });
  }
  if (batch.defaults.current_rank) {
    items.push({
      title: `Rank ${batch.defaults.current_rank} given where the file had none`,
      body: "The rank you set for the whole file.",
    });
  }
  if (batch.defaults.status) {
    items.push({
      title: `Status ${batch.defaults.status.toLowerCase()} given where the file had none`,
      body: "The status you set for the whole file.",
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
          <h2 id="ix-look-h" style={{ margin: "0 0 0.25rem", fontSize: "1.375rem" }}>
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
              <p style={{ fontWeight: 700 }}>{item.title}</p>
              <p className="ix-muted ix-small">{item.body}</p>
            </div>
            {item.action ? (
              <button className="btn-secondary" type="button" onClick={item.action.run}>
                {item.action.label}
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const rows = useQuery({
    queryKey: ["imports", "rows", batch.id, filter, debounced, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getDataImportRows(batch.id, {
        outcome: filter === "all" || filter === "corrected" ? undefined : filter,
        corrected: filter === "corrected" ? true : undefined,
        search: debounced || undefined,
        page,
        page_size: ROWS_PAGE_SIZE,
      }),
  });
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
  const list = rows.data?.results ?? [];
  const total = rows.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / ROWS_PAGE_SIZE));
  const cleared = !rows.isPending && total === 0 && filter === "all" && !debounced;

  return (
    <section aria-labelledby="ix-rows-h" className="ix-card">
      <div className="ix-row" style={{ alignItems: "flex-end" }}>
        <h2 id="ix-rows-h" style={{ margin: 0, fontSize: "1.25rem", flex: "1 1 12rem" }}>
          {roster ? "Every row" : "Every record"}
        </h2>
        <label className="ix-field">
          Search
          <input
            placeholder={roster ? "Name or WKSA ID" : "Name or comment"}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <div className="ix-chips" role="group" aria-label="Show" style={{ padding: "0 1.5rem 1rem" }}>
        {tabs.map((tab) => (
          <button
            aria-pressed={filter === tab.key}
            className="ix-chip"
            key={tab.key}
            type="button"
            onClick={() => {
              onFilter(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="ix-chip-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>
      {rows.isError ? (
        <p className="ix-row ix-danger-text" role="alert">
          {errorMessage(rows.error, "The rows could not be loaded.")}
        </p>
      ) : cleared ? (
        <p className="ix-row ix-muted">
          The row-by-row list is kept for 30 days after an import, and this one’s has been
          cleared. The counts above stay for good.
        </p>
      ) : list.length === 0 && !rows.isPending ? (
        <p className="ix-row ix-muted">Nothing here.</p>
      ) : (
        <div className="ix-table-wrap" style={{ borderTop: "1px solid var(--color-border)" }}>
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
                return (
                  <tr key={row.row_number}>
                    <td className="ix-muted ix-nowrap">
                      {roster ? row.row_number : row.source_locator.replaceAll("!", " · ")}
                    </td>
                    <td style={{ fontWeight: 600 }}>{rowName(row, roster)}</td>
                    <td className="ix-muted">{rowDetail(row, roster)}</td>
                    <td>
                      <span className={`ix-pill ix-pill-${state.tone}`}>{state.label}</span>
                    </td>
                    <td className="ix-nowrap" style={{ textAlign: "right" }}>
                      {roster && row.created_id ? (
                        <Link
                          aria-label={`Open ${rowName(row, roster)}`}
                          className="ix-link-button"
                          to={`/students/${row.created_id}`}
                        >
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
      <div className="ix-table-foot">
        <span>
          Page {page} of {pages} · {ROWS_PAGE_SIZE} a page
        </span>
        <div className="ix-actions">
          <button className="btn-ghost" disabled={page <= 1} type="button" onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="btn-ghost" disabled={page >= pages} type="button" onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function VoidDialog({ batch, onClose }: { batch: DataImportBatch; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const voiding = useMutation({
    mutationFn: () => voidDataImportRecords(batch.id, reason.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["legacyRecords"] });
      await queryClient.invalidateQueries({ queryKey: ["legacyPeople"] });
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
      <p className="ix-muted" style={{ margin: 0 }}>
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

/** An import's results: its own page, with the next job on top (FDR-054). */
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
  const banner = roster
    ? [
        summary.skipped_existing
          ? `${counted(summary.skipped_existing, "student", "students")} already in KukGrade ${summary.skipped_existing === 1 ? "was" : "were"} skipped and not changed.`
          : null,
        summary.excluded ? `${counted(summary.excluded, "row", "rows")} you left out ${summary.excluded === 1 ? "was" : "were"} not imported.` : null,
      ]
    : [
        summary.excluded ? `${counted(summary.excluded, "record", "records")} you left out ${summary.excluded === 1 ? "was" : "were"} not imported.` : null,
      ];
  const unresolvedRanks = (summary.unresolved_current_rank ?? 0) + (summary.unresolved_testing_for_rank ?? 0);

  return (
    <section aria-labelledby="ix-results-title" className="ix-page">
      <div>
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 id="ix-results-title" style={{ margin: "0.25rem 0 0.25rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", overflowWrap: "anywhere" }}>
          {batch.original_filename}
          <span className="ix-pill ix-pill-success" style={{ fontSize: "0.9rem" }}>
            Imported
          </span>
        </h1>
        <p className="ix-muted ix-small">
          {roster ? "Students" : "Past gradings"} · imported by {batch.committed_by_name} on{" "}
          {formatShortDateTime(batch.committed_at)}
        </p>
      </div>

      <div className="ix-banner ix-banner-success" role="status">
        <span aria-hidden="true" className="ix-mark ix-mark-ok" style={{ width: "2.25rem", height: "2.25rem", background: "var(--color-surface)" }}>
          ✓
        </span>
        <p style={{ flex: "1 1 20rem" }}>
          <strong style={{ fontSize: "1.1rem" }}>{headline}</strong>
          {banner.filter(Boolean).length ? (
            <span style={{ display: "block" }} className="ix-small">
              {banner.filter(Boolean).join(" ")}
            </span>
          ) : null}
        </p>
      </div>

      {roster ? (
        <SecondLook batch={batch} onShowFixes={() => setFilter("corrected")} />
      ) : (
        <LinkPanel batch={batch} />
      )}

      <div className="ix-two-col">
        <RowsLedger batch={batch} filter={filter} onFilter={setFilter} />
        <aside aria-labelledby="ix-also-h" className="ix-card ix-card-pad ix-section">
          <h2 id="ix-also-h" style={{ margin: 0, fontSize: "1.125rem" }}>
            Also
          </h2>
          {roster ? (
            <>
              <div className="ix-section" style={{ gap: "0.4rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
                <p style={{ margin: 0, fontWeight: 700 }}>See the new students</p>
                <p className="ix-muted ix-small">The Students page, showing only those this import added.</p>
                <Link className="btn-secondary" style={{ alignSelf: "flex-start" }} to={`/students?source_import=${batch.id}`}>
                  Go to Students
                </Link>
              </div>
              <div className="ix-section" style={{ gap: "0.4rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
                <p style={{ margin: 0, fontWeight: 700 }}>Bring in their past gradings</p>
                <p className="ix-muted ix-small">Import the grading record workbook, then link it to these students.</p>
                <Link className="btn-secondary" style={{ alignSelf: "flex-start" }} to="/imports/new?kind=LEGACY_GRADINGS">
                  Import past gradings
                </Link>
              </div>
            </>
          ) : (
            <>
              {unresolvedRanks ? (
                <div className="ix-section" style={{ gap: "0.4rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>Match the last ranks</p>
                  <p className="ix-muted ix-small">
                    {counted(unresolvedRanks, "rank is", "ranks are")} still as written in the workbook.
                  </p>
                  <Link className="btn-secondary" style={{ alignSelf: "flex-start" }} to="/gradings/legacy-records">
                    Match ranks
                  </Link>
                </div>
              ) : null}
              {user?.can_reconcile_imported_history ? (
                <div className="ix-section" style={{ gap: "0.4rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>Wrong workbook?</p>
                  <p className="ix-muted ix-small">
                    Void the whole import. Its records are kept, marked void, with your reason.
                  </p>
                  <button className="btn-ghost ix-danger-text" style={{ alignSelf: "flex-start" }} type="button" onClick={() => setVoiding(true)}>
                    Void this import
                  </button>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
      {voiding ? <VoidDialog batch={batch} onClose={() => setVoiding(false)} /> : null}
    </section>
  );
}
