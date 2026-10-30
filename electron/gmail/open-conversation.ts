// Which conversation the Gmail page is showing open, so a card about a mail can leave once
// the reader opened that mail in the app.
//
// The hash cannot say: with the reading pane on, opening a conversation leaves it at #inbox,
// and without the pane Gmail writes its own permalink token there, which no API id converts
// to. The opened conversation's subject line can: it is an h2 carrying the legacy thread id
// -- the id the API hands out -- and its text is the subject. Gmail keeps conversations it
// showed before in the page, hidden, so only one laid out on screen counts.
//
// The page watches for that subject line to change and reports only what is newly open, so a
// conversation already on screen when a card arrives for it -- a reply landing in the thread
// being read -- does not take the card: the reader has not opened anything.
//
// Node-safe: the preload runs this against the real page, the tests against a fake one.


//===========================
// Types
//===========================

export interface OpenConversation {
  threadId: string;
  subject: string;
}

interface PageNode {
  getAttribute(name: string): string | null;
  getClientRects(): ArrayLike<unknown>;
  textContent: string | null;
}


//===========================
// Constants
//===========================

/** The opened conversation's subject line. List rows carry the same attribute on a span. */
export const OPEN_SUBJECT_SELECTOR = 'h2[data-legacy-thread-id]';

/** How long the page lets its own changes settle before looking again. Gmail mutates the DOM
 * constantly; the observer only arms this, so a burst costs one look. */
export const OPEN_CHECK_DELAY_MS = 250;


//===========================
// Exported functions
//===========================

/**
 * Every conversation open on screen
 *
 * @param doc the page
 * @returns the conversations, each once
 */
export function openConversations(doc: { querySelectorAll(sel: string): ArrayLike<PageNode> }): OpenConversation[] {
  const out: OpenConversation[] = [];
  const seen = new Set<string>();
  const all = doc.querySelectorAll(OPEN_SUBJECT_SELECTOR);
  for (let i = 0; i < all.length; i++) {
    const threadId = all[i].getAttribute('data-legacy-thread-id');
    if (!threadId || seen.has(threadId) || all[i].getClientRects().length === 0) continue;
    seen.add(threadId);
    out.push({ threadId, subject: (all[i].textContent ?? '').trim() });
  }
  return out;
}

/**
 * What is open now that was not open before
 *
 * @param before the thread ids open at the last look
 * @param now what is open at this one
 * @returns the newly opened conversations
 */
export function newlyOpened(before: ReadonlySet<string>, now: readonly OpenConversation[]): OpenConversation[] {
  return now.filter((c) => !before.has(c.threadId));
}

/**
 * Reads what a page sent, dropping anything that is not a conversation
 *
 * @param payload whatever arrived on the channel
 * @returns the conversations
 */
export function parseOpenConversations(payload: unknown): OpenConversation[] {
  if (!Array.isArray(payload)) return [];
  const out: OpenConversation[] = [];
  for (const a of payload) {
    if (typeof a?.threadId !== 'string' || !a.threadId) continue;
    out.push({ threadId: a.threadId, subject: typeof a.subject === 'string' ? a.subject : '' });
  }
  return out;
}
