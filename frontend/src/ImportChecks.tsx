import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { ActionBar } from "./ActionBar";
import { Alert } from "./Alert";
import {
  type DataImportBatch,
  type LegacyCheck,
  errorMessage,
  getAllLegacyChecks,
  getLegacyChecksSummary,
  resolveLegacyCheck,
} from "./api";
import { BeltSwatch } from "./Belt";
import { Button } from "./Button";
import { ChoiceGroup } from "./ChoiceGroup";
import { useChoices } from "./choices";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { RowLines } from "./ImportReviewParts";
import { importKinds } from "./importKinds";
import { LoadingState } from "./LoadingState";
import { useImportRefresh } from "./useImportRefresh";
import { counted } from "./plural";
import { Progress } from "./Progress";
import { useRanksQuery } from "./queries";
import { QueueList } from "./QueueList";
import { keys } from "./queryKeys";

type CheckKind = LegacyCheck["kind"];

function useSummary(batchId: number) {
  return useQuery({ queryKey: keys.imports.checksSummary(batchId), queryFn: () => getLegacyChecksSummary(batchId) });
}

/**
 * The things to check before saving: only what KukGrade could not read for
 * itself, a queue for each kind, and how many are sorted. Anything left open
 * is saved as written, so saving never waits for them.
 */
