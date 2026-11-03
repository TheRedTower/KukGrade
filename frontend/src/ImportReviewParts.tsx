import { type ReactNode } from "react";
import { type DataImportKind, type DataImportRow, errorMessage } from "./api";
import { ErrorText } from "./ErrorText";
import { ImportPager } from "./ImportPager";
import { usePagedRows } from "./useImportRows";
import { importRowName } from "./importSteps";
import { Button } from "./Button";
import { Exclusion, Tile, rowCalled, rowDetail, where } from "./importReviewRows";

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
        <button aria-pressed={view === tile.key} className="ix-tile" key={tile.key} type="button" onClick={() => onView(tile.key)}>
          <span className={`ix-tile-count ${tile.tone}`}>
            <span aria-hidden="true">{tile.mark}</span>
            {tile.count}
          </span>
          <span className="ix-tile-label">{tile.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The way to a last look at everything that will be saved. */
export function LastLook({ pressed, lead, label, onShow }: { pressed: boolean; lead: string; label: string; onShow: () => void }) {
  return (
    <div className={`ix-banner card card--flush${pressed ? " ix-picked" : ""}`}>
      <p className="ix-small">
        <strong>Last look before you confirm.</strong> {lead}
      </p>
      <Button aria-pressed={pressed} variant="secondary" onClick={onShow}>
        {label}
      </Button>
    </div>
  );
}

export function ExclusionButton({ row, kind, exclusion }: { row: DataImportRow; kind: DataImportKind; exclusion: Exclusion }) {
  const what = rowCalled(row, kind);
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
  rows,
  empty = "Nothing here.",
  exclusion,
  children,
}: {
  rows: ReturnType<typeof usePagedRows>;
  empty?: string;
  exclusion: Exclusion;
  children: (list: DataImportRow[]) => ReactNode;
}) {
  const list = rows.query.data?.results ?? [];
  return (
    <>
      {rows.query.isError ? (
        <ErrorText className="ix-row">
          {errorMessage(rows.query.error, "The rows could not be loaded.")}
        </ErrorText>
      ) : rows.query.isPending ? (
        <p className="ix-row ix-muted" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="ix-row ix-muted">{empty}</p>
      ) : (
        children(list)
      )}
      {exclusion.isError ? (
        <ErrorText className="ix-row">
          {errorMessage(exclusion.error, "That row could not be changed.")}
        </ErrorText>
      ) : null}
      <ImportPager page={rows.page} pages={rows.pages} total={rows.total} onPage={rows.setPage} />
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
        <div className={`ix-row${row.excluded ? " ix-row-out" : ""}`} key={row.row_number}>
          <div className="ix-row-main">
            <p className="ix-strong">
              {where(row, kind)} · {importRowName(row, kind)}
            </p>
            {withIssues && !row.excluded ? <p className="ix-small ix-semibold">{row.issues.join(" ")}</p> : null}
            <p className="ix-muted ix-small">{row.excluded ? "Left out of the import." : rowDetail(row, kind)}</p>
          </div>
          {exclusion ? <ExclusionButton exclusion={exclusion} kind={kind} row={row} /> : null}
        </div>
      ))}
    </>
  );
}

/** A list's heading, its lead, and search where there is one. */
export function ListHead({ title, lead, search }: { title: string; lead: string; search?: { value: string; hint: string; onChange: (value: string) => void } }) {
  return (
    <div className="ix-row ix-align-end">
      <div className="ix-row-main">
        <h2 className="ix-heading" id="ix-review-list">
          {title}
        </h2>
        <p className="ix-muted ix-small">{lead}</p>
      </div>
      {search ? (
        <label className="ix-field">
          Search
          <input placeholder={search.hint} type="search" value={search.value} onChange={(event) => search.onChange(event.target.value)} />
        </label>
      ) : null}
    </div>
  );
}
