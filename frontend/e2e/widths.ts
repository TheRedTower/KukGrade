/** Every width a screen is checked at: small phones up to a desktop. */
export const ALL_WIDTHS = [320, 360, 390, 430, 600, 768, 820, 1024, 1280];

/** The few that cover each breakpoint band, for a quick run. */
export const QUICK_WIDTHS = [320, 390, 768, 1280];

/** WebKit runs check the widths of the device they imitate. */
export const WEBKIT_WIDTHS: Record<string, number[]> = {
  "webkit-iphone": [320, 390, 430],
  "webkit-ipad": [768, 820, 1024],
};
