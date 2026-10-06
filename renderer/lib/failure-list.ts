// Which rows of a pull failed, and how a list of failures is shortened for the panel. Shared by
// main, which keeps the rows to fetch again, and the modal, which draws them.


//===========================
// Types
//===========================

export interface PullRow {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}


//===========================
// Constants
//===========================

export const SHOWN_FAILURES = 20;


//===========================
// Exported functions
//===========================

/**
 * Which rows are conversations that could not be fetched
 *
 * @param items the preview rows, in drag order
 * @returns their positions; a row without a conversation behind it is never one
 */
export function failedRowIndexes(items: PullRow[]): number[] {
  const at: number[] = [];
  items.forEach((item, i) => {
    if (item.threadId && item.saved === 0 && (item.error ?? '').trim()) at.push(i);
  });
  return at;
}

/**
 * Puts retried rows back where they stood
 *
 * @param items
 * @param at positions, as failedRowIndexes answered them
 * @param next one row per position, in the same order
 * @returns a new list
 */
export function replaceRows<T>(items: T[], at: number[], next: T[]): T[] {
  const out = [...items];
  at.forEach((position, i) => {
    if (next[i] !== undefined) out[position] = next[i];
  });
  return out;
}

/**
 * Shortens a list for the panel
 *
 * @param list
 * @param max
 * @returns the lines to draw and how many were left out
 */
export function cutList<T>(list: T[], max = SHOWN_FAILURES): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
