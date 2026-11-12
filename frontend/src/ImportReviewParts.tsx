import { type ReactNode } from "react";
import { type DataImportKind, type DataImportRow, errorMessage } from "./api";
import { ErrorText } from "./ErrorText";
import { Pagination } from "./Pagination";
import { usePagedRows } from "./useImportRows";
import { importKinds } from "./importKinds";
import { Button } from "./Button";
import { Exclusion, Tile } from "./importReviewRows";
import { cx } from "./cx";

/** Counts that double as filters. */
export function CountTiles<View extends string>({
  tiles,
  view,
  onView,
}: {
  tiles: Tile<View>[];
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div aria-label="Show" className="ix-tiles" role="group">
      {tiles.map((tile) => (
        <button
          aria-pressed={view === tile.key}
          className="ix-tile"
          key={tile.key}
          type="button"
          onClick={() => onView(tile.key)}
        >
          <span className={cx("ix-tile-count", tile.tone)}>
            <span aria-hidden="true">{tile.mark}</span>
            <span className="stat__value">{tile.count}</span>
          </span>
          <span className="stat__label">{tile.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The way to a last look at everything that will be saved. */
export function LastLook({
  pressed,
  lead,
  label,
  onShow,
}: {
  pressed: boolean;
  lead: string;
  label: string;
  onShow: () => void;
}) {
  return (
    <div className={cx("ix-banner card card--flush", pressed && "ix-picked")}>
      <p>
        <strong>Last look before you confirm.</strong> {lead}
      </p>
      <Button aria-pressed={pressed} variant="secondary" onClick={onShow}>
        {label}
      </Button>
    </div>
  );
}

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
        <p className="ix-row subtext" role="status">
          Loading…
        </p>
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

/** A list's heading, its lead, and search where there is one. */
export function ListHead({
  title,
  lead,
  search,
}: {
  title: string;
  lead: string;
  search?: { value: string; hint: string; onChange: (value: string) => void };
}) {
  return (
    <div className="ix-row ix-align-end">
      <div className="ix-row-main">
        <h2 className="section-title" id="ix-review-list">
          {title}
        </h2>
        <p className="subtext">{lead}</p>
      </div>
      {search ? (
        <label className="field">
          <span>Search</span>
          <input
            placeholder={search.hint}
            type="search"
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}
