/**
 * Making a PDF and saving it: the one way every export button works. The
 * server builds the file and says, all or nothing, why it would not; this
 * saves what it made under the server's own name, or turns its refusal into
 * what the refusal box shows (PdfRefusal).
 */
import { useMutation } from "@tanstack/react-query";

import { ApiError, type MadeFile, errorMessage } from "./api";
import { saveFile } from "./saveFile";

/** What to do about a refusal: each comes with the one action that helps. */
export type RefusalAction = "REFRESH_LIST" | "REFRESH_PAGE" | "TRY_AGAIN" | "CLOSE";

export interface Refusal {
  reason: string;
  /** Each candidate who could not be included, by name, with why. */
  candidates: { name: string; why: string }[];
  help: string;
  action: RefusalAction;
}

const NOT_ON_THE_LIST = "A candidate no longer on this list";

/**
 * Why nothing was downloaded, from the server's answer. A refusal keyed by
 * candidate id names each candidate (the server says why for each); one about
 * the session says the page is out of date; a refusal of the request itself is
 * shown as the server words it; anything else is worth trying again.
 */
export function refusalOf(error: unknown, nameOf: (candidateId: number) => string | undefined): Refusal {
  if (error instanceof ApiError && error.fields) {
    const candidates = Object.keys(error.fields)
      .filter((key) => /^\d+$/.test(key))
      .map((key) => ({ name: nameOf(Number(key)) ?? NOT_ON_THE_LIST, why: error.messagesFor(key).join(" ") }));
    if (candidates.length > 0) {
      return {
        reason: "Some of the candidates chosen cannot be included:",
        candidates,
        help: "Take them out of the selection, or try again once they are ready.",
        action: "REFRESH_LIST",
      };
    }
    if (error.messagesFor("session").length > 0) {
      return {
        reason: error.messagesFor("session").join(" "),
        candidates: [],
        help: "The grading has moved on since this page was opened.",
        action: "REFRESH_PAGE",
      };
    }
  }
  if (error instanceof ApiError && error.status === 400) {
    return { reason: errorMessage(error, "The request was refused."), candidates: [], help: "", action: "CLOSE" };
  }
  return {
    reason: errorMessage(error, "The PDF could not be made just now."),
    candidates: [],
    help: "Try again in a moment. If it keeps happening, tell whoever looks after KukGrade.",
    action: "TRY_AGAIN",
  };
}

/**
 * A PDF made on request and saved as it arrives. `mutate` takes the call that
 * makes it, so a retry repeats exactly what was asked.
 */
export function usePdfDownload() {
  return useMutation({
    mutationFn: (make: () => Promise<MadeFile>) => make(),
    onSuccess: (file) => saveFile(file.blob, file.name),
  });
}
