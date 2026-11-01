import type { About } from "./api";
import { formatDateTime } from "./dates";

/** What to quote when asking for help; `you` adds what only this browser knows. */
export function versionDetails(about: About, you: [string, string][] = []): [string, string][] {
  return [
    ["Application", __APP_VERSION__],
    ["Server", about.release],
    ["Built", about.built_at ? formatDateTime(about.built_at) : "Not recorded"],
    ["Commit", about.commit || "Not recorded"],
    ["Club time zone", about.time_zone],
    ["Database", about.database === "ok" ? "Ready" : "Not answering"],
    ...you,
  ];
}
