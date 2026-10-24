import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  type LegacyGradingRecord,
  errorMessage,
  getStudents,
  resolveLegacyCurrentRank,
  resolveLegacyTestingForRank,
  voidLegacyGradingRecord,
} from "./api";
import { ImportDialog } from "./ImportDialog";
import { type Chosen, recordMonth } from "./linkRecords";
import { useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";

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

/** Any student, found by name: the students KukGrade did not suggest. */
export function SomeoneElse({ chosen, onChoose }: { chosen: Chosen | null; onChoose: (choice: Chosen) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim());
  const found = useQuery({
    queryKey: ["students", "linkSearch", debounced],
    queryFn: () => getStudents({ search: debounced, page_size: 6 }),
    enabled: debounced.length >= 2,
  });
  return (
    <div className="ix-student-search">
      <label className="ix-field ix-field-wide">
        Search every student
        <input placeholder="Type at least two letters" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {(found.data?.results ?? []).map((student) => {
        const name = `${student.first_name} ${student.last_name}`;
        return (
          <button
            aria-pressed={chosen?.student === student.id}
            className="ix-student-option"
            key={student.id}
            type="button"
            onClick={() => onChoose({ student: student.id, name })}
          >
            <span className="ix-bold">{name}</span>{" "}
            <span className="ix-muted ix-small">
              {[`${student.current_rank_name} now`, student.age_band_display, student.status_display, student.wksa_id].filter(Boolean).join(" · ")}
            </span>
          </button>
        );
      })}
      {found.isSuccess && found.data.results.length === 0 ? (
        <p className="ix-muted ix-small ix-flush">No student matches “{debounced}”.</p>
      ) : null}
    </div>
  );
}