export function ImportChecks({
  batch,
  onBack,
  onContinue,
  onRecords,
}: {
  batch: DataImportBatch;
  onBack: () => void;
  onContinue: () => void;
  onRecords: () => void;
}) {
  const summary = useSummary(batch.id);
  const counts = summary.data;
  const kinds = (counts?.kinds ?? []).filter((kind) => kind.checks > 0);

  return (
    <>
      <section aria-labelledby="ix-checks" className="card stack stack--4">
        <h2 className="section-title" id="ix-checks">
          Things to check
        </h2>
        <p className="subtext">Only what KukGrade could not read for itself. Anything left open is saved as written.</p>
        {summary.isPending ? (
          <LoadingState compact>Looking for things to check…</LoadingState>
        ) : summary.isError ? (
          <ErrorText>{errorMessage(summary.error, "The things to check could not be loaded.")}</ErrorText>
        ) : counts && counts.checks > 0 ? (
          <>
            <Progress done={counts.checks - counts.open} total={counts.checks} what="sorted" />
            <QueueList
              label="Things to check"
              queues={kinds.map((kind) => ({
                to: `?step=check&kind=${kind.kind}`,
                label: kind.kind_display,
                count: kind.open,
                hint: kind.open ? `${kind.checks - kind.open} of ${kind.checks} sorted` : "All sorted",
              }))}
            />
          </>
        ) : (
          <p className="item-title">Nothing to check: KukGrade reads every record.</p>
        )}
        {counts?.warnings.length ? (
          <Alert tone="warning" title="What KukGrade could not read or check">
            <ul className="list-plain stack stack--1">
              {counts.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div>
          <Button variant="secondary" onClick={onRecords}>
            See every record
          </Button>
        </div>
      </section>
      <ActionBar
        status={counts ? <p className="subtext">{counted(counts.open, "thing", "things")} still open</p> : null}
      >
        <Button variant="ghost" onClick={onBack}>
          Back to the sheets
        </Button>
        <Button variant="primary" onClick={onContinue}>
          Continue to save
        </Button>
      </ActionBar>
    </>
  );
}

/** The answers one check takes, as its decisions allow (served on the check). */
function Answers({
  check,
  pending,
  onDecide,
}: {
  check: LegacyCheck;
  pending: boolean;
  onDecide: (decision: Omit<Parameters<typeof resolveLegacyCheck>[1], "key">) => void;
}) {
  const ranks = useRanksQuery().data?.results ?? [];
  const outcomes = useChoices().outcomes;
  const allowed = new Set(check.decisions.map((decision) => decision.value));
  const where = new Map(check.rows.map((row) => [row.row_number, importKinds.LEGACY_GRADINGS.where(row)]));
  const kept = check.decision === "KEEP";

  return (
    <div className="stack stack--4">
      {allowed.has("RANK") ? (
        <ChoiceGroup
          choices={ranks.map((rank) => ({
            value: rank.code,
            label: (
              <>
                <BeltSwatch rank={rank} />
                {rank.code === check.suggested_rank_code ? `${rank.name} (as it reads)` : rank.name}
              </>
            ),
          }))}
          label={`The rank “${check.text}” means`}
          look="options"
          value={check.decision === "RANK" ? (check.rank_code ?? "") : ""}
          onChange={(rank_code) => {
            if (!pending) onDecide({ decision: "RANK", rank_code });
          }}
        />
      ) : null}
      {allowed.has("OUTCOME") ? (
        <ChoiceGroup
          choices={outcomes.map((outcome) => ({ value: outcome.value, label: outcome.label }))}
          label={`The outcome “${check.text}” means`}
          look="options"
          value={check.decision === "OUTCOME" ? (check.outcome ?? "") : ""}
          onChange={(outcome) => {
            if (!pending && outcome) onDecide({ decision: "OUTCOME", outcome });
          }}
        />
      ) : null}
      {allowed.has("LEAVE_OUT") ? (
        <ChoiceGroup
          choices={check.rows_to_leave_out.map((number) => ({
            value: String(number),
            label: `Leave out ${where.get(number) ?? `row ${number}`}`,
          }))}
          label="Leave one out"
          look="options"
          value={check.decision === "LEAVE_OUT" ? String(check.rows.find((row) => row.excluded)?.row_number ?? "") : ""}
          onChange={(number) => {
            if (!pending) onDecide({ decision: "LEAVE_OUT", row_number: Number(number) });
          }}
        />
      ) : null}
      <div>
        <Button
          aria-pressed={kept}
          variant="secondary"
          disabled={pending}
          onClick={() => onDecide({ decision: "KEEP" })}
        >
          Keep as written
        </Button>
      </div>
    </div>
  );
}

/**
 * One thing to check on a page of its own: what it is about, its records in
 * full, and its answers as large buttons. Next goes on to the next one still
 * open of the same kind.
 */
export function ImportCheck({
  batch,
  kind,
  checkKey,
  onOpen,
  onPin,
  onDone,
}: {
  batch: DataImportBatch;
  kind: string | null;
  checkKey: string | null;
  onOpen: (kind: string, key: string) => void;
  /** Puts the check shown into the address, so answering it never moves the page on. */
  onPin: (kind: string, key: string) => void;
  onDone: () => void;
}) {
  const refresh = useImportRefresh(batch.id);
  const summary = useSummary(batch.id);
  const asKind = (kind ?? "") as CheckKind;
  const checks = useQuery({
    queryKey: keys.imports.checksOfKind(batch.id, asKind),
    queryFn: () => getAllLegacyChecks(batch.id, asKind),
    enabled: Boolean(kind),
  });
  const list = checks.data?.results ?? [];
  const current =
    list.find((check) => check.key === checkKey) ?? list.find((check) => check.is_open) ?? list[0] ?? null;
  const at = current ? list.indexOf(current) : -1;
  const next = [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))].find((check) => check.is_open) ?? null;
  const decide = useMutation({
    mutationFn: (decision: Omit<Parameters<typeof resolveLegacyCheck>[1], "key">) =>
      resolveLegacyCheck(batch.id, { key: current!.key, ...decision }),
    onSuccess: refresh,
  });
  const counts = summary.data;
  const shownKey = current?.key ?? null;
  useEffect(() => {
    // Opened from its queue, the address names only the kind: pin the check
    // shown before it is answered, or the reload after would show the next.
    if (kind && shownKey && shownKey !== checkKey) onPin(kind, shownKey);
  }, [kind, shownKey, checkKey, onPin]);

  return (
    <DetailPage
      actions={
        next ? (
          <Button variant="primary" onClick={() => onOpen(asKind, next.key)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" onClick={onDone}>
            Back to things to check
          </Button>
        )
      }
      back={{ to: "?step=checks", label: "Things to check" }}
      eyebrow={`${importKinds[batch.kind].title} · Things to check`}
      progress={counts ? <Progress done={counts.checks - counts.open} total={counts.checks} what="sorted" /> : null}
      status={
        current ? (
          <p className="subtext">
            {current.is_open ? "Not decided yet: saved as written" : `Decided: ${current.decision_display}`}
          </p>
        ) : null
      }
      testId="ix-check"
      title={current?.kind_display ?? "Thing to check"}
    >
      {checks.isPending ? (
        <LoadingState compact>Loading…</LoadingState>
      ) : checks.isError ? (
        <ErrorText>{errorMessage(checks.error, "This could not be loaded. Try again in a moment.")}</ErrorText>
      ) : current ? (
        <>
          <section aria-labelledby="ix-check-what" className="card stack stack--4">
            <h2 className="section-title" id="ix-check-what">
              {current.message}
            </h2>
            <Answers check={current} pending={decide.isPending} onDecide={(decision) => decide.mutate(decision)} />
            {decide.isError ? <ErrorText>{errorMessage(decide.error, "That could not be saved.")}</ErrorText> : null}
          </section>
          <section aria-labelledby="ix-check-rows" className="card card--flush">
            <h2 className="section-title ix-row" id="ix-check-rows">
              As the workbook has {current.row_count === 1 ? "it" : `them (${current.row_count})`}
            </h2>
            <RowLines kind={batch.kind} list={current.rows} />
          </section>
        </>
      ) : (
        <p className="item-title">Nothing left to check here.</p>
      )}
    </DetailPage>
  );
}
