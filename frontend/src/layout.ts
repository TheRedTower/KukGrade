/**
 * The scale of widths the layout adapts at. layout.css is where a query is
 * written (CSS cannot import these), and layoutRules.test.ts fails if a
 * stylesheet's query for one of them disagrees with the number here.
 *
 *   compact  below `compact`  phones: a full-width sheet, stacked buttons
 *   medium   up to `wide`     small tablets and split screens
 *   wide     `wide` and up    tablets in landscape and desktops
 *
 * The sidebar collapses to a menu at `wide` of the window. A table turns to
 * cards below `wide` of its own width, and a dialog to a sheet below
 * `compact` of the window.
 */
export const BREAKPOINTS_REM = { compact: 40, wide: 56 } as const;

/** A max-width media query for a breakpoint. */
export const maxWidthQuery = (rem: number): string => `(max-width: ${rem}rem)`;
