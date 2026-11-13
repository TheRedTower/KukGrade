import { useState } from "react";
import { PageHeader } from "./PageHeader";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

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
import { Pagination } from "./Pagination";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { useIdParam } from "./recordStatus";
import { type Chosen } from "./linkRecords";
import { RankFix, SomeoneElse, VoidRecord } from "./LinkRecordParts";
import { useLegacyLinking } from "./useLegacyLinking";
import "./Imports.css";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { keys } from "./queryKeys";
import { LoadingState } from "./LoadingState";

type Filter = "all" | "unlinked" | "linked" | "voided";

const PAGE_SIZE = 50;

/** A persistent view of imported history, including records no longer in the linking queue. */
export function HistoricalRecordsScreen() {
  // The record open beside the list, if any.
  const id = useIdParam();
  const recordId = id ?? 0;
  const filters = useUrlFilters();
  const filter: Filter = filters.oneOf("filter", ["all", "unlinked", "linked", "voided"] as const, "all");
  const page = filters.page;
  const batch = Number(filters.value("batch")) || undefined;
  const search = filters.value("search");
  const searched = search.trim();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "unlink" | "void" | null>(null);
  const { refresh } = useLegacyLinking();

  const imports = useQuery({
    queryKey: keys.imports.historical(),
    queryFn: () => getAllDataImportBatches({ kind: "LEGACY_GRADINGS", status: "COMMITTED" }),
  });
  const paged = usePagedQuery({
    queryKey: keys.legacyRecords.browse(filter, page, batch, searched),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
    queryFn: () =>
      getLegacyGradingRecords({
        page,
        page_size: PAGE_SIZE,
        batch,
        search: searched || undefined,
        linked: filter === "linked" ? true : filter === "unlinked" ? false : undefined,
        voided: filter === "voided" ? true : filter === "linked" || filter === "unlinked" ? false : undefined,
      }),
  });
  const records = paged.query;
  const detail = useQuery({
    queryKey: keys.legacyRecords.detail(recordId),
    queryFn: () => getLegacyGradingRecord(recordId),
    enabled: id !== null,
  });
  const record = detail.data;
  const link = useMutation({
    mutationFn: (replace: boolean) => linkLegacyGradingRecord(recordId, chosen!.student, replace),
    onSuccess: async () => {
      await refresh();
      setConfirm(null);
      setChosen(null);
    },
  });
  const unlink = useMutation({
    mutationFn: () => unlinkLegacyGradingRecord(recordId),
    onSuccess: async () => {
      await refresh();
      setConfirm(null);
    },
  });

  return (
    <section aria-labelledby="ix-history-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title="Historical records"
        titleId="ix-history-title"
        subtitle="Find an imported record again to correct its link or mapped ranks. The workbook text stays as written."
        actions={
          <Link className={buttonClass({ variant: "secondary" })} to="/imports/records">
            Link unassigned records
          </Link>
        }
      />
      <div className="ix-two-col ix-two-col-queue">
        <div className="stack stack--3">
          {id === null ? (
            <p className="card subtext">Choose a record to inspect and correct it.</p>
          ) : detail.isPending ? (
            <LoadingState>Loading record…</LoadingState>
          ) : detail.isError || !record ? (
            <ErrorText>{errorMessage(detail.error, "This record could not be loaded.")}</ErrorText>
          ) : (
            <div className="card stack stack--3" key={record.id}>
              <h2 className="ix-title ix-flush">
                “{record.source_name}” · {formatMonthYear(record.cycle_year, record.cycle_month)}
              </h2>
              <p className="subtext">
                {record.record_kind_display} · {record.source_section} ·{" "}
                {record.outcome_display || record.attendance_status_display}
              </p>
              {record.report ? <p>Report as written: {record.report}</p> : null}
              {record.note ? <p>Other workbook notes: {record.note}</p> : null}
              {record.is_void ? (
                <p className="ix-danger-text">
                  Voided: {record.void_reason} {record.voided_by_name ? `· ${record.voided_by_name}` : ""}
                </p>
              ) : (
                <>
                  <RankFix record={record} onDone={refresh} showAll />
                  <p>
                    Linked student: <strong>{record.student_display_name || "None"}</strong>
                  </p>
                  <SomeoneElse chosen={chosen} onChoose={setChosen} />
                  {link.isError ? (
                    <ErrorText>{errorMessage(link.error, "The link could not be saved.")}</ErrorText>
                  ) : null}
                  {unlink.isError ? (
                    <ErrorText>{errorMessage(unlink.error, "The link could not be removed.")}</ErrorText>
                  ) : null}
                  <div className="row row--wrap">
                    <Button
                      variant="primary"
                      disabled={!chosen || link.isPending}
                      onClick={() => {
                        if (record.student && record.student !== chosen?.student) setConfirm("replace");
                        else link.mutate(false);
                      }}
                    >
                      {record.student ? "Change linked student" : "Link to selected student"}
                    </Button>
                    {record.student ? (
                      <Button variant="ghost" onClick={() => setConfirm("unlink")}>
                        Unlink student…
                      </Button>
                    ) : null}
                    <Button variant="ghost" className="ix-danger-text" onClick={() => setConfirm("void")}>
                      Void record…
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="card card--flush stack stack--3">
          <div className="stack stack--3 ix-queue-head">
            <label className="field field--sentence">
              <span>Show</span>
              <select
                value={filter}
                onChange={(event) => filters.set({ filter: event.target.value === "all" ? null : event.target.value })}
              >
                <option value="all">All records</option>
                <option value="unlinked">Unlinked</option>
                <option value="linked">Linked</option>
                <option value="voided">Voided</option>
              </select>
            </label>
            <label className="field field--sentence">
              <span>Import</span>
              <select value={batch ?? ""} onChange={(event) => filters.set({ batch: event.target.value })}>
                <option value="">Every import</option>
                {(imports.data?.results ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.original_filename}
                  </option>
                ))}
              </select>
            </label>
            <SearchField label="Name as written" value={search} onChange={(value) => filters.set({ search: value })} />
          </div>
          {records.isPending ? (
            <LoadingState>Loading records…</LoadingState>
          ) : records.isError ? (
            <ErrorText>{errorMessage(records.error, "Records could not be loaded.")}</ErrorText>
          ) : (
            <>
              {records.data.results.length === 0 ? (
                <p className="subtext ix-card-pad">No records match these filters.</p>
              ) : null}
              <ol className="list-plain ix-queue">
                {records.data.results.map((item) => (
                  <li key={item.id}>
                    <Link className="ix-queue-text" to={`/imports/history/${item.id}?${filters.query}`}>
                      <strong>
                        “{item.source_name}” · {formatMonthYear(item.cycle_year, item.cycle_month)}
                      </strong>
                      <span className="subtext">
                        {item.is_void ? "Voided" : item.student_display_name || "Unlinked"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
              <Pagination flush label="Pages of records" noun={["record", "records"]} {...paged.pager} />
            </>
          )}
        </div>
      </div>
      {confirm === "replace" && record && chosen ? (
        <ConfirmDialog
          cancelLabel="Not yet"
          title={`Move “${record.source_name}” to ${chosen.name}?`}
          confirmLabel="Replace link"
          pending={link.isPending}
          pendingLabel="Replacing…"
          error={link.isError ? errorMessage(link.error, "The link could not be replaced.") : null}
          onClose={() => setConfirm(null)}
          onConfirm={() => link.mutate(true)}
        >
          <p>This replaces the existing link to {record.student_display_name}. The change is recorded.</p>
        </ConfirmDialog>
      ) : null}
      {confirm === "unlink" && record ? (
        <ConfirmDialog
          cancelLabel="Not yet"
          title={`Unlink “${record.source_name}” from ${record.student_display_name}?`}
          confirmLabel="Unlink student"
          pending={unlink.isPending}
          pendingLabel="Unlinking…"
          error={unlink.isError ? errorMessage(unlink.error, "The link could not be removed.") : null}
          onClose={() => setConfirm(null)}
          onConfirm={() => unlink.mutate()}
        >
          <p>The historical record remains and returns to the linking queue.</p>
        </ConfirmDialog>
      ) : null}
      {confirm === "void" && record ? (
        <VoidRecord record={record} onClose={() => setConfirm(null)} onDone={refresh} />
      ) : null}
    </section>
  );
}
