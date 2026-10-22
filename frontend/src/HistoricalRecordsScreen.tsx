import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  errorMessage,
  getAllDataImportBatches,
  getLegacyGradingRecord,
  getLegacyGradingRecords,
  linkLegacyGradingRecord,
  unlinkLegacyGradingRecord,
} from "./api";
import { formatMonthYear } from "./dates";
import { ImportDialog } from "./ImportDialog";
import { ImportPager } from "./ImportPager";
import { RankFix, SomeoneElse, VoidRecord } from "./LinkRecordsScreen";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";

type Filter = "all" | "unlinked" | "linked" | "voided";
type Chosen = { student: number; name: string };

/** A persistent view of imported history, including records no longer in the linking queue. */
export function HistoricalRecordsScreen() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const filter: Filter = (["all", "unlinked", "linked", "voided"] as const).find((item) => item === params.get("filter")) ?? "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const batch = Number(params.get("batch")) || undefined;
  const search = params.get("search") ?? "";
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "unlink" | "void" | null>(null);
  const { refresh } = useLegacyLinking();

  const imports = useQuery({
    queryKey: ["imports", "historical"],
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const records = useQuery({
    queryKey: ["legacyRecords", "browse", filter, page, batch, search],
    queryFn: () => getLegacyGradingRecords({
      page,
      page_size: 50,
      batch,
      search: search || undefined,
      linked: filter === "linked" ? true : filter === "unlinked" ? false : undefined,
      voided: filter === "voided" ? true : filter === "linked" || filter === "unlinked" ? false : undefined,
    }),
  });
  const detail = useQuery({
    queryKey: ["legacyRecords", "detail", id],
    queryFn: () => getLegacyGradingRecord(Number(id)),
    enabled: Boolean(id),
  });
  const record = detail.data;
  const link = useMutation({
    mutationFn: (replace: boolean) => linkLegacyGradingRecord(Number(id), chosen!.student, replace),
    onSuccess: async () => { await refresh(); setConfirm(null); setChosen(null); },
  });
  const unlink = useMutation({
    mutationFn: () => unlinkLegacyGradingRecord(Number(id)),
    onSuccess: async () => { await refresh(); setConfirm(null); },
  });

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }

  return (
    <section aria-labelledby="ix-history-title" className="ix-page ix-page-wide">
      <div className="ix-header">
        <div className="ix-header-text">
          <Link className="ix-back" to="/imports">‹ Imports</Link>
          <h1 id="ix-history-title">Historical records</h1>
          <p className="ix-lead">Find an imported record again to correct its link or mapped ranks. The workbook text stays as written.</p>
        </div>
        <Link className="btn-secondary" to="/imports/records">Link unassigned records</Link>
      </div>
      <div className="ix-two-col ix-two-col-queue">
        <div className="ix-section">
          {!id ? (
            <p className="ix-card ix-card-pad ix-muted">Choose a record to inspect and correct it.</p>
          ) : detail.isPending ? (
            <p role="status">Loading record…</p>
          ) : detail.isError || !record ? (
            <p role="alert" className="ix-danger-text">{errorMessage(detail.error, "This record could not be loaded.")}</p>
          ) : (
            <div className="ix-card ix-card-pad ix-section" key={record.id}>
              <h2 className="ix-title ix-flush">“{record.source_name}” · {formatMonthYear(record.cycle_year, record.cycle_month)}</h2>
              <p className="ix-muted">{record.record_kind.replaceAll("_", " ")} · {record.source_section} · {record.outcome_display || record.attendance_status_display}</p>
              {record.report ? <p>Report as written: {record.report}</p> : null}
              {record.note ? <p>Other workbook notes: {record.note}</p> : null}
              {record.is_void ? (
                <p className="ix-danger-text">Voided: {record.void_reason} {record.voided_by_email ? `· ${record.voided_by_email}` : ""}</p>
              ) : (
                <>
                  <RankFix record={record} onDone={refresh} showAll />
                  <p>Linked student: <strong>{record.student_display_name || "None"}</strong></p>
                  <SomeoneElse chosen={chosen} onChoose={setChosen} />
                  {link.isError ? <p role="alert" className="ix-danger-text">{errorMessage(link.error, "The link could not be saved.")}</p> : null}
                  {unlink.isError ? <p role="alert" className="ix-danger-text">{errorMessage(unlink.error, "The link could not be removed.")}</p> : null}
                  <div className="ix-actions">
                    <button className="btn-primary" disabled={!chosen || link.isPending} type="button" onClick={() => {
                      if (record.student && record.student !== chosen?.student) setConfirm("replace");
                      else link.mutate(false);
                    }}>
                      {record.student ? "Change linked student" : "Link to selected student"}
                    </button>
                    {record.student ? <button className="btn-ghost" type="button" onClick={() => setConfirm("unlink")}>Unlink student…</button> : null}
                    <button className="btn-ghost ix-danger-text" type="button" onClick={() => setConfirm("void")}>Void record…</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="ix-card ix-section">
          <div className="ix-section ix-queue-head">
            <label className="ix-field">Show
              <select value={filter} onChange={(event) => update("filter", event.target.value)}>
                <option value="all">All records</option>
                <option value="unlinked">Unlinked</option>
                <option value="linked">Linked</option>
                <option value="voided">Voided</option>
              </select>
            </label>
            <label className="ix-field">Import
              <select value={batch ?? ""} onChange={(event) => update("batch", event.target.value)}>
                <option value="">Every import</option>
                {(imports.data?.results ?? []).map((item) => <option key={item.id} value={item.id}>{item.original_filename}</option>)}
              </select>
            </label>
            <label className="ix-field">Name as written
              <input type="search" value={search} onChange={(event) => update("search", event.target.value)} />
            </label>
          </div>
          {records.isPending ? <p role="status">Loading records…</p> : records.isError ? (
            <p role="alert" className="ix-danger-text">{errorMessage(records.error, "Records could not be loaded.")}</p>
          ) : (
            <>
              {records.data.results.length === 0 ? <p className="ix-muted ix-card-pad">No records match these filters.</p> : null}
              <ol className="ix-queue">
                {records.data.results.map((item) => <li key={item.id}>
                  <Link className="ix-queue-text" to={`/imports/history/${item.id}?${params}`}>
                    <strong>“{item.source_name}” · {formatMonthYear(item.cycle_year, item.cycle_month)}</strong>
                    <span className="ix-small ix-muted">{item.is_void ? "Voided" : item.student_display_name || "Unlinked"}</span>
                  </Link>
                </li>)}
              </ol>
              <ImportPager page={page} pages={Math.ceil(records.data.count / 50)} total={records.data.count} onPage={(next) => update("page", String(next))} />
            </>
          )}
        </div>
      </div>
      {confirm === "replace" && record && chosen ? <ImportDialog
        title={`Move “${record.source_name}” to ${chosen.name}?`}
        confirmLabel="Replace link"
        pending={link.isPending}
        pendingLabel="Replacing…"
        error={link.isError ? errorMessage(link.error, "The link could not be replaced.") : null}
        onClose={() => setConfirm(null)}
        onConfirm={() => link.mutate(true)}
      ><p>This replaces the existing link to {record.student_display_name}. The change is recorded.</p></ImportDialog> : null}
      {confirm === "unlink" && record ? <ImportDialog
        title={`Unlink “${record.source_name}” from ${record.student_display_name}?`}
        confirmLabel="Unlink student"
        pending={unlink.isPending}
        pendingLabel="Unlinking…"
        error={unlink.isError ? errorMessage(unlink.error, "The link could not be removed.") : null}
        onClose={() => setConfirm(null)}
        onConfirm={() => unlink.mutate()}
      ><p>The historical record remains and returns to the linking queue.</p></ImportDialog> : null}
      {confirm === "void" && record ? <VoidRecord record={record} onClose={() => setConfirm(null)} onDone={refresh} /> : null}
    </section>
  );
}
