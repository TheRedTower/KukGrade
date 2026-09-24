/**
 * Which syllabus categories are the universal core grading areas.
 *
 * Structural, not data: FDR-018 separates the six universal areas from
 * rank-specific Techniques and Forms. Every name, Korean label and ordering
 * still comes from the API - this only says which category codes belong in
 * the compact core strip.
 *
 * Extracted from `SyllabusScreen` when the 2B completion proof needed the same
 * separation (FDR-043). Two copies of a list like this drift, and a drift here
 * would mean the syllabus and the permanent grading record disagreed about
 * what a core area is.
 */
export const CORE_CATEGORY_CODES = new Set([
  "ETIQUETTE",
  "FUNDAMENTALS",
  "HAND_TECHNIQUES",
  "KICKING",
  "FALLING",
  "BREAKING",
]);

export function isCoreCategory(category: string): boolean {
  return CORE_CATEGORY_CODES.has(category);
}
