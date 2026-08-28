// The labels you already copied into today, offered again at the top of the picker.
//
// A mailbox has hundreds of labels and a day's work usually goes into two or three of them,
// so without this every drop starts by typing the same word again. The list is what main
// wrote down for today; which of those still exist, and what they are called, is answered by
// the mailbox's own labels — this file only decides which ones to show and in what order.

import type { SearchableLabel } from './label-search';


//===========================
// Types
//===========================

/** One use: which mailbox, which label, and when. `at` is only ever compared, never shown. */
export interface RecentLabelUse {
  email: string;
  labelId: string;
  at: number;
}


//===========================
// Constants
//===========================

// Enough to cover a day's regular destinations, short enough that the list stays something you
// read at a glance rather than a second label list above the first.
export const RECENT_SHOWN = 5;


//===========================
// Exported functions
//===========================

/**
 * The labels to offer above one mailbox's list
 *
 * @param used everything main recorded for today, every mailbox together
 * @param email the mailbox this pane belongs to
 * @param labels that mailbox's labels as they are right now
 * @returns at most RECENT_SHOWN labels, the one used last in front
 */
export function recentFor<T extends SearchableLabel>(
  used: RecentLabelUse[],
  email: string,
  labels: T[],
): T[] {
  const mine = email.trim().toLowerCase();
  const byId = new Map(labels.map((l) => [l.id, l]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const use of [...used].sort((a, b) => b.at - a.at)) {
    if (use.email.trim().toLowerCase() !== mine) continue;
    if (seen.has(use.labelId)) continue;
    seen.add(use.labelId);
    // The mailbox's own labels have the last word: one deleted at Google is still recorded for
    // today, and a row that cannot be ticked is worse than no row.
    const label = byId.get(use.labelId);
    if (!label) continue;
    out.push(label);
    if (out.length === RECENT_SHOWN) break;
  }
  return out;
}
