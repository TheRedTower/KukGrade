import type { Key, ReactNode } from "react";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** What names the row: the title of its card, shown first and without a label. */
  primary?: boolean;
  /**
   * Buttons for the row: no label on a card, and the header is read, not shown.
   * "inline" puts one short button beside the card's title instead of beneath it.
   */
  actions?: boolean | "inline";
  align?: "end";
}

interface ResponsiveTableProps<Row> {
  /** Names the table for assistive technology. */
  label: string;
  rows: readonly Row[];
  rowKey: (row: Row) => Key;
  columns: readonly Column<Row>[];
  /** Shown in place of the table when there are no rows. */
  empty?: ReactNode;
  /** A test id for the table itself. */
  testId?: string;
  /** A test id for each row. */
  rowTestId?: (row: Row) => string;
  /** Marks the row a side panel is showing. */
  selected?: (row: Row) => boolean;
  /** For a table that is the whole contents of a card: no second border. */
  flush?: boolean;
}

/**
 * Every table in the app. A table where it has the room (see .rtable in
 * layout.css) and a stack of cards where it does not, so nothing scrolls
 * sideways. The markup is always a real table; the roles are written out
 * because a browser drops a table's meaning once its rows are laid out as cards.
 * Each cell's content sits in one box, so a card pairs a label with one value.
 * A card expects one `primary` column and at most one `inline` action column.
 */
export function ResponsiveTable<Row>({ label, rows, rowKey, columns, empty, testId, rowTestId, selected, flush }: ResponsiveTableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) {
    return (
      <div className="rtable rtable__empty" aria-label={label} data-testid={testId}>
        {empty}
      </div>
    );
  }
  return (
    <div className={flush ? "rtable rtable--flush" : "rtable"}>
      <table aria-label={label} role="table" data-testid={testId}>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((column) => (
              <th key={column.key} role="columnheader" scope="col" data-align={column.align}>
                {column.actions ? <span className="visually-hidden">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row" data-testid={rowTestId?.(row)} data-selected={selected?.(row) ? "" : undefined}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  data-label={column.primary || column.actions ? undefined : column.header}
                  data-primary={column.primary ? "" : undefined}
                  data-actions={column.actions === "inline" ? "inline" : column.actions ? "" : undefined}
                  data-align={column.align}
                >
                  <div className="rtable__value">{column.render(row)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
