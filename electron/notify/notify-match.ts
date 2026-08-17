// Which mail a notification from Gmail's own page was about.
//
// The notification does not say: its `tag` is the account address and its `data` is null,
// so the only description it carries is the text it draws — sender in the title, subject in
// the body. The API knows the answer exactly, and this is the half of asking it that needs
// no network.
//
// Truncation is why this is not a string comparison, and the rule is kept identical to
// `matchThreadsBySubject` in the page: the two are each other's fallback.

import type { MessageMeta } from '../gmail/gmail-api';
import { displayName } from '../mail/mail-archive';



//===========================
// Types
//===========================

export interface NotifiedMail {
  sender: string;
  subject: string;
}


//===========================
// Constants
//===========================

const ELLIPSIS = /(…|\.\.\.)$/;

// stripped from both sides: a conversation title carries the subject without them, a
// notification about a reply carries them
const REPLY_PREFIX = /^((re|aw|fwd?|antw|doorst)\s*(\[\d+\])?\s*:\s*)+/i;


//===========================
// Exported functions
//===========================

/**
 * Whether a candidate subject is the one the notification drew
 *
 * A prefix match, because a long subject arrives truncated. Mail with no subject matches
 * only mail that has none either, or every click would land on the newest mail.
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
 * The title is the only thing that says what a view is showing rather than what it was
 * asked for: the app writes the hash itself, so that reads back as the target at once.
 * Anchored at the front and stopped at Gmail's " - ", never a bare prefix.
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
 * Gmail collapses newlines and space runs before drawing, so a wrapped subject arrives on
 * one line and would never compare equal otherwise.
 *
 * @param text
 * @returns the text on one line, trimmed
 * @private
 */
function fold(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
