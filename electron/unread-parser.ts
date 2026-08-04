// Reads the unread count out of Gmail's page title, and tells whether that title has
// the shape it only takes once a mailbox is really loaded. Both go by shape, never by
// text, since folder names are translated and the address and suffix are not. From a
// thousand up Gmail groups the digits with a separator that differs per locale (".",
// ",", a normal or narrow space, an apostrophe), so a group must be exactly three
// digits: that is what keeps "(1.5)" from being read as 15.
const GROUP_SEP = "[.,\\u0020\\u00A0\\u202F\\u2009'\\u2019]";
const COUNT = new RegExp(`\\((\\d{1,3}(?:${GROUP_SEP}\\d{3})+|\\d+)\\)`);
const SEPS = new RegExp(GROUP_SEP, 'g');

export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(COUNT);
  if (!match) return 0;
  const n = parseInt(match[1].replace(SEPS, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function mailboxTitleLoaded(title: string | null | undefined): boolean {
  if (!title) return false;
  if (!/\s-\sGmail\s*$/.test(title)) return false;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(title);
}
