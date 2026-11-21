import { useState } from "react";

/**
 * Copying text for the user: `copied` says how the last try went (null
 * before any), so a screen can say "Copied." or how to copy it by hand.
 */
export function useClipboard() {
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  return { copied, copy };
}
