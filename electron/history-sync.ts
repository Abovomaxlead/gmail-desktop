// Decides which of the messages Gmail's history reports deserve a notification.
// Deduped, because the same message can appear in several history records, and left
// in Gmail's own order so notifications arrive by arrival time. Gmail's PROMOTIONS
// and SOCIAL tabs never notify; PERSONAL, UPDATES and FORUMS do.
//
// The whole notification rule, in one place: notify only mail that arrived while this
// account was covered by push. That single comparison covers three cases. At startup
// coverage begins at the first successful watch, so the backlog stays quiet. After a
// short break the mail is newer than that moment and notifies, which is what catch-up
// is for. And after a handover the moment moves with it, so the gap stays quiet
// because the webview already reported that mail.

import type { HistoryMessage } from './gmail-api';

export const SKIP_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];

export function notifiableIds(added: HistoryMessage[]): string[] {
  const out: string[] = [];
  for (const message of added) {
    if (!message.labelIds.includes('INBOX')) continue;
    if (message.labelIds.some((l) => SKIP_LABELS.includes(l))) continue;
    if (!out.includes(message.id)) out.push(message.id);
  }
  return out;
}

export function shouldNotify(internalDate: number, coveredSince: number | null): boolean {
  if (coveredSince === null) return false;
  return internalDate >= coveredSince;
}
