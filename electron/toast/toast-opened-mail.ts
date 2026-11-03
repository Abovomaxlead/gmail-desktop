// A mail card leaves once the reader opens that mail in the app, however they got there: the
// card itself, the list, the reading pane, a search. The other cards stay -- only the
// conversation that was opened has been seen.
//
// The Gmail view reports each conversation it newly opens (see open-conversation.ts); this
// matches those against the account's cards.

import { toasts } from '../core/runtime';
import type { OpenConversation } from '../gmail/open-conversation';
import { notifyLog } from '../notify/notify-log';
import { notifiedSubject } from './toast-activation';
import { openedCards } from './toast-model';


//===========================
// Exported functions
//===========================

/**
 * An account's mail view opened conversations; takes the cards about them
 *
 * @param accountKey
 * @param open what the view newly opened
 */
export function dismissCardsForOpenedMail(accountKey: string, open: readonly OpenConversation[]): void {
  const cards = toasts?.mailCards(accountKey) ?? [];
  if (cards.length === 0) return;
  const ids = openedCards(cards, open, (card) =>
    card.webNotifyId ? notifiedSubject(card.webNotifyId) : undefined,
  );
  if (ids.length === 0) return;
  notifyLog(
    `[toast] ${accountKey} opened ${open.map((o) => o.threadId).join(',')} in the app, ${ids.length} card(s) leave`,
  );
  toasts?.dismissMany(ids);
}
