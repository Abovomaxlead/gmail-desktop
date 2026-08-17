// Reads the unread count out of Gmail's page title, and tells whether that title has the
// shape a loaded mailbox gives it. Both go by shape, never by text, since folder names are
// translated. A digit group must be exactly three, which is what keeps "(1.5)" out.
//
// The third function is about whose count the title carries: Gmail titles the view on
// screen, so a label with 40 unread would otherwise become the badge. The count is only
// taken on the inbox list; elsewhere the last inbox number stands, which is still true.


//===========================
// Constants
//===========================

const GROUP_SEP = "[.,\\u0020\\u00A0\\u202F\\u2009'\\u2019]";
const COUNT = new RegExp(`\\((\\d{1,3}(?:${GROUP_SEP}\\d{3})+|\\d+)\\)`);
const SEPS = new RegExp(GROUP_SEP, 'g');


//===========================
// Exported functions
//===========================

/**
 * Reads the unread count out of a page title
 *
 * @param title
 * @returns the count, or 0 when the title carries none
 */
export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(COUNT);
  if (!match) return 0;
  const n = parseInt(match[1].replace(SEPS, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tells whether a title has the shape a loaded mailbox gives it
 *
 * @param title
 * @returns true once the title carries an address and the Gmail suffix
 */
export function mailboxTitleLoaded(title: string | null | undefined): boolean {
  if (!title) return false;
  if (!/\s-\sGmail\s*$/.test(title)) return false;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(title);
}

/**
 * Tells whether a route is the inbox list, whose count the badge is for
 *
 * A page of the inbox counts too — paging does not change which mailbox is on screen. An
 * open conversation does not, even one reached from the inbox: Gmail titles it after the
 * subject, so the title carries no count at all and reading it would clear a badge that
 * nothing had emptied.
 *
 * @param hash location.hash, with or without its leading '#'
 * @returns true only for the inbox list itself
 */
export function showsInboxList(hash: string | null | undefined): boolean {
  const route = (hash ?? '').replace(/^#/, '');
  if (route === '') return true;
  return /^inbox(?:\/p\d+)?$/i.test(route);
}
