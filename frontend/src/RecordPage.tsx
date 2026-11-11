import { useId } from "react";

import { Alert } from "./Alert";
import { errorMessage } from "./api";
import { Button } from "./Button";
import { LoadingState } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import type { RecordStatus } from "./recordStatus";

/**
 * Every record's page until its record is there (see recordStatus): what is
 * loading, that it was not found, or why it could not be loaded - each with
 * the one way back to the page above.
 */
export function RecordPage({
  status,
  label,
  loading,
  missing,
  failed,
  error,
  back,
  onRetry,
  testId,
}: {
  status: RecordStatus;
  /** The page's name: "Grading session". */
  label: string;
  /** "Loading grading session…"; by default the label, loading. */
  loading?: string;
  /** "Grading session not found" */
  missing: string;
  /** Said when the server gives no reason of its own; by default the label could not be loaded. */
  failed?: string;
  error?: unknown;
  back: { to: string; label: string };
  onRetry?: () => void;
  /** Named per state for tests: `${testId}-loading`, `-missing`, `-failed`. */
  testId?: string;
}) {
  const titleId = useId();
  const named = label.toLowerCase();
  const testIdFor = testId ? `${testId}-${status}` : undefined;
  if (status === "loading") {
    return (
      <section aria-label={label} className="page" data-testid={testIdFor}>
        <LoadingState>{loading ?? `Loading ${named}…`}</LoadingState>
      </section>
    );
  }
  if (status === "missing") {
    return (
      <section aria-labelledby={titleId} className="page" data-testid={testIdFor}>
        <PageHeader back={back} subtitle="It may have been removed, or the link may be wrong." title={missing} titleId={titleId} />
      </section>
    );
  }
  return (
    <section aria-labelledby={titleId} className="page" data-testid={testIdFor}>
      <PageHeader back={back} title={label} titleId={titleId} />
      <Alert
        action={
          onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        {errorMessage(error, failed ?? `The ${named} could not be loaded.`)}
      </Alert>
    </section>
  );
}
