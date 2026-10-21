// Opening the mail a notification was about the way the reader would: by clicking its row.
//
// Writing the conversation into the hash is a navigation, not a click, and Gmail answers it
// with the conversation on its own, across the whole width of the window — also for a reader
// who has the reading pane beside or below the list, where a click on that same row opens it
// in the pane. Reported from a mailbox with the pane on the right: every notification click
// threw the list away.
//
// So the row is clicked when the list shows it, and Gmail lays the mail out however the
// reader set it up: in the pane, or full width where there is no pane. A list that does not
// show the row is sent to the inbox first, where new mail is. Only a row that never turns up,
// or a click Gmail did not act on, falls back to the hash, which is where the app stood
// before this existed.
//
// The ids reach Google's page inside a script, so they are let through only as the hex Gmail
// writes, for the same reason message-anchor.ts refuses anything else.

import { isLegacyMessageId } from './message-anchor';


//===========================
// Types
//===========================

/** How it ended. `missing`: no row for the mail on screen, so the caller navigates. `ignored`:
 * the row was clicked and Gmail did not open it, so the caller navigates too. `superseded`: a
 * later click owns the view, and nothing may be done in it on this one's behalf. */
export type ListOpen = 'clicked' | 'missing' | 'ignored' | 'superseded';


//===========================
// Constants
//===========================

/** Looks for the row, the first one where it was found and the rest after going to the inbox.
 * Gmail keeps a list it drew before in the page, so going back to it is a matter of frames,
 * and a mail that is not in it after this long is not going to be. */
export const ROW_TRIES = 6;

/** Asks whether the click opened the mail. Gmail opens it within a frame or two; the rest is
 * room for a slow machine before the hash is written over a click that may still land. */
export const OPENED_TRIES = 8;

export const LIST_INTERVAL_MS = 150;


//===========================
// Exported functions
//===========================

/**
 * Builds the script that clicks the list row of one mail
 *
 * The row is found by the thread id Gmail hangs inside it and, when the mail is known, by the
 * mail the row stands for: with conversation view off every mail of a thread is a row of its
 * own under the same thread id, and only one of them is the mail the card named. A row that
 * does not say which mail it holds is not clicked then, rather than guessed at.
 *
 * The opened conversation's subject line carries the thread id as well. It stands in no row,
 * which is what keeps it from being clicked.
 *
 * @param threadId the legacy hex id of the conversation
 * @param messageId the legacy hex id of the mail, when known
 * @returns the script, or null for an id Gmail did not write — which is never run. In the
 *   page it answers the hash from before the click, or null when no row was on screen
 */
export function listRowClickScript(threadId: string, messageId?: string): string | null {
  if (!isLegacyMessageId(threadId)) return null;
  const message = messageId && isLegacyMessageId(messageId) ? messageId : null;
  return `(() => {
  ${PAGE_HELPERS}
  const message = ${JSON.stringify(message)};
  const messageOf = (row) => {
    const ids = new Set();
    const own = attr(row, 'data-legacy-last-message-id');
    if (own) ids.add(own);
    const inside = row.querySelectorAll('[data-legacy-last-message-id]');
    for (let i = 0; i < inside.length; i++) {
      const id = attr(inside[i], 'data-legacy-last-message-id');
      if (id) ids.add(id);
    }
    return ids.size === 1 ? Array.from(ids)[0] : null;
  };
  const all = document.querySelectorAll(${JSON.stringify(`[data-legacy-thread-id="${threadId}"]`)});
  for (let i = 0; i < all.length; i++) {
    const row = rowOf(all[i]);
    if (!row || !shown(row)) continue;
    if (message && messageOf(row) !== message) continue;
    const before = location.hash;
    // The three a real click consists of: Gmail's list reacts to the press as well as to
    // the click, and a bare click() leaves out the first two.
    for (const type of ['mousedown', 'mouseup', 'click']) {
      all[i].dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    return before;
  }
  return null;
})()`;
}

/**
 * Builds the script that says whether the click opened the conversation
 *
 * Opened is the hash having moved on, which Gmail does when it opens a conversation from the
 * list, or the conversation's subject line being on screen, which also covers a row clicked
 * while its conversation was already open in the pane and the hash had nowhere to move.
 *
 * @param threadId the legacy hex id of the conversation
 * @param before the hash the click script answered
 * @returns the script, or null for an id Gmail did not write
 */
export function listOpenedScript(threadId: string, before: string): string | null {
  if (!isLegacyMessageId(threadId)) return null;
  return `(() => {
  ${PAGE_HELPERS}
  if (location.hash !== ${JSON.stringify(before)}) return true;
  const all = document.querySelectorAll(${JSON.stringify(`[data-legacy-thread-id="${threadId}"]`)});
  for (let i = 0; i < all.length; i++) if (!rowOf(all[i]) && shown(all[i])) return true;
  return false;
})()`;
}

/**
 * Opens one mail by clicking its row in the list
 *
 * @param run hands a script to the page
 * @param threadId
 * @param messageId the mail the card named, when known
 * @param opts.showList sends the view to the list the mail is in, once the list on screen has
 *   turned out not to hold it
 * @param opts.superseded asked before every try; a later click owns the view then
 * @param opts.wait injectable, so a test does not sit through the tries
 * @returns {Promise<ListOpen>} how it ended
 */
export async function openFromList(
  run: (script: string) => Promise<unknown>,
  threadId: string,
  messageId: string | undefined,
  opts: {
    showList: () => void;
    superseded?: () => boolean;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<ListOpen> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const click = listRowClickScript(threadId, messageId);
  if (!click) return 'missing';

  let before: string | null = null;
  for (let i = 0; i < ROW_TRIES && before === null; i++) {
    if (opts.superseded?.()) return 'superseded';
    const answer = await run(click).catch(() => null);
    if (typeof answer === 'string') before = answer;
    else if (i === 0) opts.showList();
    if (before === null && i < ROW_TRIES - 1) await wait(LIST_INTERVAL_MS);
  }
  if (before === null) return 'missing';

  const opened = listOpenedScript(threadId, before)!;
  for (let i = 0; i < OPENED_TRIES; i++) {
    // Clicked, and the view is someone else's now: the hash is not written over it either.
    if (opts.superseded?.()) return 'superseded';
    if ((await run(opened).catch(() => false)) === true) return 'clicked';
    if (i < OPENED_TRIES - 1) await wait(LIST_INTERVAL_MS);
  }
  return 'ignored';
}


//===========================
// Helper functions
//===========================

/** What both scripts read the page with: the list row an element stands in, and whether an
 * element is laid out at all. Gmail keeps lists it drew before in the page, hidden, so a row
 * that is there is not yet a row on screen. */
const PAGE_HELPERS = `const attr = (el, name) =>
    typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
  const rowOf = (start) => {
    let cur = start;
    for (let d = 0; cur && d < 30; d++) {
      if (attr(cur, 'role') === 'row') return cur;
      const next = cur.parentElement;
      if (!next || next === cur) return null;
      cur = next;
    }
    return null;
  };
  const shown = (el) =>
    typeof el.getClientRects === 'function' ? el.getClientRects().length > 0 : false;`;
