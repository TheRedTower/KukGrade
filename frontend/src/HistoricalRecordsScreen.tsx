import { useState } from "react";
import { PageHeader } from "./PageHeader";
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
import { ErrorText } from "./ErrorText";
import { formatMonthYear } from "./dates";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImportPager } from "./ImportPager";
import { type Chosen } from "./linkRecords";
import { RankFix, SomeoneElse, VoidRecord } from "./LinkRecordParts";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { useDebouncedValue } from "./useDebouncedValue";
import { keys } from "./queryKeys";

type Filter = "all" | "unlinked" | "linked" | "voided";

/** A persistent view of imported history, including records no longer in the linking queue. */
export function HistoricalRecordsScreen() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const filter: Filter = (["all", "unlinked", "linked", "voided"] as const).find((item) => item === params.get("filter")) ?? "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const batch = Number(params.get("batch")) || undefined;
  const search = params.get("search") ?? "";
  // One request when typing pauses, not one per keystroke.
  const searched = useDebouncedValue(search.trim());
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "unlink" | "void" | null>(null);
  const { refresh } = useLegacyLinking();

  const imports = useQuery({
    queryKey: keys.imports.historical(),
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const records = useQuery({
    queryKey: keys.legacyRecords.browse(filter, page, batch, searched),
    queryFn: () => getLegacyGradingRecords({
      page,
      page_size: 50,
      batch,
      search: searched || undefined,
      linked: filter === "linked" ? true : filter === "unlinked" ? false : undefined,
      voided: filter === "voided" ? true : filter === "linked" || filter === "unlinked" ? false : undefined,
    }),
  });
  const detail = useQuery({
    queryKey: keys.legacyRecords.detail(id),
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
    <section aria-labelledby="ix-history-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title="Historical records"
        titleId="ix-history-title"
        subtitle="Find an imported record again to correct its link or mapped ranks. The workbook text stays as written."
        actions={<Link className={buttonClass({ variant: "secondary" })} to="/imports/records">Link unassigned records</Link>}
      />
      <div className="ix-two-col ix-two-col-queue">
        <div className="ix-section">
          {!id ? (
            <p className="card subtext">Choose a record to inspect and correct it.</p>
          ) : detail.isPending ? (
            <p role="status">Loading record…</p>
          ) : detail.isError || !record ? (
            <ErrorText>{errorMessage(detail.error, "This record could not be loaded.")}</ErrorText>
          ) : (
            <div className="card ix-section" key={record.id}>
              <h2 className="ix-title ix-flush">“{record.source_name}” · {formatMonthYear(record.cycle_year, record.cycle_month)}</h2>
              <p className="subtext">{record.record_kind_display} · {record.source_section} · {record.outcome_display || record.attendance_status_display}</p>
              {record.report ? <p>Report as written: {record.report}</p> : null}
              {record.note ? <p>Other workbook notes: {record.note}</p> : null}
              {record.is_void ? (
                <p className="ix-danger-text">Voided: {record.void_reason} {record.voided_by_email ? `· ${record.voided_by_email}` : ""}</p>
              ) : (
                <>
                  <RankFix record={record} onDone={refresh} showAll />
                  <p>Linked student: <strong>{record.student_display_name || "None"}</strong></p>
                  <SomeoneElse chosen={chosen} onChoose={setChosen} />
                  {link.isError ? <ErrorText>{errorMessage(link.error, "The link could not be saved.")}</ErrorText> : null}
                  {unlink.isError ? <ErrorText>{errorMessage(unlink.error, "The link could not be removed.")}</ErrorText> : null}
                  <div className="ix-actions">
                    <Button variant="primary" disabled={!chosen || link.isPending} onClick={() => {
                      if (record.student && record.student !== chosen?.student) setConfirm("replace");
                      else link.mutate(false);
                    }}>
                      {record.student ? "Change linked student" : "Link to selected student"}
                    </Button>
                    {record.student ? <Button variant="ghost" onClick={() => setConfirm("unlink")}>Unlink student…</Button> : null}
                    <Button variant="ghost" className="ix-danger-text" onClick={() => setConfirm("void")}>Void record…</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="card card--flush ix-section">
          <div className="ix-section ix-queue-head">
            <label className="field field--sentence">
              <span>Show</span>
              <select value={filter} onChange={(event) => update("filter", event.target.value)}>
                <option value="all">All records</option>
                <option value="unlinked">Unlinked</option>
                <option value="linked">Linked</option>
                <option value="voided">Voided</option>
              </select>
            </label>
            <label className="field field--sentence">
              <span>Import</span>
              <select value={batch ?? ""} onChange={(event) => update("batch", event.target.value)}>
                <option value="">Every import</option>
                {(imports.data?.results ?? []).map((item) => <option key={item.id} value={item.id}>{item.original_filename}</option>)}
              </select>
            </label>
            <label className="field field--sentence">
              <span>Name as written</span>
              <input type="search" value={search} onChange={(event) => update("search", event.target.value)} />
            </label>
          </div>
          {records.isPending ? <p role="status">Loading records…</p> : records.isError ? (
            <ErrorText>{errorMessage(records.error, "Records could not be loaded.")}</ErrorText>
          ) : (
            <>
              {records.data.results.length === 0 ? <p className="subtext ix-card-pad">No records match these filters.</p> : null}
              <ol className="ix-queue">
                {records.data.results.map((item) => <li key={item.id}>
                  <Link className="ix-queue-text" to={`/imports/history/${item.id}?${params}`}>
                    <strong>“{item.source_name}” · {formatMonthYear(item.cycle_year, item.cycle_month)}</strong>
                    <span className="subtext">{item.is_void ? "Voided" : item.student_display_name || "Unlinked"}</span>
                  </Link>
                </li>)}
              </ol>
              <ImportPager label="Pages of records" page={page} pages={Math.ceil(records.data.count / 50)} total={records.data.count} onPage={(next) => update("page", String(next))} />
            </>
          )}
        </div>
      </div>
      {confirm === "replace" && record && chosen ? <ConfirmDialog
        cancelLabel="Not yet"
        title={`Move “${record.source_name}” to ${chosen.name}?`}
        confirmLabel="Replace link"
        pending={link.isPending}
        pendingLabel="Replacing…"
        error={link.isError ? errorMessage(link.error, "The link could not be replaced.") : null}
        onClose={() => setConfirm(null)}
        onConfirm={() => link.mutate(true)}
      ><p>This replaces the existing link to {record.student_display_name}. The change is recorded.</p></ConfirmDialog> : null}
      {confirm === "unlink" && record ? <ConfirmDialog
        cancelLabel="Not yet"
        title={`Unlink “${record.source_name}” from ${record.student_display_name}?`}
        confirmLabel="Unlink student"
        pending={unlink.isPending}
        pendingLabel="Unlinking…"
        error={unlink.isError ? errorMessage(unlink.error, "The link could not be removed.") : null}
        onClose={() => setConfirm(null)}
        onConfirm={() => unlink.mutate()}
      ><p>The historical record remains and returns to the linking queue.</p></ConfirmDialog> : null}
      {confirm === "void" && record ? <VoidRecord record={record} onClose={() => setConfirm(null)} onDone={refresh} /> : null}
    </section>
  );
}
