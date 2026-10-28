import { useState } from "react";

import { CopyIcon } from "./Icons";
import { Button } from "./Button";

export function DetailsList({ details, columns }: { details: [string, string][]; columns?: 1 }) {
  return (
    <dl className="st-details" style={columns === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
      {details.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd className={name === "Commit" || name === "Your browser" ? "st-mono" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyDetailsButton({ details }: { details: [string, string][] }) {
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);

  async function copy() {
    const text = ["KukGrade", ...details.map(([name, value]) => `${name}: ${value}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <>
      <Button variant="primary" disabled={details.length === 0} onClick={copy}>
        <CopyIcon />
        Copy details
      </Button>
      {copied === "done" ? (
        <p className="st-saved" role="status">
          Copied.
        </p>
      ) : null}
      {copied === "failed" ? (
        <p className="form-error" role="alert">
          Could not copy. Select the details and copy them by hand.
        </p>
      ) : null}
    </>
  );
}
