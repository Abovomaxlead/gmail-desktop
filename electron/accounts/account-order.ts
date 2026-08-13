// Sort accounts by the order the user set, falling back to the detected authuser
// index when no order has been stored.

export interface Orderable { index: number; order?: number }

/**
 * Sorts accounts by stored order, then by detected index
 *
 * @param items
 * @returns a new array; the input is left alone
 */
export function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
}
