import type { Ref } from "react";

import { ActionBar } from "./ActionBar";
import { Button } from "./Button";
import { ErrorText } from "./ErrorText";
import { agreeing } from "./plural";

interface CohortRecordBarProps {
  stagedIds: number[];
  failedIds: number[];
  incomplete: number[];
  keepFailures: Record<number, string>;
  lastResult: string | null;
  resultRef: Ref<HTMLParagraphElement>;
  recording: boolean;
  onRecord: (outcomeIds: number[]) => void;
}

/**
 * The bar that records what is staged, and says what happened to the last
 * attempt. It is kept at the foot of the window, so it holds only what is
 * needed there: how recording works is said once in the page, above the list.
 */
export function CohortRecordBar({
  stagedIds,
  failedIds,
  incomplete,
  keepFailures,
  lastResult,
  resultRef,
  recording,
  onRecord,
}: CohortRecordBarProps) {
  const status =
    Object.keys(keepFailures).length > 0 || incomplete.length > 0 || lastResult ? (
      <>
        {Object.keys(keepFailures).length > 0 && (
          <ErrorText field>
            {Object.values(keepFailures)[0]}{" "}
            {agreeing(Object.keys(keepFailures).length, "That decision is", "Those decisions are")} still here, but will
            be lost if you leave this page.
          </ErrorText>
        )}
        {incomplete.length > 0 && (
          <ErrorText field>Conditional decisions need re-test requirements before they can be recorded.</ErrorText>
        )}
        {lastResult && (
          <p className="cab-bar-result item-title" role="status" ref={resultRef} tabIndex={-1}>
            {lastResult}
          </p>
        )}
      </>
    ) : null;
  return (
    <ActionBar status={status}>
      {failedIds.length > 0 && (
        <Button variant="secondary" disabled={recording} onClick={() => onRecord(failedIds)}>
          Retry {failedIds.length} failed
        </Button>
      )}
      <Button
        variant="primary"
        className="cab-record-all"
        disabled={recording || stagedIds.length === 0 || incomplete.length > 0}
        onClick={() => onRecord(stagedIds)}
        data-testid="cab-record-staged"
      >
        {recording
          ? "Recording…"
          : stagedIds.length === 0
            ? "No decisions staged"
            : `Record ${stagedIds.length} staged ${agreeing(stagedIds.length, "decision", "decisions")}`}
      </Button>
    </ActionBar>
  );
}
