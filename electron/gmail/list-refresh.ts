// Making Gmail's page show, now, a change the app made to a mail through the API.
//
// Archive, delete and mark-read on a notification card go straight to the API, and Gmail's
// page only learns about that at its own next sync, some ten seconds later: the mail stayed
// in the list after Delete, and the reader took the button for broken.
//
// First the page is asked to sync now, the way a reader would ask it: by pressing Refresh
// above the list. The button is found by Gmail's own action id first and by what it says
// second, since its class names are obfuscated and change. Gmail keeps toolbars of views it
// drew before in the page, hidden, so only a button that is laid out counts. Gmail answers a
// press on mousedown/mouseup rather than on click, so all three are sent.
//
// Where no Refresh is on screen, the conversation's rows are hidden instead, and only once
// the API has said the conversation has left the inbox altogether: a conversation that
// still holds inbox mail stays in the list, and so must its row. Only inbox views are
// touched, since an archived mail rightly stays under its labels. Hiding is a stand-in for
// Gmail's own sync, not a replacement: Gmail reuses row elements for other mail as it
// redraws, so a hidden row comes back the moment it holds anything else, and after
// HIDE_MAX_MS regardless, by which time Gmail has synced and dropped it itself.

import { isLegacyMessageId } from './message-anchor';
import { PAGE_HELPERS } from './list-row-open';


//===========================
// Types
//===========================

/** How Refresh went. `missing`: none on screen, a conversation open, say. */
export type ListRefresh = 'pressed' | 'missing';


//===========================
// Constants
//===========================

/** Gmail's action id for Refresh, stable across its class-name churn */
const REFRESH_SELECTOR = '[role="button"][act="20"]';

/** What Refresh is called in the languages Gmail is used in here; matched whole. */
const REFRESH_LABEL = /^(refresh|vernieuwen|aktualisieren|actualiser|actualizar|aggiorna)$/i;

/** The inbox and its category tabs; an empty hash is the inbox too. */
const INBOX_HASH = /^(#inbox|#category\/[^/?]+)?$/;

/** Long past Gmail's own sync, which is what drops the row for real. */
export const HIDE_MAX_MS = 60_000;

export const LIST_REFRESH_SCRIPT = `(() => {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  let button = null;
  for (const el of document.querySelectorAll(${JSON.stringify(REFRESH_SELECTOR)})) {
    if (shown(el)) { button = el; break; }
  }
  if (!button) {
    for (const el of document.querySelectorAll('[role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '').trim();
      if (${REFRESH_LABEL.toString()}.test(label) && shown(el)) { button = el; break; }
    }
  }
  if (!button) return 'missing';
  for (const type of ['mousedown', 'mouseup', 'click']) {
    button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  return 'pressed';
})()`;


//===========================
// Exported functions
//===========================

/**
 * Presses Refresh above Gmail's list, so a change made through the API shows now
 *
 * @param run hands a script to the page
 * @returns {Promise<ListRefresh>} 'pressed', or 'missing' when no Refresh was on screen or the
 *   page did not answer
 */
export async function refreshMailList(run: (script: string) => Promise<unknown>): Promise<ListRefresh> {
  const answer = await run(LIST_REFRESH_SCRIPT).catch(() => null);
  return answer === 'pressed' ? 'pressed' : 'missing';
}

/**
 * Builds the script that hides a conversation's rows in an inbox list
 *
 * @param threadId the legacy hex id of a conversation the API says has left the inbox
 * @returns the script, or null for an id Gmail did not write — which is never run. In the
 *   page it answers how many rows it hid, or -1 when the view is not an inbox
 */
export function hideThreadRowsScript(threadId: string): string | null {
  if (!isLegacyMessageId(threadId)) return null;
  const selector = JSON.stringify(`[data-legacy-thread-id="${threadId}"]`);
  return `(() => {
  ${PAGE_HELPERS}
  if (!${INBOX_HASH.toString()}.test(location.hash)) return -1;
  const rows = new Set();
  for (const el of document.querySelectorAll(${selector})) {
    const row = rowOf(el);
    if (row && shown(row)) rows.add(row);
  }
  for (const row of rows) {
    const was = row.style.display;
    row.style.display = 'none';
    const observer = new MutationObserver(() => {
      if (!row.matches(${selector}) && !row.querySelector(${selector})) restore();
    });
    const timer = setTimeout(() => restore(), ${HIDE_MAX_MS});
    const restore = () => {
      observer.disconnect();
      clearTimeout(timer);
      row.style.display = was;
    };
    observer.observe(row, { subtree: true, childList: true, attributes: true });
  }
  return rows.size;
})()`;
}

/**
 * Hides a conversation's rows in the list, for when Refresh could not be pressed
 *
 * @param run hands a script to the page
 * @param threadId a conversation the API says has left the inbox
 * @returns how many rows were hidden; -1 when the view is not an inbox or the page did not
 *   answer
 */
export async function hideThreadRows(
  run: (script: string) => Promise<unknown>,
  threadId: string,
): Promise<number> {
  const script = hideThreadRowsScript(threadId);
  if (!script) return -1;
  const answer = await run(script).catch(() => null);
  return typeof answer === 'number' ? answer : -1;
}
