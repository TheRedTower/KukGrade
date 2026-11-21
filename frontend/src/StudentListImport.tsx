import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { DataImportBatch } from "./api";
import { ImportMatchColumns } from "./ImportMatchColumns";
import { RosterChecks, RosterFile, RosterRow, RosterRows, RosterSave } from "./ImportRosterSteps";
import { ImportStepBar } from "./ImportStepBar";
import { importKinds } from "./importKinds";
import { PageHeader } from "./PageHeader";

/** Where a student list can stand before it is saved, as its address names it. */
type RosterStep = "file" | "checks" | "match" | "row" | "rows" | "save";

const STEPS: readonly RosterStep[] = ["file", "checks", "match", "row", "rows", "save"];

// Each place, as the step the server names it (site settings, imports.kinds).
const SERVER_STEP: Record<RosterStep, DataImportBatch["next_step"]> = {
  file: "MATCH",
  checks: "REVIEW",
  match: "REVIEW",
  row: "REVIEW",
  rows: "REVIEW",
  save: "CONFIRM",
};

/**
 * A student list before it is saved, on the same screens as past gradings:
 * what KukGrade found in the file, the things to check (the columns, then
 * each row to fix on a page of its own), every row, and the save. Each is in
 * the address, so a reload or Back keeps the place; with none, it opens
 * where the import is up to.
 */
export function StudentListImport({ batch }: { batch: DataImportBatch }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const asked = params.get("step") as RosterStep | null;
  const step: RosterStep = asked && STEPS.includes(asked) ? asked : batch.next_step === "MATCH" ? "file" : "checks";
  const go = useCallback(
    (next: RosterStep, extra: Record<string, string> = {}, replace = false) =>
      navigate({ search: `?${new URLSearchParams({ step: next, ...extra }).toString()}` }, { replace }),
    [navigate],
  );
  const importedBefore = Boolean((location.state as { importedBefore?: boolean } | null)?.importedBefore);
  const fromRows = params.get("from") === "rows";
  const pin = useCallback(
    (row: number) => {
      const next = new URLSearchParams(params);
      next.set("row", String(row));
      navigate({ search: `?${next.toString()}` }, { replace: true });
    },
    [navigate, params],
  );

  if (step === "row") {
    // Back to every row keeps its filters; to the things to check, none.
    const list = new URLSearchParams(params);
    list.set("step", "rows");
    list.delete("row");
    list.delete("from");
    const back = fromRows ? `?${list.toString()}` : "?step=checks";
    return (
      <RosterRow
        back={back}
        batch={batch}
        fromRows={fromRows}
        rowNumber={Number(params.get("row")) || null}
        onDone={() => navigate({ search: back })}
        onOpen={(row) => go("row", { row: String(row) })}
        onPin={pin}
      />
    );
  }

  return (
    <section aria-labelledby="ix-step-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title={importKinds[batch.kind].title}
        titleId="ix-step-title"
        subtitle={`${batch.original_filename}${batch.sheet ? ` · sheet “${batch.sheet}”` : ""} · ${importKinds[batch.kind].fileCounts(batch)}`}
      />
      <ImportStepBar current={SERVER_STEP[step]} kind={batch.kind} />
      {step === "file" ? (
        <RosterFile batch={batch} importedBefore={importedBefore} onContinue={() => go("checks")} />
      ) : step === "checks" ? (
        <RosterChecks batch={batch} onBack={() => go("file")} onContinue={() => go("save")} onRows={() => go("rows")} />
      ) : step === "match" ? (
        <ImportMatchColumns batch={batch} onDone={() => go("checks")} />
      ) : step === "rows" ? (
        <RosterRows batch={batch} onDone={() => go("checks")} />
      ) : (
        <RosterSave batch={batch} onBack={() => go("checks")} onFix={() => go("row")} />
      )}
    </section>
  );
}
