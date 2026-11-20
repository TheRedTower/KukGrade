import { type ReactNode } from "react";
import { type DataImportKind, type DataImportRow, errorMessage } from "./api";
import { ErrorText } from "./ErrorText";
import { Pagination } from "./Pagination";
import { usePagedRows } from "./useImportRows";
import { importKinds } from "./importKinds";
import { Button } from "./Button";
import type { Exclusion } from "./importReviewRows";
import { cx } from "./cx";
import { LoadingState } from "./LoadingState";

export function ExclusionButton({
  row,
  kind,
  exclusion,
}: {
  row: DataImportRow;
  kind: DataImportKind;
  exclusion: Exclusion;
}) {
  const what = importKinds[kind].called(row);
  return (
    <Button
      aria-label={row.excluded ? `Bring back ${what}` : `Leave out ${what}`}
      variant="link"
      disabled={exclusion.isPending}
      onClick={() => exclusion.mutate({ row, excluded: !row.excluded })}
    >
      {row.excluded ? "Bring back" : "Leave out"}
    </Button>
  );
}

/** One page of a list: loading, failed, empty, or its rows, and the pager. */
export function RowsList({
  kind,
  rows,
  empty = "Nothing here.",
  exclusion,
  children,
}: {
  kind: DataImportKind;
  rows: ReturnType<typeof usePagedRows>;
  empty?: string;
  exclusion: Exclusion;
  children: (list: DataImportRow[]) => ReactNode;
}) {
  const list = rows.results;
  return (
    <>
      {rows.query.isError ? (
        <ErrorText className="ix-row">{errorMessage(rows.query.error, "The rows could not be loaded.")}</ErrorText>
      ) : rows.query.isPending ? (
        <div className="ix-row">
          <LoadingState compact>Loading the rows…</LoadingState>
        </div>
      ) : list.length === 0 ? (
        <p className="ix-row subtext">{empty}</p>
      ) : (
        children(list)
      )}
      {exclusion.isError ? (
        <ErrorText className="ix-row">{errorMessage(exclusion.error, "That row could not be changed.")}</ErrorText>
      ) : null}
      <Pagination flush label="Pages of rows" noun={importKinds[kind].noun} {...rows.pager} />
    </>
  );
}

/** A list of rows in a line each, with Leave out or Bring back. */
export function RowLines({
  list,
  kind,
  exclusion,
  withIssues = false,
}: {
  list: DataImportRow[];
  kind: DataImportKind;
  exclusion?: Exclusion;
  withIssues?: boolean;
}) {
  return (
    <>
      {list.map((row) => (
        <div className={cx("ix-row", row.excluded && "ix-row-out")} key={row.row_number}>
          <div className="ix-row-main">
            <p className="item-title">
              {importKinds[kind].where(row)} · {importKinds[kind].rowName(row)}
            </p>
            {withIssues && !row.excluded ? <p className="item-title">{row.issues.join(" ")}</p> : null}
            <p className="subtext">{row.excluded ? "Left out of the import." : importKinds[kind].reviewDetail(row)}</p>
          </div>
          {exclusion ? <ExclusionButton exclusion={exclusion} kind={kind} row={row} /> : null}
        </div>
      ))}
    </>
  );
}
