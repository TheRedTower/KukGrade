import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { DataImportBatch } from "./api";
import { ImportCheck, ImportChecks } from "./ImportChecks";
import { ImportEveryRecord } from "./ImportEveryRecord";
import { ImportSave } from "./ImportSave";
import { ImportSheets } from "./ImportSheets";
import { ImportStepBar } from "./ImportStepBar";
import { PageHeader } from "./PageHeader";
import { importKinds } from "./importKinds";

/** Where a past-gradings import can stand, as its address names it. */
export type PastStep = "sheets" | "checks" | "check" | "records" | "save";

const STEPS: readonly PastStep[] = ["sheets", "checks", "check", "records", "save"];

// Each place, as the step the server names it (site settings, imports.kinds).
const SERVER_STEP: Record<PastStep, DataImportBatch["next_step"]> = {
  sheets: "MATCH",
  checks: "REVIEW",
  check: "REVIEW",
  records: "REVIEW",
  save: "CONFIRM",
};

/**
 * A past-gradings import before it is saved: its sheets, the things to check
 * (each one on a page of its own), every record, and the save. Each is in the
 * address, so a reload or Back keeps the place.
 */
export function PastGradingsImport({ batch }: { batch: DataImportBatch }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const asked = params.get("step") as PastStep | null;
  const step: PastStep = asked && STEPS.includes(asked) ? asked : "sheets";
  const go = (next: PastStep, extra: Record<string, string> = {}, replace = false) =>
    navigate({ search: `?${new URLSearchParams({ step: next, ...extra }).toString()}` }, { replace });
  const importedBefore = Boolean((location.state as { importedBefore?: boolean } | null)?.importedBefore);

  if (step === "check") {
    return (
      <ImportCheck
        batch={batch}
        checkKey={params.get("key")}
        kind={params.get("kind")}
        onDone={() => go("checks")}
        onOpen={(kind, key) => go("check", { kind, key })}
        onPin={(kind, key) => go("check", { kind, key }, true)}
      />
    );
  }

  return (
    <section aria-labelledby="ix-step-title" className="page">
      <PageHeader
        back={{ to: "/imports", label: "Imports" }}
        title={importKinds[batch.kind].title}
        titleId="ix-step-title"
        subtitle={`${batch.original_filename} · ${importKinds[batch.kind].fileCounts(batch)}`}
      />
      <ImportStepBar current={SERVER_STEP[step]} kind={batch.kind} />
      {step === "sheets" ? (
        <ImportSheets batch={batch} importedBefore={importedBefore} onContinue={() => go("checks")} />
      ) : step === "checks" ? (
        <ImportChecks
          batch={batch}
          onBack={() => go("sheets")}
          onContinue={() => go("save")}
          onRecords={() => go("records")}
        />
      ) : step === "records" ? (
        <ImportEveryRecord batch={batch} onDone={() => go("checks")} />
      ) : (
        <ImportSave batch={batch} onBack={() => go("checks")} />
      )}
    </section>
  );
}
