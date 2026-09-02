// Showing the one message a notification was about, inside the conversation it belongs to.
//
// A conversation is not a mail: opening a thread leaves Gmail to decide which of its
// messages is unfolded, and Gmail decides that for a reader browsing their inbox, not for
// someone who just clicked a card about one specific mail. Either rule it uses lands on the
// wrong message here — the id a thread is opened by is the id of its *first* message, and
// where Gmail instead picks the oldest unread one, a thread holding several unread replies
// opens on the oldest of them. Both answers are "an older mail in the right thread", which
// is exactly the complaint.
//
// So the app stops leaving it to Gmail. The thread is opened as before — that part was
// never wrong — and then the message itself is pointed at in the page.
//
// Three rules hold this to doing nothing rather than doing harm. The message is clicked at
// most once, ever, because a second click on an open message folds it shut and the reader
// would end up worse off than the bug left them. The click needs a positive sign that the
// block is folded, so a Gmail redrawn under us is left alone rather than guessed at. And
// the script is a string handed to Google's page, so the id is let through only as the hex
// Gmail writes: an id from anywhere else never reaches the page at all.


//===========================
// Types
//===========================

/** What one look at the page found.
 *
 * `missing` is the conversation not being on screen yet, the normal answer while Gmail is
 * still navigating. `folded` is the message being there, shut, and untouched. `unsure` is
 * the block being there while nothing says whether it is folded — a Gmail redrawn under
 * us, and the one shape that is left exactly as it was found. */
export type AnchorProbe =
  | 'missing'
  | 'shown'
  | 'folded'
  | 'clicked'
  | 'revealed'
  | 'hidden'
  | 'unsure';

/** How it ended. `opened` is the message having been folded and now not being; `stuck` is
 * the click having been spent without the message ever opening, which is the page having
 * changed shape under a rule this module still believes. Both are only ever read in the
 * log, and `stuck` is the line worth grepping for. */
export type MessageAnchor = 'missing' | 'unsure' | 'hidden' | 'shown' | 'opened' | 'stuck';


//===========================
// Constants
//===========================

/** The block Gmail wraps one message of a conversation in. Read the same way in
 * mail/dropzone.ts, which is what says this attribute is really there. */
const MESSAGE_BLOCK_ATTR = 'data-legacy-message-id';

/** Gmail's message body, by the two classes it is drawn under. Both are in the stylesheet
 * Gmail serves this app and neither is hidden by any rule in it, so a body that is in the
 * block is laid out — which is what makes its height an honest answer. They are obfuscated
 * names all the same, so nothing depends on them alone: a block that grows past the fold
 * height after the click counts as opened without either. */
const MESSAGE_BODY_SELECTOR = '.a3s, .ii';

/** A folded message is a header row and nothing else. An open one carries a body and runs
 * well past this; a folded one sits near 45px and reaches for it only where Gmail wraps the
 * header over several lines, which René mode's zoom is enough to do. Between the two the
 * answer is `unsure` and nothing happens, which is the point: the cost of guessing high is
 * the old bug staying, and the cost of guessing low is folding away the mail somebody is
 * reading. */
const FOLDED_MAX_HEIGHT = 120;

/** How far up a hidden block to look for the row that reveals it. Gmail folds the middle of
 * a long conversation into a bundle and puts `display:none` on every message in it, so the
 * message a card names measures nothing at all there — the one place this fails silently if
 * the bundle is not opened first. Its visible row measures 40px, which is why the same fold
 * height recognises it. */
const REVEAL_DEPTH = 8;

const LEGACY_ID = /^[0-9a-f]{1,32}$/i;

/** The same budget the pop-out click polls on: long enough for a Gmail navigation, short
 * enough that a conversation which never arrives is given up on rather than clicked into
 * later, when the view has moved on. */
export const ANCHOR_TRIES = 12;

export const ANCHOR_INTERVAL_MS = 250;


//===========================
// Exported functions
//===========================

/**
 * Whether an id is one Gmail wrote
 *
 * @param messageId
 * @returns true for the hex form the API and the page both use
 */
export function isLegacyMessageId(messageId: string): boolean {
  return LEGACY_ID.test(messageId ?? '');
}

/**
 * Builds the script that looks for one message, and may unfold it
 *
 * Folded, the block is the header row and clicking it is what opens it; open, that same
 * click would fold it again, so an open message is only scrolled to.
 *
 * @param messageId the legacy hex id of the message the notification was about
 * @param may.click false once the message has been clicked, so it is never toggled back
 *   shut by the polling that is checking the click worked
 * @param may.reveal false once the bundle around it has been opened, for the same reason
 * @returns the script, or null for an id Gmail did not write — which is never run
 */
