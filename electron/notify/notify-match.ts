// Which mail a notification from Gmail's own page was about.
//
// The notification does not say. Its `tag` is the account address and its `data` is null,
// proven with live CDP instrumentation in July, so the only description of the mail it
// carries is the text it draws: the sender in the title, the subject in the body. Until
// now that text was matched against the rows the view happened to be rendering, which
// guesses twice — the row is only in the DOM while the view shows the inbox, and two mails
// with one subject are indistinguishable there. The API knows the answer exactly. This is
// the half of asking it that needs no network, and therefore the half worth testing.
//
// Truncation is why this is not a string comparison. A long subject arrives cut short and
// ending in an ellipsis, so the notification holds a prefix of the real subject — the same
// rule `matchThreadsBySubject` applies in the page, kept identical on purpose: the two are
// each other's fallback, and a click that changes its mind about which mail it meant
// depending on which lookup answered would be worse than either.

import type { MessageMeta } from '../gmail/gmail-api';
import { displayName } from '../mail/mail-archive';



//===========================
// Types
//===========================

// What Gmail wrote on the notification, before any privacy replacement main applies to the
// card. The subject is the lead; the sender only settles a tie.
export interface NotifiedMail {
  sender: string;
  subject: string;
}


//===========================
// Constants
//===========================

const ELLIPSIS = /(…|\.\.\.)$/;

// Gmail's own "Re:"/"Fwd:" markers, in the languages the app runs in. The title of an open
// conversation carries the thread's subject as the header shows it, which is without them;
// a notification about a reply carries them. Stripped from both sides so the two can be
// compared at all.
const REPLY_PREFIX = /^((re|aw|fwd?|antw|doorst)\s*(\[\d+\])?\s*:\s*)+/i;


//===========================
// Exported functions
//===========================

/**
 * Whether a candidate subject is the one the notification drew
 *
 * Truncation is why this is not a string comparison: a long subject arrives cut short
 * and ending in an ellipsis, so the notification holds a prefix of the real subject.
 * Mail with no subject matches only mail that has none either — an empty want matching
 * everything would hand back the newest mail in the inbox regardless of what was clicked.
 *
 * @param candidate the subject off a fetched message
 * @param notified the subject as the notification drew it
 * @returns true when they can be the same mail
 */
export function subjectMatches(candidate: string, notified: string): boolean {
  const want = fold(notified);
  const have = fold(candidate);
  if (!want) return !have;
  if (have === want) return true;
  if (!ELLIPSIS.test(want)) return false;
  const prefix = want.replace(ELLIPSIS, '');
  return prefix.length > 0 && have.startsWith(prefix);
}

/**
 * Whether the page's title says this conversation is the one on screen
 *
 * The title is the only thing about a Gmail view that says which mail it is *showing*,
 * as opposed to which mail it was *asked* for. The hash is no answer to that: the app
 * writes the hash itself, so it reads back as the target the instant it is set, while
 * Gmail is still fetching.
 *
 * Anchored at the front and stopped at Gmail's " - " separator, never a bare prefix: the
 * title of "Kennissessies september" starts with the subject "Kennissessies", and
 * treating that as a match is exactly the confusion this exists to prevent.
 *
 * @param title the view's page title
 * @param subject the subject to look for
 * @returns true when the title is showing that conversation
 */
export function titleShowsSubject(title: string, subject: string): boolean {
  const shown = fold(title).replace(REPLY_PREFIX, '');
  const want = fold(subject).replace(REPLY_PREFIX, '');
  if (!shown || !want) return false;
  if (ELLIPSIS.test(want)) {
    const prefix = want.replace(ELLIPSIS, '');
    return prefix.length > 0 && shown.startsWith(prefix);
  }
  return shown === want || shown.startsWith(`${want} - `);
}

/**
 * The message a notification was about
 *
 * When several mails share a subject the sender decides, and when that decides nothing
 * either the newest wins — a notification is about mail that just arrived.
 *
 * @param metas the handful of messages fetched for the account
 * @param notified what Gmail drew on the notification
 * @returns the message, or null; null is a real answer, and the caller then falls back
 *   to the page's own lookup
 */
export function pickNotifiedMessage(
  metas: MessageMeta[],
  notified: NotifiedMail,
): MessageMeta | null {
  const matches = metas.filter((m) => subjectMatches(m.subject, notified.subject));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const sender = fold(notified.sender).toLowerCase();
  const bySender = sender
    ? matches.filter((m) => fold(displayName(m.from)).toLowerCase() === sender)
    : [];
  const pool = bySender.length > 0 ? bySender : matches;
  return pool.reduce((best, m) => (m.internalDate > best.internalDate ? m : best));
}


//===========================
// Helper functions
//===========================

/**
 * Folds text the way the notification folds it
 *
 * Gmail collapses newlines and runs of spaces into one before it draws the text, so a
 * subject that wrapped in the header arrives here on a single line and would never
 * compare equal otherwise.
 *
 * @param text
 * @returns the text on one line, trimmed
 * @private
 */
function fold(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
