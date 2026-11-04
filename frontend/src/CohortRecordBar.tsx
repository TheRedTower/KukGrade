import type { Ref } from "react";

import { Button } from "./Button";
import { ErrorText } from "./ErrorText";

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

/** The bar that records what is staged, and says what happened to the last attempt. */
export function CohortRecordBar({ stagedIds, failedIds, incomplete, keepFailures, lastResult, resultRef, recording, onRecord }: CohortRecordBarProps) {
  return (
        <footer className="cab-bar">
          <p className="cab-bar-text">
            Decisions are recorded one candidate at a time. Any that cannot be recorded stay here to try again; the rest are kept.
            What you stage is saved for you until it is recorded, even if you are signed out.
          </p>
          {Object.keys(keepFailures).length > 0 && (
            <ErrorText field>
              {Object.values(keepFailures)[0]} {Object.keys(keepFailures).length === 1 ? "That decision is" : "Those decisions are"} still
              here, but will be lost if you leave this page.
            </ErrorText>
          )}
          {incomplete.length > 0 && (
            <ErrorText field>
              Conditional decisions need re-test requirements before they can be recorded.
            </ErrorText>
          )}
          {lastResult && (
            <p className="cab-bar-result" role="status" ref={resultRef} tabIndex={-1}>
              {lastResult}
            </p>
          )}
          {failedIds.length > 0 && (
            <Button
              variant="secondary"
              disabled={recording}
              onClick={() => onRecord(failedIds)}
            >
              Retry {failedIds.length} failed
            </Button>
          )}
          <Button
            variant="primary" className="cab-record-all"
            disabled={recording || stagedIds.length === 0 || incomplete.length > 0}
            onClick={() => onRecord(stagedIds)}
            data-testid="cab-record-staged"
          >
            {recording
              ? "Recording…"
              : stagedIds.length === 0
                ? "No decisions staged"
                : `Record ${stagedIds.length} staged ${stagedIds.length === 1 ? "decision" : "decisions"}`}
          </Button>
        </footer>
  );
}
