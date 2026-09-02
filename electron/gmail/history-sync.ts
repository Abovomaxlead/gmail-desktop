// Decides which of the messages Gmail's history reports deserve a notification. Deduped,
// since one message can appear in several records, and left in Gmail's arrival order.
//
// The whole rule is one comparison: notify only mail that arrived while this account was
// being watched. That keeps the startup backlog quiet, lets a short break catch up, and
// leaves a handover gap quiet because the webview already reported it.

import type { HistoryMessage } from './gmail-api';


//===========================
// Constants
//===========================

// PROMOTIONS and SOCIAL never notify; PERSONAL, UPDATES and FORUMS do.
export const SKIP_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];


//===========================
// Exported functions
//===========================

/**
 * Picks the messages out of a history page that may notify
 *
 * @param added
 * @returns the ids, deduped and left in Gmail's own arrival order
 */
export function notifiableIds(added: HistoryMessage[]): string[] {
  const out: string[] = [];
  for (const message of added) {
    if (!message.labelIds.includes('INBOX')) continue;
    if (message.labelIds.some((l) => SKIP_LABELS.includes(l))) continue;
    if (!out.includes(message.id)) out.push(message.id);
  }
  return out;
}

/**
 * The whole notification rule: did this mail arrive while push covered the account
 *
 * @param internalDate epoch ms Gmail stamped the message with
 * @param coveredSince epoch ms coverage began, or null when uncovered
 * @returns true when the message deserves a notification
 */
export function shouldNotify(internalDate: number, coveredSince: number | null): boolean {
  if (coveredSince === null) return false;
  return internalDate >= coveredSince;
}
