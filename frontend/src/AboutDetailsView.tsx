import { useState } from "react";

import { Alert } from "./Alert";
import { CopyIcon } from "./Icons";
import { Button } from "./Button";

/** A code (a commit, a browser's name) may break after its own punctuation,
 * which splits no word, so a long one wraps on a phone instead of spilling. */
function codeWithBreaks(value: string) {
  return value.split(/(?<=[/.;_-])/).map((part, index) => (
    <span key={index}>
      {index > 0 && <wbr />}
      {part}
    </span>
  ));
}

export function DetailsList({ details }: { details: [string, string][] }) {
  return (
    <dl className="facts-list">
      {details.map(([name, value]) => {
        const code = name === "Commit" || name === "Your browser";
        return (
          <div key={name}>
            <dt>{name}</dt>
            <dd className={code ? "st-mono" : undefined}>{code ? codeWithBreaks(value) : value}</dd>
          </div>
        );
      })}
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
        <p className="st-saved item-title" role="status">
          Copied.
        </p>
      ) : null}
      {copied === "failed" ? (
        <Alert>
          Could not copy. Select the details and copy them by hand.
        </Alert>
      ) : null}
    </>
  );
}