export function messageAnchorScript(
  messageId: string,
  may: { click?: boolean; reveal?: boolean } = {},
): string | null {
  if (!isLegacyMessageId(messageId)) return null;
  const selector = JSON.stringify(`[${MESSAGE_BLOCK_ATTR}="${messageId}"]`);
  const mayClick = may.click !== false;
  const mayReveal = may.reveal !== false;
  return `(() => {
  const attr = (el, name) =>
    typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
  const up = (start, depth, fn) => {
    let cur = start;
    for (let d = 0; cur && d < depth; d++) {
      const answer = fn(cur, d);
      if (answer !== null) return answer;
      const next = cur.parentElement;
      if (!next || next === cur) return null;
      cur = next;
    }
    return null;
  };
  // A list row is not a message. Gmail hangs the id of the mail an attachment belongs to on
  // the chip drawn in the row, so the inbox holds a match for the very message being looked
  // for -- and clicking it opens the attachment instead of the mail.
  const inRow = (start) =>
    up(start, 30, (cur) =>
      attr(cur, 'role') === 'row' || attr(cur, 'data-legacy-last-message-id') ? true : null,
    ) === true;
  const all = document.querySelectorAll(${selector});
  let el = null;
  for (let i = 0; i < all.length && !el; i++) if (!inRow(all[i])) el = all[i];
  if (!el) return 'missing';
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  const body = el.querySelector(${JSON.stringify(MESSAGE_BODY_SELECTOR)});
  if (body && (body.offsetParent !== null || body.offsetHeight > 0)) return 'shown';
  const folded = (h) => h > 0 && h < ${FOLDED_MAX_HEIGHT};
  const height = el.offsetHeight || 0;
  if (height === 0) {
    if (!${mayReveal ? 'true' : 'false'}) return 'hidden';
    const row = up(el.parentElement, ${REVEAL_DEPTH}, (cur) =>
      folded(cur.offsetHeight || 0) && typeof cur.click === 'function' ? cur : null,
    );
    if (!row) return 'hidden';
    row.click();
    return 'revealed';
  }
  if (!folded(height)) return 'unsure';
  if (!${mayClick ? 'true' : 'false'}) return 'folded';
  if (typeof el.click === 'function') el.click();
  return 'clicked';
})()`;
}

/**
 * Reads the page's answer back
 *
 * @param answer whatever executeJavaScript resolved with, which is unknown by the time it
 *   has crossed out of the page
 * @returns the probe, or 'missing' for anything unrecognised — a page that answers nonsense
 *   has not shown the message
 */
export function parseAnchorProbe(answer: unknown): AnchorProbe {
  const known: AnchorProbe[] = ['shown', 'folded', 'clicked', 'revealed', 'hidden', 'unsure'];
  return known.includes(answer as AnchorProbe) ? (answer as AnchorProbe) : 'missing';
}

/**
 * Points the page at one message, once the conversation has arrived
 *
 * Gmail navigates on its own clock and the app cannot write the hash and read the result in
 * the same breath, so the page is asked again until the message is there. A page that
 * refuses to be asked counts as not showing it, and is asked again like any other.
 *
 * The looking does not stop at the click. Whether a synthetic click reaches Gmail's own
 * handler is the one thing that cannot be settled away from a real mailbox, so the click is
 * spent once and the tries that follow are what say whether it worked — which is the
 * difference between a log line that reports and one that assumes.
 *
 * @param run hands a script to the page
 * @param messageId the legacy hex id of the message the notification was about
 * @param opts.superseded asked before every try. A second card clicked while this one is
 *   still looking owns the view now, and two of these running at once on one conversation
 *   would unfold both messages and scroll to whichever finished last
 * @param opts.wait injectable, so a test does not sit through the tries
 * @returns {Promise<MessageAnchor>} how it ended
 */
export async function anchorMessage(
  run: (script: string) => Promise<unknown>,
  messageId: string,
  opts: { superseded?: () => boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<MessageAnchor> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!isLegacyMessageId(messageId)) return 'missing';

  let clicked = false;
  let revealed = false;
  let last: MessageAnchor = 'missing';
  for (let i = 0; i < ANCHOR_TRIES; i++) {
    if (opts.superseded?.()) return clicked ? 'opened' : last;
    const script = messageAnchorScript(messageId, { click: !clicked, reveal: !revealed })!;
    const probe = parseAnchorProbe(await run(script).catch(() => null));
    if (probe === 'shown') return clicked ? 'opened' : 'shown';
    // Grown past the height a folded block can reach: the click landed, whatever became of
    // the classes the body is read by.
    if (probe === 'unsure' && clicked) return 'opened';
    if (probe === 'clicked') clicked = true;
    else if (probe === 'revealed') revealed = true;
    else last = probe === 'folded' ? 'unsure' : (probe as MessageAnchor);
    if (i < ANCHOR_TRIES - 1) await wait(ANCHOR_INTERVAL_MS);
  }
  return clicked ? 'stuck' : last;
}
