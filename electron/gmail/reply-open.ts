// Opening Gmail's reply box on one message, in a conversation window the app owns.
//
// Gmail has no address that opens a reply, so the box is opened the way a reader opens it:
// by pressing Reply. The button is found by what it says rather than by Gmail's class names,
// which are obfuscated and change; the reply link under the conversation, whose classes have
// stood for years, is the fallback. Gmail answers a press on mousedown/mouseup rather than on
// click, so all three are sent.
//
// As with message-anchor.ts, Reply is pressed at most once: a second press opens a second
// box. The polling after it only watches for the box to appear and puts the cursor in it.

import { isLegacyMessageId } from './message-anchor';


//===========================
// Types
//===========================

/** One look at the page: the box is there, Reply was just pressed, or neither yet. */
export type ReplyProbe = 'open' | 'pressed' | 'missing';

/** How it ended. `stuck` is Reply having been pressed without a box ever appearing, which is
 * the page having changed shape; the log line worth grepping for. */
export type ReplyOutcome = 'open' | 'stuck' | 'missing';


//===========================
// Constants
//===========================

/** What Reply is called in the languages Gmail is used in here; matched whole, so Reply all
 * and Forward never are. */
const REPLY_LABEL = /^(reply|beantwoorden|antwoorden|antworten|répondre|responder|rispondi)$/i;

/** The reply link under the conversation: `ams` is the link row, `bkH` its Reply entry. */
const BOTTOM_REPLY_SELECTOR = 'span.ams.bkH';

const EDITOR_SELECTOR = 'div[contenteditable="true"][role="textbox"], div[g_editable="true"]';

/** A thread window loads all of Gmail before it draws the conversation, so this is longer
 * than the anchor's budget: fifteen seconds, then the window is left as it is. */
export const REPLY_TRIES = 60;

export const REPLY_INTERVAL_MS = 250;


//===========================
// Exported functions
//===========================

/**
 * Builds the script that finds the reply box, or presses Reply to open it
 *
 * @param messageId the legacy hex id of the message to answer; its own Reply is preferred
 *   over the one under the conversation, which answers the newest message
 * @param mayPress false once Reply has been pressed, so a slow box is not opened twice
 * @returns the script; an id Gmail did not write is left out rather than put in the page
 */
export function replyScript(messageId: string | undefined, mayPress: boolean): string {
  const selector =
    messageId && isLegacyMessageId(messageId)
      ? JSON.stringify(`[data-legacy-message-id="${messageId}"]`)
      : 'null';
  return `(() => {
  const shown = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const editors = document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)});
  for (const ed of editors) {
    if (!shown(ed)) continue;
    ed.focus();
    return 'open';
  }
  if (!${mayPress ? 'true' : 'false'}) return 'missing';
  const press = (el) => {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  };
  const inRow = (el) => !!el.closest('[role="row"], [data-legacy-last-message-id]');
  let scope = null;
  if (${selector}) {
    for (const el of document.querySelectorAll(${selector})) if (!inRow(el)) { scope = el; break; }
  }
  if (scope) {
    for (const b of scope.querySelectorAll('[role="button"]')) {
      const label = (b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '').trim();
      if (!${REPLY_LABEL.toString()}.test(label) || !shown(b)) continue;
      press(b);
      return 'pressed';
    }
  }
  const bottom = document.querySelector(${JSON.stringify(BOTTOM_REPLY_SELECTOR)});
  if (shown(bottom)) {
    press(bottom);
    return 'pressed';
  }
  return 'missing';
})()`;
}

/**
 * Opens the reply box once the conversation has been drawn, and puts the cursor in it
 *
 * @param run hands a script to the page
 * @param messageId the message to answer, when known
 * @param opts.gone true once the window has been closed, which ends the looking
 * @param opts.wait injectable, so a test does not sit through the tries
 * @returns {Promise<ReplyOutcome>} how it ended
 */
export async function openReplyBox(
  run: (script: string) => Promise<unknown>,
  messageId: string | undefined,
  opts: { gone?: () => boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<ReplyOutcome> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let pressed = false;
  for (let i = 0; i < REPLY_TRIES; i++) {
    if (opts.gone?.()) break;
    const answer = await run(replyScript(messageId, !pressed)).catch(() => null);
    if (answer === 'open') return 'open';
    if (answer === 'pressed') pressed = true;
    if (i < REPLY_TRIES - 1) await wait(REPLY_INTERVAL_MS);
  }
  return pressed ? 'stuck' : 'missing';
}
