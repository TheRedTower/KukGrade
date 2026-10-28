/**
 * The scale of widths the layout adapts at. layout.css is where a query is
 * written (CSS cannot import these), and layoutRules.test.ts fails if a
 * stylesheet's query for one of them disagrees with the number here.
 *
 *   narrow   below `wide`   phones and small tablets: the sidebar is a menu
 *   wide     `wide` and up  tablets in landscape and desktops
 *
 * A `compact` step for phones is added with the first component that needs it.
 */
export const BREAKPOINTS_REM = { wide: 56 } as const;

/** A max-width media query for a breakpoint. */
export const maxWidthQuery = (rem: number): string => `(max-width: ${rem}rem)`;
