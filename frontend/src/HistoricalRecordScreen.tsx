import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { Alert } from "./Alert";
import {
  type LegacyGradingRecord,
  errorMessage,
  getLegacyGradingRecord,
  resolveLegacyRank,
  voidLegacyGradingRecord,
} from "./api";
import { BeltSwatch } from "./Belt";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { ChevronRightIcon } from "./Icons";
import { ChoiceGroup } from "./ChoiceGroup";
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { recordMonth } from "./linkRecords";
import { useRanksQuery } from "./queries";
import { keys } from "./queryKeys";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { useLegacyRefresh } from "./useLegacyRefresh";
import "./Imports.css";

const NO_RANK = "none";

/** One of a record's ranks, chosen from the belts; "No rank" leaves it as written only. */
function RankPicker({
  record,
  field,
  label,
  written,
  current,
}: {
  record: LegacyGradingRecord;
  field: "current_rank" | "testing_for_rank";
  label: string;
  written: string;
  current: number | null;
}) {
  const refresh = useLegacyRefresh();
  const ranks = useRanksQuery().data?.results ?? [];
  const fix = useMutation({
    mutationFn: (rank: number | null) => resolveLegacyRank(record.id, field, rank),
    onSuccess: refresh,
  });
  const name = `${label} (written “${written || "blank"}”)`;
  return (
    <div className="stack stack--2">
      <h3 className="item-title">{name}</h3>
      <ChoiceGroup
        choices={[
          ...ranks.map((rank) => ({
            value: String(rank.id),
            label: (
              <>
                <BeltSwatch rank={rank} />
                {rank.name}
              </>
            ),
          })),
          { value: NO_RANK, label: "No rank" },
        ]}
        label={name}
        look="options"
        value={current === null ? NO_RANK : String(current)}
        onChange={(value) => {
          if (!fix.isPending) fix.mutate(value === NO_RANK ? null : Number(value));
        }}
      />
      {fix.isError ? <ErrorText>{errorMessage(fix.error, "That rank could not be saved.")}</ErrorText> : null}
    </div>
  );
}

function VoidRecord({ record, onClose }: { record: LegacyGradingRecord; onClose: () => void }) {
  const refresh = useLegacyRefresh();
  const [reason, setReason] = useState("");
  const voiding = useMutation({
    mutationFn: () => voidLegacyGradingRecord(record.id, reason.trim()),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <ConfirmDialog
      cancelLabel="Not yet"
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
      <p className="subtext">It is kept, marked void with your reason, and is never linked to anyone.</p>
      <div className="field field--sentence">
        <label htmlFor="ix-void-record-reason">Why</label>
        <textarea
          data-dialog-autofocus
          id="ix-void-record-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/**
 * One imported record on a page of its own: the workbook's text in full,
 * comments included, the ranks KukGrade reads from it, and who it is about.
 * Its ranks can be corrected from the belts, and it can be voided; who it is
 * is decided on its person's page.
 */
export function HistoricalRecordScreen() {
  const id = useIdParam();
  const { search } = useLocation();
  const back = { to: `/imports/history${search}`, label: "Historical records" };
  const detail = useQuery({
    queryKey: keys.legacyRecords.detail(id ?? 0),
    queryFn: () => getLegacyGradingRecord(id!),
    enabled: id !== null,
  });
  const [voiding, setVoiding] = useState(false);

  const status = recordStatus(id, detail);
  if (status || !detail.data) {
    return (
      <RecordPage
        back={back}
        error={detail.error}
        failed="This record could not be loaded."
        label="Historical record"
        loading="Loading the record…"
        missing="Record not found"
        status={status ?? "loading"}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const record = detail.data;

  return (
    <DetailPage
      actions={
        record.person !== null && !record.is_void ? (
          <Link className={buttonClass({ variant: "primary" })} to={`/imports/people/${record.person}`}>
            Open their person
          </Link>
        ) : null
      }
      back={back}
      eyebrow="Past gradings · Historical records"
      status={<p className="subtext">{record.is_void ? "Voided" : record.student_display_name || "Not linked yet"}</p>}
      testId="ix-record"
      title={`“${record.source_name}” · ${recordMonth(record)}`}
    >
      {record.is_void ? (
        <Alert tone="warning" title="Voided">
          {record.void_reason}
          {record.voided_by_name ? ` · ${record.voided_by_name}` : ""}
        </Alert>
      ) : null}
      <section aria-labelledby="ix-record-written" className="card stack stack--3">
        <h2 className="section-title" id="ix-record-written">
          As the workbook has it
        </h2>
        <dl className="facts-list facts-list--aligned facts-list--compact">
          <div>
            <dt>Written</dt>
            <dd>
              {record.record_kind_display}
              {record.source_section ? ` · ${record.source_section}` : ""}
            </dd>
          </div>
          <div>
            <dt>Rank held</dt>
            <dd>{record.source_current_rank_text || "Blank"}</dd>
          </div>
          <div>
            <dt>Testing for</dt>
            <dd>{record.source_testing_for_rank_text || "Blank"}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{record.outcome_display || record.attendance_status_display || "None written"}</dd>
          </div>
          {record.report ? (
            <div>
              <dt>Comments</dt>
              <dd className="facts-list__text">{record.report}</dd>
            </div>
          ) : null}
          {record.note ? (
            <div>
              <dt>Notes beside it</dt>
              <dd className="facts-list__text">{record.note}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section aria-labelledby="ix-record-kukgrade" className="card stack stack--3">
        <h2 className="section-title" id="ix-record-kukgrade">
          In KukGrade
        </h2>
        <dl className="facts-list facts-list--aligned facts-list--compact">
          <div>
            <dt>Ranks read</dt>
            <dd>{[record.current_rank_name ?? "No rank", record.testing_for_rank_name].filter(Boolean).join(" → ")}</dd>
          </div>
          <div>
            <dt>Student</dt>
            <dd>
              {record.student !== null ? (
                <Link to={`/students/${record.student}`}>{record.student_display_name}</Link>
              ) : (
                "Not linked"
              )}
            </dd>
          </div>
        </dl>
        {!record.is_void ? (
          <details className="disclosure">
            <summary>
              <ChevronRightIcon />
              Correct the ranks
            </summary>
            <div className="stack stack--4 disclosure__body">
              <RankPicker
                current={record.current_rank}
                field="current_rank"
                label="Rank held"
                record={record}
                written={record.source_current_rank_text}
              />
              <RankPicker
                current={record.testing_for_rank}
                field="testing_for_rank"
                label="Testing for"
                record={record}
                written={record.source_testing_for_rank_text}
              />
            </div>
          </details>
        ) : null}
        {!record.is_void ? (
          <div>
            <Button variant="ghost" className="ix-danger-text" onClick={() => setVoiding(true)}>
              Void this record
            </Button>
          </div>
        ) : null}
      </section>
      {voiding ? <VoidRecord record={record} onClose={() => setVoiding(false)} /> : null}
    </DetailPage>
  );
}
